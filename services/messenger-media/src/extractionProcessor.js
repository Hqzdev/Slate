import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PermanentMediaError } from "./storage.js";

const extractableTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

export class AiExtractionProcessor {
  constructor(dependencies) {
    this.clamav = dependencies.clamav;
    this.keyring = dependencies.keyring;
    this.processRunner = dependencies.processRunner;
    this.repository = dependencies.repository;
    this.storage = dependencies.storage;
    this.temporaryDirectory = dependencies.temporaryDirectory;
  }

  async process(job) {
    await mkdir(this.temporaryDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.temporaryDirectory, "extract-"));
    const originalPath = join(directory, "original");
    try {
      const expectedBytes = Number(job.verifiedByteSize);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 10 * 1024 * 1024) throw new PermanentMediaError("ai_attachment_size_rejected");
      if (!extractableTypes.has(job.detectedContentType)) throw new PermanentMediaError("ai_attachment_type_rejected");
      await this.storage.download(job.storageKey, originalPath, expectedBytes);
      if ((await stat(originalPath)).size !== expectedBytes) throw new PermanentMediaError("object_size_mismatch");
      const scan = await this.clamav.scan(originalPath);
      if (!scan.clean) throw new PermanentMediaError("malware_detected");
      const extract = await this.extract(originalPath, job.detectedContentType);
      const normalized = normalizeExtract(extract);
      const encrypted = this.keyring.encryptExtract(job, normalized);
      const completed = await this.repository.complete(job, encrypted, [...normalized].length, createHash("sha256").update(normalized, "utf8").digest("hex"));
      if (!completed) await this.repository.reject(job, "ai_attachment_access_revoked");
      return completed ? "completed" : "rejected";
    } catch (error) {
      if (error instanceof PermanentMediaError) {
        await this.repository.reject(job, error.code);
        return "rejected";
      }
      if (job.attemptCount >= 5) {
        await this.repository.reject(job, "ai_extraction_unavailable");
        return "rejected";
      }
      await this.repository.retry(job, transientErrorCode(error));
      return "retry";
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  async extract(filePath, contentType) {
    if (contentType === "application/pdf") {
      const result = await this.processRunner.run("pdftotext", ["-f", "1", "-l", "100", "-layout", filePath, "-"], 30_000);
      return result.stdout;
    }
    if (contentType.includes("wordprocessingml")) {
      const result = await this.processRunner.run("unzip", ["-p", filePath, "word/document.xml"], 20_000);
      return decodeXmlText(result.stdout);
    }
    const bytes = await readFile(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (contentType === "application/json") JSON.parse(text);
    return text;
  }
}

function normalizeExtract(value) {
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/[\t ]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
  if (!normalized) throw new PermanentMediaError("ai_extract_empty");
  if ([...normalized].length > 32_000) throw new PermanentMediaError("ai_extract_too_large");
  return normalized;
}

function decodeXmlText(value) {
  return value
    .replace(/<w:tab\s*\/>/gu, "\t")
    .replace(/<w:br\s*\/>/gu, "\n")
    .replace(/<\/w:p>/gu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'");
}

function transientErrorCode(error) {
  if (error instanceof Error && error.message.startsWith("clamav_")) return error.message;
  if (error instanceof Error && error.message.includes("key")) return "ai_extraction_key_unavailable";
  return "ai_extraction_failed";
}
