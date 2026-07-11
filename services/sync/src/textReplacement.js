import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as Y from "yjs";
import { maximumRealtimeStateBytes } from "./realtimeUpdateValidator.js";

const maximumContentLength = 262_144;
const maximumIdentifierLength = 191;
const maximumReceipts = 64;
const receiptMapName = "slate_internal";
const receiptMapKey = "textReplacementReceipts";
const supportedDocumentTypes = new Set(["code", "note"]);
const allowedRequestKeys = new Set([
  "actionId",
  "content",
  "documentId",
  "documentType",
  "expectedContentHash",
  "roomName",
  "workspaceId"
]);

export class TextReplacementError extends Error {
  constructor(code, message, status, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export class TextReplacementService {
  constructor({ applyUpdate = applyUpdateDirectly, getRoom, isAvailable = () => true, persistRoom, receiptSecret }) {
    this.applyUpdate = applyUpdate;
    this.getRoom = getRoom;
    this.isAvailable = isAvailable;
    this.persistRoom = persistRoom;
    this.receiptSecret = receiptSecret;
  }

  async execute(rawInput) {
    const input = parseTextReplacementInput(rawInput);
    this.requireAvailability();
    if (typeof this.receiptSecret !== "string" || this.receiptSecret.length < 32) {
      throw new TextReplacementError("internal_auth_unavailable", "Internal sync authentication is not configured", 503);
    }
    const room = await this.getRoom(input.roomName);
    return runSerialized(room, async () => {
      this.requireAvailability();
      const workingDocument = this.createWorkingDocument(room, input.documentType);
      try {
        const text = workingDocument.document.getText(textKeyForDocumentType(input.documentType));
        const receiptMap = workingDocument.document.getMap(receiptMapName);
        const receipts = readReceipts(receiptMap.get(receiptMapKey), this.receiptSecret);
        const existingReceipt = receipts.find((receipt) => receipt.actionId === input.actionId);
        const contentHash = sha256Text(input.content);

        if (existingReceipt) {
          if (!receiptMatchesInput(existingReceipt, input, contentHash)) {
            throw new TextReplacementError("idempotency_conflict", "actionId was already used for a different document update", 409);
          }
          if (!await this.persistRoom(room)) {
            throw new TextReplacementError("persistence_failed", "Realtime document persistence failed", 503);
          }
          return resultPayload(input, contentHash, false);
        }

        const currentContent = text.toString();
        const currentContentHash = sha256Text(currentContent);

        if (currentContentHash !== contentHash && currentContentHash !== input.expectedContentHash) {
          throw new TextReplacementError("document_changed", "Document content changed after the draft was created", 409, {
            currentContentHash
          });
        }

        const applied = currentContentHash !== contentHash;
        const receipt = createReceipt(input, contentHash, this.receiptSecret);
        workingDocument.document.transact(() => {
          if (applied) {
            replaceTextWithMinimalSplice(text, input.content);
          }
          receiptMap.set(receiptMapKey, [...receipts, receipt].slice(-maximumReceipts));
        });
        const update = Y.encodeStateAsUpdate(workingDocument.document, workingDocument.stateVector);
        if (!this.applyUpdate(room, update)) {
          throw new TextReplacementError("realtime_state_limit", "Realtime document state exceeds the maximum size", 413);
        }

        if (!await this.persistRoom(room)) {
          throw new TextReplacementError("persistence_failed", "Realtime document persistence failed", 503);
        }

        return resultPayload(input, contentHash, applied);
      } finally {
        workingDocument.document.destroy();
      }
    });
  }

  createWorkingDocument(room, documentType) {
    const encodedState = Y.encodeStateAsUpdate(room.doc);
    if (encodedState.byteLength > maximumRealtimeStateBytes) {
      throw new TextReplacementError("realtime_state_limit", "Realtime document state exceeds the maximum size", 413);
    }
    const document = new Y.Doc();
    try {
      document.getText(textKeyForDocumentType(documentType));
      Y.applyUpdate(document, encodedState);
      document.getMap(receiptMapName);
      return {
        document,
        stateVector: Y.encodeStateVector(document)
      };
    } catch (error) {
      document.destroy();
      throw error;
    }
  }

  requireAvailability() {
    if (!this.isAvailable()) {
      throw new TextReplacementError("realtime_unavailable", "Realtime service is shutting down", 503);
    }
  }
}

function applyUpdateDirectly(room, update) {
  try {
    const currentState = Y.encodeStateAsUpdate(room.doc);
    if (currentState.byteLength + update.byteLength > maximumRealtimeStateBytes) return false;
    Y.applyUpdate(room.doc, update);
    return true;
  } catch {
    return false;
  }
}

export function parseRoomName(roomName) {
  if (typeof roomName !== "string") return null;
  const match = roomName.match(/^slate:room:([^:]+):(file|note|canvas):([^:]+)$/);
  if (!match) return null;
  const documentTypeByRoomType = {
    canvas: "canvas",
    file: "code",
    note: "note"
  };
  return {
    documentId: match[3],
    documentType: documentTypeByRoomType[match[2]],
    roomType: match[2],
    workspaceId: match[1]
  };
}

export function canonicalDocumentWhere(parsedRoom) {
  return {
    archivedAt: null,
    id: parsedRoom.documentId,
    type: parsedRoom.documentType,
    workspaceId: parsedRoom.workspaceId
  };
}

export function parseTextReplacementInput(value) {
  const record = requireRecord(value);
  const unknownKey = Object.keys(record).find((key) => !allowedRequestKeys.has(key));
  const missingKey = Array.from(allowedRequestKeys).find((key) => !(key in record));
  if (unknownKey || missingKey) {
    throw new TextReplacementError("invalid_request", "Request fields do not match the text replacement contract", 400);
  }

  const actionId = parseIdentifier(record.actionId, "actionId");
  const workspaceId = parseIdentifier(record.workspaceId, "workspaceId");
  const documentId = parseIdentifier(record.documentId, "documentId");
  const documentType = parseDocumentType(record.documentType);
  const roomName = parseString(record.roomName, "roomName", 768);
  const expectedContentHash = parseContentHash(record.expectedContentHash);
  const content = parseContent(record.content);
  const parsedRoom = parseRoomName(roomName);

  if (!parsedRoom) {
    throw new TextReplacementError("invalid_request", "roomName is invalid", 400);
  }
  if (documentType === "canvas" || parsedRoom.documentType === "canvas") {
    throw new TextReplacementError("unsupported_document_type", "Canvas text replacement is not supported", 422);
  }
  if (!supportedDocumentTypes.has(documentType)) {
    throw new TextReplacementError("unsupported_document_type", "Document type is not supported", 422);
  }
  if (parsedRoom.workspaceId !== workspaceId || parsedRoom.documentId !== documentId || parsedRoom.documentType !== documentType) {
    throw new TextReplacementError("invalid_request", "Room identity does not match the document", 400);
  }

  return {
    actionId,
    content,
    documentId,
    documentType,
    expectedContentHash,
    roomName,
    workspaceId
  };
}

export function replaceTextWithMinimalSplice(text, nextValue) {
  const currentValue = text.toString();
  if (currentValue === nextValue) return false;

  let start = 0;
  while (start < currentValue.length && start < nextValue.length && currentValue[start] === nextValue[start]) {
    start += 1;
  }
  if (start > 0 && isHighSurrogate(currentValue.charCodeAt(start - 1))) {
    start -= 1;
  }

  let currentEnd = currentValue.length;
  let nextEnd = nextValue.length;
  while (currentEnd > start && nextEnd > start && currentValue[currentEnd - 1] === nextValue[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }
  if (currentEnd < currentValue.length && isLowSurrogate(currentValue.charCodeAt(currentEnd))) {
    currentEnd += 1;
  }
  if (nextEnd < nextValue.length && isLowSurrogate(nextValue.charCodeAt(nextEnd))) {
    nextEnd += 1;
  }

  text.doc?.transact(() => {
    if (currentEnd > start) {
      text.delete(start, currentEnd - start);
    }
    if (nextEnd > start) {
      text.insert(start, nextValue.slice(start, nextEnd));
    }
  });
  return true;
}

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validBearerAuthorization(authorization, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function runSerialized(room, operation) {
  const preceding = room.textReplacementPromise ?? Promise.resolve();
  const result = preceding.catch(() => undefined).then(operation);
  room.textReplacementPromise = result.then(() => undefined, () => undefined);
  return result;
}

function requireRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TextReplacementError("invalid_request", "Request body must be an object", 400);
  }
  return value;
}

function parseDocumentType(value) {
  if (value === "code" || value === "note" || value === "canvas") return value;
  throw new TextReplacementError("unsupported_document_type", "Document type is not supported", 422);
}

function parseIdentifier(value, field) {
  const identifier = parseString(value, field, maximumIdentifierLength);
  if (identifier.includes(":")) {
    throw new TextReplacementError("invalid_request", `${field} is invalid`, 400);
  }
  return identifier;
}

function parseString(value, field, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || !isDatabaseSafeText(value)) {
    throw new TextReplacementError("invalid_request", `${field} is invalid`, 400);
  }
  return value;
}

function parseContentHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TextReplacementError("invalid_request", "expectedContentHash is invalid", 400);
  }
  return value;
}

