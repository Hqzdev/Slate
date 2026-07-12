import { isDatabaseSafeText } from "../../databaseSafeText";
import { MessengerDomainError } from "./errors";

const maximumMessageCodePoints = 8_000;
const maximumIdentifierLength = 180;
const maximumPageSize = 100;
const defaultPageSize = 50;
const maximumSequence = BigInt("9223372036854775807");
const prohibitedControlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const messengerReactionEmoji = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "🚀"] as const;

export type MessengerReactionEmoji = typeof messengerReactionEmoji[number];

export type MessengerSendInput = {
  attachmentIds?: string[];
  aiAttachmentIds?: string[];
  body: string | null;
  clientRequestId: string;
};

export type MessengerAttachmentReservationInput = {
  byteSize: number;
  declaredContentType: string;
  fileName: string;
  kind: "file" | "image" | "video";
};

export type MessengerAttachmentCompletionInput = {
  checksum: string | null;
  etag: string;
};

export type MessengerHistoryQuery = {
  afterSequence: bigint | null;
  beforeSequence: bigint | null;
  limit: number;
};

export type MessengerReceiptInput = {
  deliveredThroughSequence?: bigint;
  readThroughSequence?: bigint;
};

export type MessengerDirectConversationInput = {
  recipientUserId: string;
};

export type MessengerTypingInput = {
  active: boolean;
};

type SearchParams = {
  get(name: string): string | null;
};

export function parseMessengerSendInput(value: unknown): MessengerSendInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["body", "clientRequestId", "attachmentIds", "aiAttachmentIds"]);
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  const aiAttachmentIds = parseAttachmentIds(body.aiAttachmentIds);
  if (aiAttachmentIds.length > 3) {
    throw new MessengerDomainError("ai_attachment_limit_exceeded", "At most three attachments can be selected for AI", 422);
  }
  if (aiAttachmentIds.some((attachmentId) => !attachmentIds.includes(attachmentId))) {
    throw new MessengerDomainError("ai_attachment_consent_required", "AI attachments must belong to this message", 422);
  }
  const normalizedBody = body.body === undefined || body.body === null || body.body === ""
    ? null
    : normalizeMessengerBody(body.body);
  if (!normalizedBody && attachmentIds.length === 0) {
    throw new MessengerDomainError("invalid_message", "Message body or attachment is required", 400);
  }
  return {
    attachmentIds,
    aiAttachmentIds,
    body: normalizedBody,
    clientRequestId: parseClientRequestId(body.clientRequestId)
  };
}

export function parseMessengerDirectConversationInput(value: unknown): MessengerDirectConversationInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["recipientUserId"]);
  if (typeof body.recipientUserId !== "string" || !body.recipientUserId || body.recipientUserId.length > maximumIdentifierLength || !isDatabaseSafeText(body.recipientUserId)) {
    throw new MessengerDomainError("invalid_recipient", "recipientUserId is invalid", 400);
  }
  return { recipientUserId: body.recipientUserId };
}

export function parseMessengerTypingInput(value: unknown): MessengerTypingInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["active"]);
  if (typeof body.active !== "boolean") throw new MessengerDomainError("invalid_request", "active must be a boolean", 400);
  return { active: body.active };
}

export function parseMessengerAttachmentReservationInput(value: unknown): MessengerAttachmentReservationInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["byteSize", "declaredContentType", "fileName"]);
  if (typeof body.fileName !== "string") throw new MessengerDomainError("invalid_attachment", "fileName must be a string", 400);
  const fileName = normalizeAttachmentFileName(body.fileName);
  if (typeof body.declaredContentType !== "string") throw new MessengerDomainError("invalid_attachment", "declaredContentType must be a string", 400);
  const declaredContentType = body.declaredContentType.trim().toLowerCase();
  const policy = messengerAttachmentTypes[declaredContentType];
  if (!policy) throw new MessengerDomainError("invalid_attachment", "Attachment type is not supported", 400);
  if (typeof body.byteSize !== "number" || !Number.isSafeInteger(body.byteSize) || body.byteSize < 1 || body.byteSize > policy.maximumBytes) {
    throw new MessengerDomainError("invalid_attachment", "Attachment size is not supported", 400);
  }
  return { byteSize: body.byteSize, declaredContentType, fileName, kind: policy.kind };
}

export function parseMessengerAttachmentCompletionInput(value: unknown): MessengerAttachmentCompletionInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["checksum", "etag"]);
  if (typeof body.etag !== "string" || !/^[A-Za-z0-9"._:-]{1,256}$/u.test(body.etag)) {
    throw new MessengerDomainError("invalid_attachment", "etag is invalid", 400);
  }
  if (body.checksum !== undefined && body.checksum !== null && (typeof body.checksum !== "string" || !/^[A-Za-z0-9+/=_-]{32,128}$/u.test(body.checksum))) {
    throw new MessengerDomainError("invalid_attachment", "checksum is invalid", 400);
  }
  return { checksum: typeof body.checksum === "string" ? body.checksum : null, etag: body.etag };
}

export function normalizeMessengerBody(value: unknown) {
  if (typeof value !== "string") {
    throw new MessengerDomainError("invalid_message", "body must be a string", 400);
  }
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (!normalized || !isDatabaseSafeText(normalized) || prohibitedControlCharacters.test(normalized)) {
    throw new MessengerDomainError("invalid_message", "Message body contains invalid characters", 400);
  }
  if ([...normalized].length > maximumMessageCodePoints) {
    throw new MessengerDomainError("message_too_large", `Message body exceeds ${maximumMessageCodePoints} characters`, 413);
  }
  return normalized;
}

