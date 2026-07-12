export const messengerReactionEmoji = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "🚀"] as const;

export type MessengerReactionEmoji = typeof messengerReactionEmoji[number];
export type MessengerSequence = string;
export type MessengerAuthorKind = "member" | "slate_ai" | "system";
export type MessengerConversationKind = "direct" | "general";
export type MessengerMembershipState = "active" | "revoked";

export type MessengerAuthor = {
  color: string;
  email: string | null;
  id: string | null;
  initials: string;
  kind: MessengerAuthorKind;
  name: string;
};

export type MessengerReactionSummary = {
  count: number;
  emoji: MessengerReactionEmoji;
  ownReactionId: string | null;
  reactors: MessengerReactionActor[];
};

export type MessengerReactionActor = {
  color: string;
  id: string;
  initials: string;
  name: string;
};

export type MessengerMessage = {
  attachments: MessengerAttachment[];
  aiInvocation: MessengerAiInvocation | null;
  author: MessengerAuthor;
  body: string | null;
  clientRequestId: string | null;
  conversationId: string;
  createdAt: string;
  id: string;
  inReplyToMessageId: string | null;
  reactions: MessengerReactionSummary[];
  sequence: MessengerSequence;
};

export type MessengerAttachment = {
  byteSize: MessengerSequence;
  contentType: string;
  durationMs: number | null;
  fileName: string;
  height: number | null;
  id: string;
  kind: "file" | "image" | "video";
  status: "attached";
  width: number | null;
};

export type MessengerUploadAttachmentStatus = "deleting" | "expired" | "ready" | "rejected" | "reserved" | "scanning" | "uploaded";

export type MessengerUploadAttachment = {
  byteSize: MessengerSequence;
  contentType: string;
  createdAt: string;
  durationMs: number | null;
  expiresAt: string;
  fileName: string;
  height: number | null;
  id: string;
  kind: "file" | "image" | "video";
  rejectionCode: string | null;
  status: MessengerUploadAttachmentStatus;
  width: number | null;
};

export type MessengerUploadOperation = {
  expiresAt: string;
  fields: Record<string, string>;
  headers: null;
  method: "POST";
  url: string;
};

export type MessengerAttachmentReservation = {
  attachment: MessengerUploadAttachment;
  upload: MessengerUploadOperation;
};

export type MessengerParticipant = {
  color: string;
  email: string;
  id: string;
  initials: string;
  joinedAt: string;
  name: string;
  state: MessengerMembershipState;
  userId: string;
};

export type MessengerConversationCapabilities = {
  canReact: boolean;
  canRead: boolean;
  canSend: boolean;
};

export type MessengerConversation = {
  activatedAt: string | null;
  capabilities: MessengerConversationCapabilities;
  id: string;
  kind: MessengerConversationKind;
  lastMessage: MessengerMessage | null;
  lastMessageAt: string | null;
  lastMessageSequence: MessengerSequence;
  participants: MessengerParticipant[];
  receipt: MessengerReceipt | null;
  retainedFromSequence: MessengerSequence;
  title: string;
  unreadCount: number;
  workspaceId: string;
};

export type MessengerUnread = {
  byConversation: Array<{
    conversationId: string;
    unreadCount: number;
  }>;
  total: number;
};

export type MessengerConversationPage = {
  conversations: MessengerConversation[];
  nextCursor: string | null;
};

export type MessengerDirectConversationResult = {
  conversation: MessengerConversation;
};

export type MessengerHistoryPage = {
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  messages: MessengerMessage[];
  newestSequence: MessengerSequence | null;
  oldestSequence: MessengerSequence | null;
  retainedFromSequence: MessengerSequence;
  resolvedThroughSequence: MessengerSequence;
  serverLastSequence: MessengerSequence;
};

export type MessengerSendResult = {
  aiInvocation: MessengerAiInvocation | null;
  message: MessengerMessage;
  replayed: boolean;
};

export type MessengerAiInvocation = {
  canOpenAssistant: boolean;
  errorCode: string | null;
  handoffCreated: boolean;
  id: string;
  responseMessageId: string | null;
  sourceMessageId: string;
  status: "skipped" | "queued" | "running" | "completed" | "failed" | "cancelled";
};

