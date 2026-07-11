import { createHash } from "node:crypto";
import { parseAiDraftActionPayload, type UpdateDocumentDraftActionPayload } from "../../ai/draftAction";
import { truncateDatabaseSafeText } from "../../databaseSafeText";
import type { AiDocumentObservation } from "./workspaceContextBuilder";

const maximumDiffPreviewLength = 1_200;

export function hashDocumentContent(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createUpdateDocumentDraft(
  observation: AiDocumentObservation,
  content: string
): UpdateDocumentDraftActionPayload {
  if (!observation.complete) {
    throw new Error("The document must be read in full before it can be updated");
  }
  if (observation.type !== "code" && observation.type !== "note") {
    throw new Error("Only code and note documents can be updated");
  }
  const diff = createTextDiff(observation.content, content);
  const payload = {
    content,
    diffPreview: truncateDatabaseSafeText(diff, maximumDiffPreviewLength),
    diffTruncated: diff.length > maximumDiffPreviewLength,
    documentId: observation.id,
    documentType: observation.type,
    expectedContentHash: hashDocumentContent(observation.content),
    expectedUpdatedAt: observation.updatedAt,
    resultContentHash: hashDocumentContent(content),
    title: observation.title
  };
  return parseAiDraftActionPayload("update_document", payload);
}

export function createTextDiffPreview(before: string, after: string) {
  return truncateDatabaseSafeText(createTextDiff(before, after), maximumDiffPreviewLength);
}

function createTextDiff(before: string, after: string) {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length
    && prefixLength < afterLines.length
    && beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength
    && suffixLength < afterLines.length - prefixLength
    && beforeLines[beforeLines.length - 1 - suffixLength] === afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  const beforeEnd = beforeLines.length - suffixLength;
  const afterEnd = afterLines.length - suffixLength;
  const removed = beforeLines.slice(prefixLength, beforeEnd).map((line) => `- ${line}`);
  const added = afterLines.slice(prefixLength, afterEnd).map((line) => `+ ${line}`);
  const header = `@@ -${prefixLength + 1},${removed.length} +${prefixLength + 1},${added.length} @@`;
  return [header, ...removed, ...added].join("\n");
}
