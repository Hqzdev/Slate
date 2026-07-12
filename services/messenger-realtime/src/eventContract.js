const eventTypes = new Set([
  "access.revoked",
  "attachment.changed",
  "capabilities.changed",
  "conversation.added",
  "conversation.changed",
  "message.created",
  "reaction.changed",
  "receipt.changed",
  "typing.changed"
]);
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;

export function createEnvelope(row) {
  if (!validIdentifier(row.eventId) || !eventTypes.has(row.type) || !validIdentifier(row.workspaceId)) throw new Error("Messenger outbox event contract is invalid");
  if (row.conversationId !== null && !validIdentifier(row.conversationId)) throw new Error("Messenger outbox conversation is invalid");
  if (row.targetUserId !== null && !validIdentifier(row.targetUserId)) throw new Error("Messenger outbox target is invalid");
  validatePayload(row.type, row.payload);
  return {
    conversationId: row.conversationId,
    eventId: row.eventId,
    occurredAt: new Date(row.createdAt).toISOString(),
    payload: row.payload,
    targetUserId: row.targetUserId,
    type: row.type,
    v: 1,
    workspaceId: row.workspaceId
  };
}

export function parseEnvelope(value) {
  if (!isRecord(value) || value.v !== 1 || Object.keys(value).length !== 8) return null;
  try {
    const envelope = createEnvelope({ ...value, createdAt: value.occurredAt });
    if (typeof value.occurredAt !== "string" || envelope.occurredAt !== value.occurredAt) return null;
    return envelope;
  } catch {
    return null;
  }
}

export function workspaceChannel(workspaceId) {
  if (!validIdentifier(workspaceId)) throw new Error("Workspace identifier is invalid");
  return `slate:messenger:workspace:${workspaceId}`;
}

function validatePayload(type, payload) {
  if (!isRecord(payload)) throw new Error("Messenger outbox payload is invalid");
  if (JSON.stringify(payload).length > 4_096) throw new Error("Messenger outbox payload is too large");
  const allowed = payloadKeys(type);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("Messenger outbox payload contains an unknown field");
  for (const [key, value] of Object.entries(payload)) {
    if (key === "accessVersion") {
      if (!positiveInteger(value)) throw new Error("Messenger access version is invalid");
    } else if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      throw new Error("Messenger outbox payload value is invalid");
    }
  }
  if (type === "typing.changed" && payload.active !== "start" && payload.active !== "stop") {
    throw new Error("Messenger typing state is invalid");
  }
}

function payloadKeys(type) {
  if (type === "attachment.changed") return new Set(["attachmentId", "status"]);
  if (type === "message.created" || type === "reaction.changed") return new Set(["messageId", "sequence"]);
  if (type === "conversation.changed") return new Set(["conversationId"]);
  if (type === "receipt.changed") return new Set(["deliveredThroughSequence", "readThroughSequence", "userId"]);
  if (type === "typing.changed") return new Set(["active", "userId"]);
  if (type === "conversation.added") return new Set(["conversationId", "membershipId", "reason", "userId"]);
  if (type === "access.revoked") return new Set(["accessVersion", "membershipId", "reason", "scope", "userId"]);
  return new Set(["accessVersion", "membershipId", "role", "userId"]);
}

function validIdentifier(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