export type MessengerReceipt = {
  deliveredAt: string | null;
  deliveredThroughSequence: MessengerSequence;
  readAt: string | null;
  readThroughSequence: MessengerSequence;
  userId: string;
};

export type MessengerReaction = {
  createdAt: string;
  emoji: MessengerReactionEmoji;
  id: string;
  messageId: string;
  userId: string;
};

export type MessengerRealtimeAuthorization = {
  expiresAt: string;
  grant: string;
  protocolVersion: 1;
  socketUrl: string;
};

export type MessengerRealtimeEventType = "ai.invocation.changed" | "attachment.changed" | "conversation.added" | "conversation.changed" | "message.created" | "reaction.changed" | "receipt.changed" | "typing.changed";

export type MessengerRealtimeEvent = {
  conversationId: string | null;
  eventId: string;
  occurredAt: string;
  payload: Record<string, string | number>;
  type: MessengerRealtimeEventType;
  v: 1;
  workspaceId: string;
};

export class MessengerContractError extends Error {
  constructor(readonly field: string) {
    super(`Invalid Messenger response field: ${field}`);
    this.name = "MessengerContractError";
  }
}

const maximumSequence = "9223372036854775807";
const sequencePattern = /^(0|[1-9][0-9]*)$/;

export function parseMessengerSequence(value: unknown, field = "sequence", allowZero = true): MessengerSequence {
  if (typeof value !== "string" || !sequencePattern.test(value) || (!allowZero && value === "0")) {
    throw new MessengerContractError(field);
  }
  if (value.length > maximumSequence.length || (value.length === maximumSequence.length && value > maximumSequence)) {
    throw new MessengerContractError(field);
  }
  return value;
}

export function compareMessengerSequences(left: MessengerSequence, right: MessengerSequence) {
  const validLeft = parseMessengerSequence(left, "leftSequence");
  const validRight = parseMessengerSequence(right, "rightSequence");
  if (validLeft.length !== validRight.length) return validLeft.length < validRight.length ? -1 : 1;
  if (validLeft === validRight) return 0;
  return validLeft < validRight ? -1 : 1;
}

export function parseMessengerUnread(value: unknown): MessengerUnread {
  const record = requireRecord(value, "unread");
  return {
    byConversation: requireArray(record.byConversation, "unread.byConversation").map((entry, index) => {
      const item = requireRecord(entry, `unread.byConversation.${index}`);
      return {
        conversationId: requireIdentifier(item.conversationId, `unread.byConversation.${index}.conversationId`),
        unreadCount: requireNonNegativeInteger(item.unreadCount, `unread.byConversation.${index}.unreadCount`)
      };
    }),
    total: requireNonNegativeInteger(record.total, "unread.total")
  };
}

export function parseMessengerConversationPage(value: unknown): MessengerConversationPage {
  const record = requireRecord(value, "conversationPage");
  return {
    conversations: requireArray(record.conversations, "conversationPage.conversations").map((conversation, index) => (
      parseMessengerConversation(conversation, `conversationPage.conversations.${index}`)
    )),
    nextCursor: requireNullableString(record.nextCursor, "conversationPage.nextCursor")
  };
}

export function parseMessengerDirectConversationResult(value: unknown): MessengerDirectConversationResult {
  const record = requireRecord(value, "directConversationResult");
  return { conversation: parseMessengerConversation(record.conversation, "directConversationResult.conversation") };
}

export function parseMessengerHistoryPage(value: unknown): MessengerHistoryPage {
  const record = requireRecord(value, "historyPage");
  return {
    hasMoreAfter: requireBoolean(record.hasMoreAfter, "historyPage.hasMoreAfter"),
    hasMoreBefore: requireBoolean(record.hasMoreBefore, "historyPage.hasMoreBefore"),
    messages: requireArray(record.messages, "historyPage.messages").map((message, index) => (
      parseMessengerMessage(message, `historyPage.messages.${index}`)
    )),
    newestSequence: parseNullableSequence(record.newestSequence, "historyPage.newestSequence"),
    oldestSequence: parseNullableSequence(record.oldestSequence, "historyPage.oldestSequence"),
    retainedFromSequence: parseMessengerSequence(record.retainedFromSequence, "historyPage.retainedFromSequence", false),
    resolvedThroughSequence: parseMessengerSequence(record.resolvedThroughSequence, "historyPage.resolvedThroughSequence"),
    serverLastSequence: parseMessengerSequence(record.serverLastSequence, "historyPage.serverLastSequence")
  };
}

