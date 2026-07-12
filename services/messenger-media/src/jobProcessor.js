import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PermanentMediaError } from "./storage.js";

export class MediaJobProcessor {
  constructor(dependencies) {
    this.clamav = dependencies.clamav;
    this.contentValidator = dependencies.contentValidator;
    this.mediaProcessor = dependencies.mediaProcessor;
    this.repository = dependencies.repository;
    this.storage = dependencies.storage;
    this.temporaryDirectory = dependencies.temporaryDirectory;
  }

  async process(job) {
    await mkdir(this.temporaryDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.temporaryDirectory, "job-"));
    const originalPath = join(directory, "original");
    const previewPath = join(directory, job.kind === "video" ? "poster.jpg" : "thumbnail.webp");
    const uploadedVariants = [];
    try {
      const expectedBytes = Number(job.declaredByteSize);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 300 * 1024 * 1024) {
        throw new PermanentMediaError("object_size_mismatch");
      }
      await this.storage.download(job.storageKey, originalPath, expectedBytes);
      const fileStat = await stat(originalPath);
      if (fileStat.size !== expectedBytes) throw new PermanentMediaError("object_size_mismatch");
      const checksumSha256 = await hashFile(originalPath);
      const scan = await this.clamav.scan(originalPath);
      if (!scan.clean) throw new PermanentMediaError("malware_detected");
      const contentType = await this.contentValidator.validate(originalPath, job.declaredContentType, expectedBytes);
      const processed = await this.mediaProcessor.process({
        contentType,
        filePath: originalPath,
        kind: job.kind,
        previewPath
      });
      let thumbnailStorageKey = null;
      let posterStorageKey = null;
      if (processed.preview) {
        const previewKey = `${job.storageKey}/${processed.preview.type === "poster" ? "poster.jpg" : "thumbnail.webp"}`;
        await this.storage.upload(previewKey, processed.preview.path, processed.preview.contentType);
        uploadedVariants.push(previewKey);
        if (processed.preview.type === "poster") posterStorageKey = previewKey;
        else thumbnailStorageKey = previewKey;
      }
      const status = await this.repository.markReady(job, {
        byteSize: expectedBytes,
        checksumSha256,
        contentType,
        durationMs: processed.durationMs,
        height: processed.height,
        posterStorageKey,
        thumbnailStorageKey,
        width: processed.width
      });
      if (status !== "ready") await Promise.allSettled(uploadedVariants.map((key) => this.storage.delete(key)));
      return status;
    } catch (error) {
      await Promise.allSettled(uploadedVariants.map((key) => this.storage.delete(key)));
      if (error instanceof PermanentMediaError) {
        await this.repository.reject(job, error.code);
        return "rejected";
      }
      if (job.attemptCount >= 8) {
        await this.repository.reject(job, "processing_unavailable");
        return "rejected";
      }
      const errorCode = transientErrorCode(error);
      process.stderr.write(`${JSON.stringify({
        attachmentId: job.id,
        code: errorCode
      })}\n`);
      await this.repository.retry(job, errorCode);
      return "retry";
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function transientErrorCode(error) {
  if (error instanceof Error && error.message.startsWith("clamav_")) return error.message;
  return "media_processing_failed";
}
