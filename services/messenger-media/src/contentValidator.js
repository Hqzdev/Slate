import { readFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import yauzl from "yauzl";
import { PermanentMediaError } from "./storage.js";

const binaryTypes = new Map([
  ["application/pdf", "application/pdf"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["image/gif", "image/gif"],
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
  ["video/mp4", "video/mp4"],
  ["video/webm", "video/webm"]
]);
const textTypes = new Set(["application/json", "text/csv", "text/markdown", "text/plain"]);

export class ContentValidator {
  async validate(filePath, declaredContentType, declaredBytes) {
    if (textTypes.has(declaredContentType)) return this.validateText(filePath, declaredContentType);
    const detected = await fileTypeFromFile(filePath);
    if (!detected || binaryTypes.get(declaredContentType) !== detected.mime) throw new PermanentMediaError("content_type_mismatch");
    if (declaredContentType.includes("openxmlformats")) await inspectOffice(filePath, declaredContentType, declaredBytes);
    return detected.mime;
  }

  async validateText(filePath, declaredContentType) {
    const bytes = await readFile(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const prefix = text.trimStart().slice(0, 512).toLowerCase();
    if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.includes("<script")) {
      throw new PermanentMediaError("active_content_rejected");
    }
    if (declaredContentType === "application/json") {
      try {
        JSON.parse(text);
      } catch {
        throw new PermanentMediaError("invalid_json");
      }
    }
    return declaredContentType;
  }
}

function inspectOffice(filePath, contentType, declaredBytes) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (openError, archive) => {
      if (openError || !archive) return reject(new PermanentMediaError("office_container_invalid"));
      let entries = 0;
      let totalBytes = 0;
      let requiredPart = false;
      const fail = (code) => {
        archive.close();
        reject(new PermanentMediaError(code));
      };
      archive.on("entry", (entry) => {
        entries += 1;
        totalBytes += entry.uncompressedSize;
        const name = entry.fileName.replace(/\\/gu, "/").toLowerCase();
        if (entry.generalPurposeBitFlag & 1) return fail("encrypted_office_rejected");
        if (entries > 10_000 || totalBytes > Math.min(500 * 1024 * 1024, declaredBytes * 20)) return fail("office_expansion_limit");
        if (name.includes("vbaproject.bin") || name.includes("/macros/") || name.includes("externallinks/")) return fail("active_office_content_rejected");
        if (contentType.includes("wordprocessingml") && name === "word/document.xml") requiredPart = true;
        if (contentType.includes("spreadsheetml") && name === "xl/workbook.xml") requiredPart = true;
        if (contentType.includes("presentationml") && name === "ppt/presentation.xml") requiredPart = true;
        archive.readEntry();
      });
      archive.on("end", () => requiredPart ? resolve() : reject(new PermanentMediaError("office_container_invalid")));
      archive.on("error", () => reject(new PermanentMediaError("office_container_invalid")));
      archive.readEntry();
    });
  });
}