export function parseMessengerSendResult(value: unknown): MessengerSendResult {
  const record = requireRecord(value, "sendResult");
  return {
    aiInvocation: record.aiInvocation === null || record.aiInvocation === undefined ? null : parseMessengerAiInvocation(record.aiInvocation, "sendResult.aiInvocation"),
    message: parseMessengerMessage(record.message, "sendResult.message"),
    replayed: requireBoolean(record.replayed, "sendResult.replayed")
  };
}

export function parseMessengerAiInvocation(value: unknown, field = "aiInvocation"): MessengerAiInvocation {
  const record = requireRecord(value, field);
  return {
    canOpenAssistant: requireBoolean(record.canOpenAssistant, `${field}.canOpenAssistant`),
    errorCode: requireNullableString(record.errorCode, `${field}.errorCode`),
    handoffCreated: requireBoolean(record.handoffCreated, `${field}.handoffCreated`),
    id: requireIdentifier(record.id, `${field}.id`),
    responseMessageId: requireNullableIdentifier(record.responseMessageId, `${field}.responseMessageId`),
    sourceMessageId: requireIdentifier(record.sourceMessageId, `${field}.sourceMessageId`),
    status: requireEnum(record.status, ["skipped", "queued", "running", "completed", "failed", "cancelled"] as const, `${field}.status`)
  };
}

export function parseMessengerAiInvocationResult(value: unknown) {
  const record = requireRecord(value, "aiInvocationResult");
  return parseMessengerAiInvocation(record.aiInvocation, "aiInvocationResult.aiInvocation");
}

export function parseMessengerAttachmentReservation(value: unknown): MessengerAttachmentReservation {
  const record = requireRecord(value, "attachmentReservation");
  const upload = requireRecord(record.upload, "attachmentReservation.upload");
  const fields = requireRecord(upload.fields, "attachmentReservation.upload.fields");
  const parsedFields: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(fields)) parsedFields[key] = requireString(fieldValue, `attachmentReservation.upload.fields.${key}`);
  return {
    attachment: parseMessengerUploadAttachment(record.attachment, "attachmentReservation.attachment"),
    upload: {
      expiresAt: requireTimestamp(upload.expiresAt, "attachmentReservation.upload.expiresAt"),
      fields: parsedFields,
      headers: requireNull(upload.headers, "attachmentReservation.upload.headers"),
      method: requireEnum(upload.method, ["POST"] as const, "attachmentReservation.upload.method"),
      url: requireHttpUrl(upload.url, "attachmentReservation.upload.url")
    }
  };
}

export function parseMessengerAttachmentResult(value: unknown): MessengerUploadAttachment {
  const record = requireRecord(value, "attachmentResult");
  return parseMessengerUploadAttachment(record.attachment, "attachmentResult.attachment");
}

export function parseMessengerReceiptResult(value: unknown): MessengerReceipt {
  const record = requireRecord(value, "receiptResult");
  return parseMessengerReceipt(record.receipt, "receiptResult.receipt");
}

export function parseMessengerReactionResult(value: unknown): MessengerReaction {
  const record = requireRecord(value, "reactionResult");
  return parseMessengerReaction(record.reaction, "reactionResult.reaction");
}

export function parseMessengerReactionRemovalResult(value: unknown) {
  const record = requireRecord(value, "reactionRemovalResult");
  const reaction = requireRecord(record.reaction, "reactionRemovalResult.reaction");
  return { id: requireIdentifier(reaction.id, "reactionRemovalResult.reaction.id") };
}

export function parseMessengerRealtimeAuthorization(value: unknown): MessengerRealtimeAuthorization {
  const record = requireRecord(value, "realtimeAuthorization");
  return {
    expiresAt: requireTimestamp(record.expiresAt, "realtimeAuthorization.expiresAt"),
    grant: requireBoundedString(record.grant, 1, 8_192, "realtimeAuthorization.grant"),
    protocolVersion: requireLiteralOne(record.protocolVersion, "realtimeAuthorization.protocolVersion"),
    socketUrl: requireSocketUrl(record.socketUrl, "realtimeAuthorization.socketUrl")
  };
}