function parseContent(value) {
  if (typeof value !== "string") {
    throw new TextReplacementError("invalid_request", "content must be a string", 400);
  }
  if (value.length > maximumContentLength) {
    throw new TextReplacementError("payload_too_large", "content exceeds the maximum length", 413);
  }
  if (!isDatabaseSafeText(value)) {
    throw new TextReplacementError("invalid_request", "content contains unsupported characters", 400);
  }
  return value;
}

function isDatabaseSafeText(value) {
  if (value.includes("\u0000")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode < 0xdc00 || nextCode > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function textKeyForDocumentType(documentType) {
  return documentType === "code" ? "source" : "note";
}

function resultPayload(input, contentHash, applied) {
  return {
    actionId: input.actionId,
    applied,
    contentHash,
    documentId: input.documentId,
    documentType: input.documentType,
    roomName: input.roomName
  };
}

function createReceipt(input, contentHash, secret) {
  const receipt = {
    actionId: input.actionId,
    contentHash,
    documentId: input.documentId,
    documentType: input.documentType,
    expectedContentHash: input.expectedContentHash,
    roomName: input.roomName,
    workspaceId: input.workspaceId
  };
  return {
    ...receipt,
    signature: signReceipt(receipt, secret)
  };
}

function readReceipts(value, secret) {
  if (!Array.isArray(value)) return [];
  return value.slice(-maximumReceipts).filter((receipt) => validReceipt(receipt, secret));
}

function validReceipt(value, secret) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value;
  if (
    typeof receipt.actionId !== "string"
    || typeof receipt.contentHash !== "string"
    || typeof receipt.documentId !== "string"
    || (receipt.documentType !== "code" && receipt.documentType !== "note")
    || typeof receipt.expectedContentHash !== "string"
    || typeof receipt.roomName !== "string"
    || typeof receipt.workspaceId !== "string"
    || typeof receipt.signature !== "string"
  ) {
    return false;
  }
  const expected = signReceipt(receipt, secret);
  const providedBuffer = Buffer.from(receipt.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function signReceipt(receipt, secret) {
  const payload = JSON.stringify([
    receipt.actionId,
    receipt.contentHash,
    receipt.documentId,
    receipt.documentType,
    receipt.expectedContentHash,
    receipt.roomName,
    receipt.workspaceId
  ]);
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function receiptMatchesInput(receipt, input, contentHash) {
  return receipt.contentHash === contentHash
    && receipt.documentId === input.documentId
    && receipt.documentType === input.documentType
    && receipt.expectedContentHash === input.expectedContentHash
    && receipt.roomName === input.roomName
    && receipt.workspaceId === input.workspaceId;
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}