export function parseClientRequestId(value: unknown) {
  if (typeof value !== "string" || !uuidV4Pattern.test(value)) {
    throw new MessengerDomainError("invalid_message", "clientRequestId must be a UUID v4", 400);
  }
  return value.toLowerCase();
}

export function parseMessengerHistoryQuery(searchParams: SearchParams): MessengerHistoryQuery {
  const beforeSequence = parseOptionalSequence(searchParams.get("beforeSequence"), false);
  const afterSequence = parseOptionalSequence(searchParams.get("afterSequence"), true);
  if (beforeSequence !== null && afterSequence !== null) {
    throw new MessengerDomainError("invalid_cursor", "Use either beforeSequence or afterSequence", 400);
  }
  return {
    afterSequence,
    beforeSequence,
    limit: parseLimit(searchParams.get("limit"), defaultPageSize)
  };
}

export function parseConversationListQuery(searchParams: SearchParams) {
  const cursor = searchParams.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 512 || !isDatabaseSafeText(cursor))) {
    throw new MessengerDomainError("invalid_cursor", "Conversation cursor is invalid", 400);
  }
  return {
    cursor,
    limit: parseLimit(searchParams.get("limit"), 30)
  };
}

export function parseMessengerReceiptInput(value: unknown): MessengerReceiptInput {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["deliveredThroughSequence", "readThroughSequence"]);
  const deliveredThroughSequence = parseOptionalSequenceValue(body.deliveredThroughSequence);
  const readThroughSequence = parseOptionalSequenceValue(body.readThroughSequence);
  if (deliveredThroughSequence === undefined && readThroughSequence === undefined) {
    throw new MessengerDomainError("invalid_cursor", "At least one receipt cursor is required", 400);
  }
  return { deliveredThroughSequence, readThroughSequence };
}

export function parseMessengerReactionInput(value: unknown): MessengerReactionEmoji {
  const body = requireRecord(value);
  rejectUnknownFields(body, ["emoji"]);
  if (typeof body.emoji !== "string" || !messengerReactionEmoji.includes(body.emoji as MessengerReactionEmoji)) {
    throw new MessengerDomainError("invalid_reaction", "Reaction is not supported", 400);
  }
  return body.emoji as MessengerReactionEmoji;
}

export function parseMessengerPathIdentifier(value: string, field: string) {
  if (!value || value.length > maximumIdentifierLength || !isDatabaseSafeText(value)) {
    throw new MessengerDomainError("invalid_request", `${field} is invalid`, 400);
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessengerDomainError("invalid_request", "Request body must be an object", 400);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[]) {
  const allowedFields = new Set(allowed);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new MessengerDomainError("invalid_request", "Request body contains unsupported fields", 400);
  }
}

function parseAttachmentIds(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some((item) => typeof item !== "string" || !item || item.length > maximumIdentifierLength)) {
    throw new MessengerDomainError("invalid_attachment", "attachmentIds must contain at most 10 identifiers", 400);
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new MessengerDomainError("invalid_attachment", "attachmentIds must be unique", 400);
  return ids;
}

function normalizeAttachmentFileName(value: string) {
  const normalized = value.replace(/\\/gu, "/").split("/").at(-1)?.normalize("NFC").trim() ?? "";
  if (!normalized || normalized === "." || normalized === ".." || [...normalized].length > 255 || !isDatabaseSafeText(normalized) || prohibitedControlCharacters.test(normalized)) {
    throw new MessengerDomainError("invalid_attachment", "fileName is invalid", 400);
  }
  return normalized;
}

const messengerAttachmentTypes: Record<string, { kind: "file" | "image" | "video"; maximumBytes: number }> = {
  "application/json": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "application/pdf": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "image/gif": { kind: "image", maximumBytes: 20 * 1024 * 1024 },
  "image/jpeg": { kind: "image", maximumBytes: 20 * 1024 * 1024 },
  "image/png": { kind: "image", maximumBytes: 20 * 1024 * 1024 },
  "image/webp": { kind: "image", maximumBytes: 20 * 1024 * 1024 },
  "text/csv": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "text/markdown": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "text/plain": { kind: "file", maximumBytes: 50 * 1024 * 1024 },
  "video/mp4": { kind: "video", maximumBytes: 250 * 1024 * 1024 },
  "video/webm": { kind: "video", maximumBytes: 250 * 1024 * 1024 }
};

function parseLimit(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    throw new MessengerDomainError("invalid_cursor", "limit is invalid", 400);
  }
  const parsed = Number(value);
  if (parsed > maximumPageSize) {
    throw new MessengerDomainError("invalid_cursor", `limit must not exceed ${maximumPageSize}`, 400);
  }
  return parsed;
}

function parseOptionalSequence(value: string | null, allowZero: boolean) {
  if (value === null || value === "") return null;
  return parseSequence(value, allowZero);
}

function parseOptionalSequenceValue(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new MessengerDomainError("invalid_cursor", "Receipt cursors must be decimal strings", 400);
  }
  return parseSequence(value, true);
}

function parseSequence(value: string, allowZero: boolean) {
  const pattern = allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (!pattern.test(value)) {
    throw new MessengerDomainError("invalid_cursor", "Sequence cursor is invalid", 400);
  }
  const sequence = BigInt(value);
  if (sequence > maximumSequence) {
    throw new MessengerDomainError("invalid_cursor", "Sequence cursor is outside the supported range", 400);
  }
  return sequence;
}