export function parseMessengerRealtimeFrame(value: unknown): MessengerRealtimeEvent | { expiresAt: string; type: "ready"; v: 1 } {
  const record = requireRecord(value, "realtimeFrame");
  if (record.type === "ready") {
    requireExactKeys(record, ["expiresAt", "type", "v"], "realtimeFrame");
    return { expiresAt: requireTimestamp(record.expiresAt, "realtimeFrame.expiresAt"), type: "ready", v: requireLiteralOne(record.v, "realtimeFrame.v") };
  }
  requireExactKeys(record, ["conversationId", "eventId", "occurredAt", "payload", "type", "v", "workspaceId"], "realtimeFrame");
  const type = requireEnum(record.type, ["ai.invocation.changed", "attachment.changed", "conversation.added", "conversation.changed", "message.created", "reaction.changed", "receipt.changed", "typing.changed"] as const, "realtimeFrame.type");
  const payloadRecord = requireRecord(record.payload, "realtimeFrame.payload");
  const payload: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(payloadRecord)) {
    if (typeof item !== "string" && (typeof item !== "number" || !Number.isSafeInteger(item))) throw new MessengerContractError(`realtimeFrame.payload.${key}`);
    payload[key] = item;
  }
  return {
    conversationId: requireNullableIdentifier(record.conversationId, "realtimeFrame.conversationId"),
    eventId: requireIdentifier(record.eventId, "realtimeFrame.eventId"),
    occurredAt: requireTimestamp(record.occurredAt, "realtimeFrame.occurredAt"),
    payload,
    type,
    v: requireLiteralOne(record.v, "realtimeFrame.v"),
    workspaceId: requireIdentifier(record.workspaceId, "realtimeFrame.workspaceId")
  };
}

function parseMessengerConversation(value: unknown, field: string): MessengerConversation {
  const record = requireRecord(value, field);
  return {
    activatedAt: parseNullableTimestamp(record.activatedAt, `${field}.activatedAt`),
    capabilities: parseCapabilities(record.capabilities, `${field}.capabilities`),
    id: requireIdentifier(record.id, `${field}.id`),
    kind: requireEnum(record.kind, ["direct", "general"] as const, `${field}.kind`),
    lastMessage: record.lastMessage === null ? null : parseMessengerMessage(record.lastMessage, `${field}.lastMessage`),
    lastMessageAt: parseNullableTimestamp(record.lastMessageAt, `${field}.lastMessageAt`),
    lastMessageSequence: parseMessengerSequence(record.lastMessageSequence, `${field}.lastMessageSequence`),
    participants: requireArray(record.participants, `${field}.participants`).map((participant, index) => (
      parseParticipant(participant, `${field}.participants.${index}`)
    )),
    receipt: record.receipt === null ? null : parseMessengerReceipt(record.receipt, `${field}.receipt`),
    retainedFromSequence: parseMessengerSequence(record.retainedFromSequence, `${field}.retainedFromSequence`, false),
    title: requireString(record.title, `${field}.title`),
    unreadCount: requireNonNegativeInteger(record.unreadCount, `${field}.unreadCount`),
    workspaceId: requireIdentifier(record.workspaceId, `${field}.workspaceId`)
  };
}

function parseMessengerMessage(value: unknown, field: string): MessengerMessage {
  const record = requireRecord(value, field);
  return {
    attachments: requireArray(record.attachments, `${field}.attachments`).map((attachment, index) => (
      parseMessengerAttachment(attachment, `${field}.attachments.${index}`)
    )),
    aiInvocation: record.aiInvocation === null || record.aiInvocation === undefined ? null : parseMessengerAiInvocation(record.aiInvocation, `${field}.aiInvocation`),
    author: parseAuthor(record.author, `${field}.author`),
    body: requireNullableString(record.body, `${field}.body`),
    clientRequestId: requireNullableIdentifier(record.clientRequestId, `${field}.clientRequestId`),
    conversationId: requireIdentifier(record.conversationId, `${field}.conversationId`),
    createdAt: requireTimestamp(record.createdAt, `${field}.createdAt`),
    id: requireIdentifier(record.id, `${field}.id`),
    inReplyToMessageId: requireNullableIdentifier(record.inReplyToMessageId, `${field}.inReplyToMessageId`),
    reactions: requireArray(record.reactions, `${field}.reactions`).map((reaction, index) => (
      parseReactionSummary(reaction, `${field}.reactions.${index}`)
    )),
    sequence: parseMessengerSequence(record.sequence, `${field}.sequence`, false)
  };
}

