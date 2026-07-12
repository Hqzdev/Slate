import { compareMessengerSequences, type MessengerConversation, type MessengerMessage, type MessengerReceipt, type MessengerUploadAttachment } from "./messengerTypes";

export type PendingMessengerMessage = {
  aiAttachmentIds?: string[];
  attachments?: MessengerUploadAttachment[];
  body: string;
  clientRequestId: string;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryAt: number | null;
  status: "failed" | "sending";
};

export function normalizeMessengerDraft(value: string) {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export function countMessengerCodePoints(value: string) {
  return [...value].length;
}

export function mergeMessengerMessages(current: MessengerMessage[], incoming: MessengerMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => compareMessengerSequences(left.sequence, right.sequence));
}

export function retainMessengerMessages(messages: MessengerMessage[], retainedFromSequence: string) {
  return messages.filter((message) => compareMessengerSequences(message.sequence, retainedFromSequence) >= 0);
}

export function selectMessengerRevalidationMessages(current: MessengerMessage[], incoming: MessengerMessage[]) {
  const currentIds = new Set(current.map((message) => message.id));
  return incoming.filter((message) => currentIds.has(message.id));
}

export function mergeMessengerReceipt(current: MessengerReceipt | null, incoming: MessengerReceipt | null) {
  if (!current) return incoming;
  if (!incoming) return current;
  const deliveredUsesIncoming = compareMessengerSequences(incoming.deliveredThroughSequence, current.deliveredThroughSequence) >= 0;
  const readUsesIncoming = compareMessengerSequences(incoming.readThroughSequence, current.readThroughSequence) >= 0;
  return {
    deliveredAt: deliveredUsesIncoming ? incoming.deliveredAt : current.deliveredAt,
    deliveredThroughSequence: deliveredUsesIncoming ? incoming.deliveredThroughSequence : current.deliveredThroughSequence,
    readAt: readUsesIncoming ? incoming.readAt : current.readAt,
    readThroughSequence: readUsesIncoming ? incoming.readThroughSequence : current.readThroughSequence,
    userId: incoming.userId
  };
}

export function mergeMessengerConversationSnapshot(current: MessengerConversation | null, incoming: MessengerConversation) {
  if (!current || current.id !== incoming.id) return incoming;
  const incomingIsNewer = compareMessengerSequences(incoming.lastMessageSequence, current.lastMessageSequence) >= 0;
  return {
    ...incoming,
    lastMessage: incomingIsNewer ? incoming.lastMessage : current.lastMessage,
    lastMessageAt: incomingIsNewer ? incoming.lastMessageAt : current.lastMessageAt,
    lastMessageSequence: incomingIsNewer ? incoming.lastMessageSequence : current.lastMessageSequence,
    receipt: mergeMessengerReceipt(current.receipt, incoming.receipt),
    retainedFromSequence: maximumMessengerSequence(current.retainedFromSequence, incoming.retainedFromSequence)
  };
}

export function removeCanonicalPending(
  pending: PendingMessengerMessage[],
  message: MessengerMessage
) {
  if (!message.clientRequestId) return pending;
  return pending.filter((item) => item.clientRequestId !== message.clientRequestId);
}

export function isMessengerNearLatest(scrollHeight: number, scrollTop: number, clientHeight: number) {
  return scrollHeight - scrollTop - clientHeight <= 96;
}

export function shouldGroupMessengerMessages(previous: MessengerMessage | null, current: MessengerMessage) {
  if (!previous || previous.author.id !== current.author.id || previous.author.kind !== current.author.kind) return false;
  const previousTime = Date.parse(previous.createdAt);
  const currentTime = Date.parse(current.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;
  if (new Date(previousTime).toDateString() !== new Date(currentTime).toDateString()) return false;
  return currentTime - previousTime >= 0 && currentTime - previousTime <= 5 * 60_000;
}

export function maximumMessengerSequence(left: string, right: string) {
  return compareMessengerSequences(left, right) >= 0 ? left : right;
}
