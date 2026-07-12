import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ContentValidator } from "../src/contentValidator.js";
import { MediaProcessor } from "../src/mediaProcessor.js";
import { PermanentMediaError } from "../src/storage.js";

test("validates UTF-8 text and rejects active content and invalid JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slate-validator-"));
  try {
    const validator = new ContentValidator();
    const textPath = join(directory, "plain");
    await writeFile(textPath, "safe text", { mode: 0o600 });
    assert.equal(await validator.validate(textPath, "text/plain", 9), "text/plain");
    await writeFile(textPath, "<script>alert(1)</script>");
    await assert.rejects(validator.validate(textPath, "text/plain", 25), (error) => error instanceof PermanentMediaError && error.code === "active_content_rejected");
    await writeFile(textPath, "{invalid");
    await assert.rejects(validator.validate(textPath, "application/json", 8), (error) => error instanceof PermanentMediaError && error.code === "invalid_json");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("detects signature mismatch and creates a metadata-free bounded thumbnail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slate-image-"));
  try {
    const input = join(directory, "input");
    const preview = join(directory, "preview.webp");
    await sharp({ create: { background: "red", channels: 3, height: 200, width: 300 } }).jpeg().withMetadata({ orientation: 6 }).toFile(input);
    const validator = new ContentValidator();
    assert.equal(await validator.validate(input, "image/jpeg", 100), "image/jpeg");
    await assert.rejects(validator.validate(input, "image/png", 100), (error) => error instanceof PermanentMediaError && error.code === "content_type_mismatch");
    const processor = new MediaProcessor({ run: async () => assert.fail("process runner should not run") });
    const result = await processor.process({ contentType: "image/jpeg", filePath: input, kind: "image", previewPath: preview });
    const metadata = await sharp(preview).metadata();
    assert.equal(result.width, 300);
    assert.equal(result.height, 200);
    assert.equal(metadata.format, "webp");
    assert.ok((metadata.width ?? 0) <= 480);
    assert.equal(metadata.exif, undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("terminally rejects an image that exposes metadata but fails full decoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slate-corrupt-image-"));
  try {
    const input = join(directory, "input.png");
    const preview = join(directory, "preview.webp");
    await writeFile(
      input,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlVfS8AAAAASUVORK5CYII=", "base64"),
      { mode: 0o600 }
    );
    const processor = new MediaProcessor({ run: async () => assert.fail("process runner should not run") });
    await assert.rejects(
      processor.process({ contentType: "image/png", filePath: input, kind: "image", previewPath: preview }),
      (error) => error instanceof PermanentMediaError && error.code === "image_decode_failed"
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("bounds video probe metadata and invokes poster generation without a shell", async () => {
  const calls = [];
  const processor = new MediaProcessor({
    async run(command, args) {
      calls.push([command, args]);
      if (command === "ffprobe") return { stderr: "", stdout: JSON.stringify({ format: { duration: "12.5" }, streams: [{ codec_type: "video", height: 720, width: 1280 }] }) };
      return { stderr: "", stdout: "" };
    }
  });
  const result = await processor.process({ contentType: "video/mp4", filePath: "/tmp/input", kind: "video", previewPath: "/tmp/poster.jpg" });
  assert.equal(result.durationMs, 12_500);
  assert.equal(result.preview.type, "poster");
  assert.deepEqual(calls.map(([command]) => command), ["ffprobe", "ffmpeg"]);
});