function parseMessengerAttachment(value: unknown, field: string): MessengerAttachment {
  const record = requireRecord(value, field);
  return {
    byteSize: parseMessengerSequence(record.byteSize, `${field}.byteSize`, false),
    contentType: requireString(record.contentType, `${field}.contentType`),
    durationMs: requireNullableNonNegativeInteger(record.durationMs, `${field}.durationMs`),
    fileName: requireString(record.fileName, `${field}.fileName`),
    height: requireNullablePositiveInteger(record.height, `${field}.height`),
    id: requireIdentifier(record.id, `${field}.id`),
    kind: requireEnum(record.kind, ["file", "image", "video"] as const, `${field}.kind`),
    status: requireEnum(record.status, ["attached"] as const, `${field}.status`),
    width: requireNullablePositiveInteger(record.width, `${field}.width`)
  };
}

function parseMessengerUploadAttachment(value: unknown, field: string): MessengerUploadAttachment {
  const record = requireRecord(value, field);
  return {
    byteSize: parseMessengerSequence(record.byteSize, `${field}.byteSize`, false),
    contentType: requireString(record.contentType, `${field}.contentType`),
    createdAt: requireTimestamp(record.createdAt, `${field}.createdAt`),
    durationMs: requireNullableNonNegativeInteger(record.durationMs, `${field}.durationMs`),
    expiresAt: requireTimestamp(record.expiresAt, `${field}.expiresAt`),
    fileName: requireString(record.fileName, `${field}.fileName`),
    height: requireNullablePositiveInteger(record.height, `${field}.height`),
    id: requireIdentifier(record.id, `${field}.id`),
    kind: requireEnum(record.kind, ["file", "image", "video"] as const, `${field}.kind`),
    rejectionCode: requireNullableString(record.rejectionCode, `${field}.rejectionCode`),
    status: requireEnum(record.status, ["deleting", "expired", "ready", "rejected", "reserved", "scanning", "uploaded"] as const, `${field}.status`),
    width: requireNullablePositiveInteger(record.width, `${field}.width`)
  };
}

function parseAuthor(value: unknown, field: string): MessengerAuthor {
  const record = requireRecord(value, field);
  return {
    color: requireString(record.color, `${field}.color`),
    email: requireNullableString(record.email, `${field}.email`),
    id: requireNullableIdentifier(record.id, `${field}.id`),
    initials: requireString(record.initials, `${field}.initials`),
    kind: requireEnum(record.kind, ["member", "slate_ai", "system"] as const, `${field}.kind`),
    name: requireString(record.name, `${field}.name`)
  };
}

function parseReactionSummary(value: unknown, field: string): MessengerReactionSummary {
  const record = requireRecord(value, field);
  return {
    count: requirePositiveInteger(record.count, `${field}.count`),
    emoji: requireEnum(record.emoji, messengerReactionEmoji, `${field}.emoji`),
    ownReactionId: requireNullableIdentifier(record.ownReactionId, `${field}.ownReactionId`),
    reactors: requireArray(record.reactors, `${field}.reactors`).map((reactor, index) => (
      parseReactionActor(reactor, `${field}.reactors.${index}`)
    ))
  };
}

function parseReactionActor(value: unknown, field: string): MessengerReactionActor {
  const record = requireRecord(value, field);
  return {
    color: requireString(record.color, `${field}.color`),
    id: requireIdentifier(record.id, `${field}.id`),
    initials: requireString(record.initials, `${field}.initials`),
    name: requireString(record.name, `${field}.name`)
  };
}

function parseParticipant(value: unknown, field: string): MessengerParticipant {
  const record = requireRecord(value, field);
  return {
    color: requireString(record.color, `${field}.color`),
    email: requireString(record.email, `${field}.email`),
    id: requireIdentifier(record.id, `${field}.id`),
    initials: requireString(record.initials, `${field}.initials`),
    joinedAt: requireTimestamp(record.joinedAt, `${field}.joinedAt`),
    name: requireString(record.name, `${field}.name`),
    state: requireEnum(record.state, ["active", "revoked"] as const, `${field}.state`),
    userId: requireIdentifier(record.userId, `${field}.userId`)
  };
}

