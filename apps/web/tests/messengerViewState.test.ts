import assert from "node:assert/strict";
import test from "node:test";
import { countMessengerCodePoints, isMessengerNearLatest, mergeMessengerConversationSnapshot, mergeMessengerMessages, normalizeMessengerDraft, removeCanonicalPending, retainMessengerMessages, selectMessengerRevalidationMessages, shouldGroupMessengerMessages, type PendingMessengerMessage } from "../lib/client/messengerViewState";
import type { MessengerConversation, MessengerMessage, MessengerReceipt } from "../lib/client/messengerTypes";

function message(input: Partial<MessengerMessage> & Pick<MessengerMessage, "id" | "sequence">): MessengerMessage {
  return {
    attachments: [],
    aiInvocation: null,
    author: { color: "blue", email: "member@slate.test", id: "user-1", initials: "ME", kind: "member", name: "Member" },
    body: "Message",
    clientRequestId: null,
    conversationId: "general-1",
    createdAt: "2026-07-11T12:00:00.000Z",
    inReplyToMessageId: null,
    reactions: [],
    ...input,
    id: input.id,
    sequence: input.sequence
  };
}

function receipt(input: Partial<MessengerReceipt> = {}): MessengerReceipt {
  return {
    deliveredAt: "2026-07-11T12:00:00.000Z",
    deliveredThroughSequence: "0",
    readAt: "2026-07-11T12:00:00.000Z",
    readThroughSequence: "0",
    userId: "user-1",
    ...input
  };
}

function conversation(input: Partial<MessengerConversation> = {}): MessengerConversation {
  return {
    activatedAt: "2026-07-11T12:00:00.000Z",
    capabilities: { canReact: true, canRead: true, canSend: true },
    id: "general-1",
    kind: "general",
    lastMessage: null,
    lastMessageAt: null,
    lastMessageSequence: "0",
    participants: [],
    receipt: receipt(),
    retainedFromSequence: "1",
    title: "General",
    unreadCount: 0,
    workspaceId: "workspace-1",
    ...input
  };
}

test("normalizes drafts and counts Unicode code points", () => {
  assert.equal(normalizeMessengerDraft("  cafe\u0301\r\nnext  "), "café\nnext");
  assert.equal(countMessengerCodePoints("A🚀"), 2);
  assert.equal(countMessengerCodePoints(normalizeMessengerDraft("e\u0301".repeat(8_000))), 8_000);
});

test("merges canonical messages by id and numeric sequence", () => {
  const result = mergeMessengerMessages(
    [message({ id: "ten", sequence: "10" }), message({ body: "old", id: "two", sequence: "2" })],
    [message({ body: "canonical", id: "two", sequence: "2" }), message({ id: "three", sequence: "3" })]
  );
  assert.deepEqual(result.map((item) => item.id), ["two", "three", "ten"]);
  assert.equal(result[0]?.body, "canonical");
});

test("keeps conversation cursors monotonic when summary responses arrive with older data", () => {
  const currentMessage = message({ id: "current", sequence: "12" });
  const incomingMessage = message({ id: "incoming", sequence: "11" });
  const result = mergeMessengerConversationSnapshot(
    conversation({
      lastMessage: currentMessage,
      lastMessageAt: currentMessage.createdAt,
      lastMessageSequence: "12",
      receipt: receipt({ deliveredThroughSequence: "10", readThroughSequence: "8" }),
      retainedFromSequence: "2"
    }),
    conversation({
      lastMessage: incomingMessage,
      lastMessageAt: incomingMessage.createdAt,
      lastMessageSequence: "11",
      receipt: receipt({ deliveredThroughSequence: "9", readThroughSequence: "9" }),
      retainedFromSequence: "3",
      unreadCount: 4
    })
  );
  assert.equal(result.lastMessage?.id, "current");
  assert.equal(result.lastMessageSequence, "12");
  assert.equal(result.receipt?.deliveredThroughSequence, "10");
  assert.equal(result.receipt?.readThroughSequence, "9");
  assert.equal(result.retainedFromSequence, "3");
  assert.equal(result.unreadCount, 4);
});

test("revalidation updates loaded messages without inserting non-contiguous history", () => {
  const current = [message({ body: "old", id: "one", sequence: "100" })];
  const selected = selectMessengerRevalidationMessages(current, [
    message({ body: "canonical", id: "one", sequence: "100" }),
    message({ id: "gap", sequence: "150" })
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["one"]);
  assert.equal(selected[0]?.body, "canonical");
});

test("retention removes plaintext rows below the server floor", () => {
  const retained = retainMessengerMessages([
    message({ id: "removed", sequence: "49" }),
    message({ id: "floor", sequence: "50" }),
    message({ id: "newer", sequence: "51" })
  ], "50");
  assert.deepEqual(retained.map((item) => item.id), ["floor", "newer"]);
});

test("reconciles pending sends only with the caller-visible request id", () => {
  const pending: PendingMessengerMessage[] = [{ body: "Message", clientRequestId: "request-1", createdAt: "2026-07-11T12:00:00.000Z", errorCode: null, errorMessage: null, retryAt: null, status: "sending" }];
  assert.equal(removeCanonicalPending(pending, message({ clientRequestId: null, id: "other", sequence: "1" })).length, 1);
  assert.equal(removeCanonicalPending(pending, message({ clientRequestId: "request-1", id: "own", sequence: "2" })).length, 0);
});

test("uses the documented latest threshold and five minute grouping boundary", () => {
  assert.equal(isMessengerNearLatest(1000, 404, 500), true);
  assert.equal(isMessengerNearLatest(1000, 403, 500), false);
  const first = message({ id: "one", sequence: "1" });
  assert.equal(shouldGroupMessengerMessages(first, message({ createdAt: "2026-07-11T12:05:00.000Z", id: "two", sequence: "2" })), true);
  assert.equal(shouldGroupMessengerMessages(first, message({ createdAt: "2026-07-11T12:05:00.001Z", id: "three", sequence: "3" })), false);
});
