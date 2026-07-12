import sharp from "sharp";
import { PermanentMediaError } from "./storage.js";

export class MediaProcessor {
  constructor(processRunner) {
    this.processRunner = processRunner;
  }

  async process(input) {
    if (input.kind === "image") return this.processImage(input);
    if (input.kind === "video") return this.processVideo(input);
    if (input.contentType === "application/pdf") await this.validatePdf(input.filePath);
    return { durationMs: null, height: null, preview: null, width: null };
  }

  async processImage(input) {
    let metadata;
    try {
      metadata = await sharp(input.filePath, { animated: false, failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new PermanentMediaError("image_decode_failed");
    }
    if (!metadata.width || !metadata.height || metadata.width > 20_000 || metadata.height > 20_000 || metadata.width * metadata.height > 40_000_000) {
      throw new PermanentMediaError("image_dimensions_exceeded");
    }
    try {
      await sharp(input.filePath, { animated: false, failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ fit: "inside", height: 360, withoutEnlargement: true, width: 480 })
        .webp({ effort: 4, quality: 78 })
        .toFile(input.previewPath);
    } catch {
      throw new PermanentMediaError("image_decode_failed");
    }
    return {
      durationMs: null,
      height: metadata.height,
      preview: { contentType: "image/webp", path: input.previewPath, type: "thumbnail" },
      width: metadata.width
    };
  }

  async processVideo(input) {
    let probe;
    try {
      const result = await this.processRunner.run("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,width,height",
        "-of", "json",
        input.filePath
      ], 20_000);
      probe = JSON.parse(result.stdout);
    } catch {
      throw new PermanentMediaError("video_probe_failed");
    }
    const stream = Array.isArray(probe.streams) ? probe.streams.find((item) => item.codec_type === "video") : null;
    const durationSeconds = Number(probe.format?.duration);
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 4 * 60 * 60
      || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > 7680 || height > 4320 || width * height > 33_177_600) {
      throw new PermanentMediaError("video_metadata_invalid");
    }
    try {
      await this.processRunner.run("ffmpeg", [
        "-nostdin", "-v", "error", "-ss", String(Math.min(1, durationSeconds / 10)), "-i", input.filePath,
        "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", "-y", input.previewPath
      ], 45_000);
    } catch {
      throw new PermanentMediaError("video_poster_failed");
    }
    return {
      durationMs: Math.round(durationSeconds * 1_000),
      height,
      preview: { contentType: "image/jpeg", path: input.previewPath, type: "poster" },
      width
    };
  }

  async validatePdf(filePath) {
    try {
      const result = await this.processRunner.run("qpdf", ["--show-encryption", filePath], 15_000);
      if (!result.stdout.includes("File is not encrypted")) throw new PermanentMediaError("encrypted_pdf_rejected");
    } catch (error) {
      if (error instanceof PermanentMediaError) throw error;
      throw new PermanentMediaError("pdf_validation_failed");
    }
  }
}