function parseCapabilities(value: unknown, field: string): MessengerConversationCapabilities {
  const record = requireRecord(value, field);
  return {
    canReact: requireBoolean(record.canReact, `${field}.canReact`),
    canRead: requireBoolean(record.canRead, `${field}.canRead`),
    canSend: requireBoolean(record.canSend, `${field}.canSend`)
  };
}

function parseMessengerReceipt(value: unknown, field: string): MessengerReceipt {
  const record = requireRecord(value, field);
  return {
    deliveredAt: parseNullableTimestamp(record.deliveredAt, `${field}.deliveredAt`),
    deliveredThroughSequence: parseMessengerSequence(record.deliveredThroughSequence, `${field}.deliveredThroughSequence`),
    readAt: parseNullableTimestamp(record.readAt, `${field}.readAt`),
    readThroughSequence: parseMessengerSequence(record.readThroughSequence, `${field}.readThroughSequence`),
    userId: requireIdentifier(record.userId, `${field}.userId`)
  };
}

function parseMessengerReaction(value: unknown, field: string): MessengerReaction {
  const record = requireRecord(value, field);
  return {
    createdAt: requireTimestamp(record.createdAt, `${field}.createdAt`),
    emoji: requireEnum(record.emoji, messengerReactionEmoji, `${field}.emoji`),
    id: requireIdentifier(record.id, `${field}.id`),
    messageId: requireIdentifier(record.messageId, `${field}.messageId`),
    userId: requireIdentifier(record.userId, `${field}.userId`)
  };
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MessengerContractError(field);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new MessengerContractError(field);
  return value;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string") throw new MessengerContractError(field);
  return value;
}

function requireBoundedString(value: unknown, minimum: number, maximum: number, field: string) {
  const result = requireString(value, field);
  if (result.length < minimum || result.length > maximum) throw new MessengerContractError(field);
  return result;
}

function requireLiteralOne(value: unknown, field: string): 1 {
  if (value !== 1) throw new MessengerContractError(field);
  return 1;
}

function requireExactKeys(record: Record<string, unknown>, keys: string[], field: string) {
  const expected = new Set(keys);
  if (Object.keys(record).length !== expected.size || Object.keys(record).some((key) => !expected.has(key))) throw new MessengerContractError(field);
}

function requireSocketUrl(value: unknown, field: string) {
  const result = requireString(value, field);
  try {
    const url = new URL(result);
    if (!new Set(["ws:", "wss:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return result;
  } catch {
    throw new MessengerContractError(field);
  }
}

function requireHttpUrl(value: unknown, field: string) {
  const result = requireString(value, field);
  try {
    const url = new URL(result);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash) throw new Error();
    return result;
  } catch {
    throw new MessengerContractError(field);
  }
}

function requireIdentifier(value: unknown, field: string) {
  const identifier = requireString(value, field);
  if (!identifier) throw new MessengerContractError(field);
  return identifier;
}

function requireNullableString(value: unknown, field: string) {
  if (value === null) return null;
  return requireString(value, field);
}

function requireNull(value: unknown, field: string): null {
  if (value !== null) throw new MessengerContractError(field);
  return null;
}

function requireNullableIdentifier(value: unknown, field: string) {
  if (value === null) return null;
  return requireIdentifier(value, field);
}

function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new MessengerContractError(field);
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new MessengerContractError(field);
  return value;
}

function requirePositiveInteger(value: unknown, field: string) {
  const integer = requireNonNegativeInteger(value, field);
  if (integer === 0) throw new MessengerContractError(field);
  return integer;
}

function requireNullableNonNegativeInteger(value: unknown, field: string) {
  if (value === null) return null;
  return requireNonNegativeInteger(value, field);
}

function requireNullablePositiveInteger(value: unknown, field: string) {
  if (value === null) return null;
  return requirePositiveInteger(value, field);
}

function requireTimestamp(value: unknown, field: string) {
  const timestamp = requireString(value, field);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) throw new MessengerContractError(field);
  return timestamp;
}

function parseNullableTimestamp(value: unknown, field: string) {
  if (value === null) return null;
  return requireTimestamp(value, field);
}

function parseNullableSequence(value: unknown, field: string) {
  if (value === null) return null;
  return parseMessengerSequence(value, field, false);
}

function requireEnum<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new MessengerContractError(field);
  return value as T[number];
}
