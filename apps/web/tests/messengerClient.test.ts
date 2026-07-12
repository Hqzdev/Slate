import assert from "node:assert/strict";
import test from "node:test";
import { MessengerClient, MessengerClientError, type MessengerFetchOptions } from "../lib/client/messengerClient";
import {
  MessengerContractError,
  compareMessengerSequences,
  parseMessengerConversationPage,
  parseMessengerHistoryPage,
  parseMessengerRealtimeFrame,
  parseMessengerSequence
} from "../lib/client/messengerTypes";

const timestamp = "2026-07-11T12:00:00.000Z";

const receipt = {
  deliveredAt: timestamp,
  deliveredThroughSequence: "9007199254740993",
  readAt: timestamp,
  readThroughSequence: "9007199254740993",
  userId: "user-1"
};

const message = {
  attachments: [],
  author: {
    color: "blue",
    email: "member@slate.test",
    id: "user-1",
    initials: "ME",
    kind: "member",
    name: "Member"
  },
  body: "Ship it",
  clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f",
  conversationId: "conversation-1",
  createdAt: timestamp,
  id: "message-1",
  inReplyToMessageId: null,
  reactions: [{
    count: 1,
    emoji: "🚀",
    ownReactionId: "reaction-1",
    reactors: [{ color: "blue", id: "user-1", initials: "ME", name: "Member" }]
  }],
  sequence: "9007199254740993"
};

const conversation = {
  activatedAt: timestamp,
  capabilities: { canReact: true, canRead: true, canSend: true },
  id: "conversation-1",
  kind: "general",
  lastMessage: message,
  lastMessageAt: timestamp,
  lastMessageSequence: "9007199254740993",
  participants: [{
    color: "blue",
    email: "member@slate.test",
    id: "user-1",
    initials: "ME",
    joinedAt: timestamp,
    name: "Member",
    state: "active",
    userId: "user-1"
  }],
  receipt,
  retainedFromSequence: "1",
  title: "General",
  unreadCount: 0,
  workspaceId: "workspace-1"
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status
  });
}

function assertClientError(error: unknown, code: string) {
  assert.ok(error instanceof MessengerClientError);
  assert.equal(error.code, code);
  return true;
}

test("compares decimal sequences without converting them to unsafe numbers", () => {
  assert.equal(compareMessengerSequences("9", "10"), -1);
  assert.equal(compareMessengerSequences("9007199254740993", "9007199254740994"), -1);
  assert.equal(compareMessengerSequences("9223372036854775807", "9223372036854775807"), 0);
  assert.equal(compareMessengerSequences("100", "99"), 1);
  assert.throws(() => parseMessengerSequence("01"), MessengerContractError);
  assert.throws(() => parseMessengerSequence("9223372036854775808"), MessengerContractError);
});

test("parses public conversation and history DTOs", () => {
  const conversationPage = parseMessengerConversationPage({ conversations: [conversation], nextCursor: "next" });
  assert.equal(conversationPage.conversations[0]?.lastMessage?.clientRequestId, message.clientRequestId);
  assert.equal(conversationPage.conversations[0]?.receipt?.readThroughSequence, "9007199254740993");
  assert.equal(conversationPage.conversations[0]?.lastMessage?.reactions[0]?.reactors[0]?.name, "Member");

  const historyPage = parseMessengerHistoryPage({
    hasMoreAfter: false,
    hasMoreBefore: true,
    messages: [message],
    newestSequence: "9007199254740993",
    oldestSequence: "9007199254740993",
    retainedFromSequence: "1",
    resolvedThroughSequence: "9007199254740993",
    serverLastSequence: "9007199254740993"
  });
  assert.equal(historyPage.messages[0]?.body, "Ship it");
  const attachmentHistory = parseMessengerHistoryPage({
    ...historyPage,
    messages: [{
      ...message,
      attachments: [{
        byteSize: "1024",
        contentType: "image/png",
        durationMs: null,
        fileName: "design.png",
        height: 100,
        id: "attachment-1",
        kind: "image",
        status: "attached",
        width: 100
      }]
    }]
  });
  assert.equal(attachmentHistory.messages[0]?.attachments[0]?.fileName, "design.png");
  assert.throws(
    () => parseMessengerHistoryPage({ ...historyPage, messages: [{ ...message, attachments: [{ id: "not-ready" }] }] }),
    MessengerContractError
  );
});

test("authorizes realtime and accepts content-free event frames", async () => {
  const client = new MessengerClient({
    fetch: async (input, init) => {
      assert.equal(input, "/api/workspaces/workspace-1/messenger/realtime/authorize");
      assert.equal(init?.method, "POST");
      return jsonResponse({
        expiresAt: timestamp,
        grant: "signed-grant",
        protocolVersion: 1,
        socketUrl: "ws://127.0.0.1:1236/messenger"
      });
    }
  });
  const authorization = await client.authorizeRealtime("workspace-1");
  assert.equal(authorization.grant, "signed-grant");
  const event = parseMessengerRealtimeFrame({
    conversationId: "conversation-1",
    eventId: "event-1",
    occurredAt: timestamp,
    payload: { messageId: "message-1", sequence: "2" },
    type: "message.created",
    v: 1,
    workspaceId: "workspace-1"
  });
  assert.equal(event.type, "message.created");
  assert.throws(() => parseMessengerRealtimeFrame({ ...event, body: "secret" }), MessengerContractError);
});

test("publishes transient typing state to the selected conversation", async () => {
  const client = new MessengerClient({
    fetch: async (input, init) => {
      assert.equal(input, "/api/workspaces/workspace-1/messenger/conversations/conversation-1/typing");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ active: true }));
      return jsonResponse({});
    }
  });
  await client.setTyping("workspace-1", "conversation-1", true);
});

test("calls every phase 2 REST endpoint with encoded paths, abort signals, and parsed results", async () => {
  const responses = [
    jsonResponse({ byConversation: [{ conversationId: "conversation-1", unreadCount: 2 }], total: 2 }),
    jsonResponse({ conversations: [conversation], nextCursor: null }),
    jsonResponse({
      hasMoreAfter: false,
      hasMoreBefore: false,
      messages: [message],
      newestSequence: message.sequence,
      oldestSequence: message.sequence,
      retainedFromSequence: "1",
      resolvedThroughSequence: message.sequence,
      serverLastSequence: message.sequence
    }),
    jsonResponse({ message, replayed: false }, 201),
    jsonResponse({ receipt }),
    jsonResponse({
      reaction: {
        createdAt: timestamp,
        emoji: "🚀",
        id: "reaction-1",
        messageId: "message-1",
        userId: "user-1"
      }
    }, 201),
    jsonResponse({ reaction: { id: "reaction-1" } })
  ];
  const calls: Array<{ init?: MessengerFetchOptions; input: string }> = [];
  const client = new MessengerClient({
    basePath: "/slate/",
    fetch: async (input, init) => {
      calls.push({ init, input });
      const response = responses.shift();
      assert.ok(response);
      return response;
    }
  });
  const controller = new AbortController();

  assert.equal((await client.listUnread("workspace/1", { signal: controller.signal })).total, 2);
  assert.equal((await client.listConversations("workspace/1", {
    cursor: "cursor/+?",
    limit: 25,
    signal: controller.signal
  })).conversations[0]?.title, "General");
  assert.equal((await client.listMessages("workspace/1", "conversation?1", {
    beforeSequence: "9007199254740993",
    limit: 50,
    signal: controller.signal
  })).messages[0]?.id, "message-1");
  assert.equal((await client.sendMessage("workspace/1", "conversation?1", {
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }, { signal: controller.signal })).replayed, false);
  assert.equal((await client.updateReceipt("workspace/1", "conversation?1", {
    deliveredThroughSequence: "9007199254740993",
    readThroughSequence: "9007199254740993"
  }, { signal: controller.signal })).userId, "user-1");
  assert.equal((await client.addReaction(
    "workspace/1",
    "conversation?1",
    "message#1",
    "🚀",
    { signal: controller.signal }
  )).id, "reaction-1");
  assert.equal(await client.removeReaction(
    "workspace/1",
    "conversation?1",
    "message#1",
    "reaction/1",
    { signal: controller.signal }
  ), "reaction-1");

  assert.equal(calls.length, 7);
  assert.equal(calls[0]?.input, "/slate/api/workspaces/workspace%2F1/messenger/unread");
  assert.equal(calls[1]?.input, "/slate/api/workspaces/workspace%2F1/messenger/conversations?cursor=cursor%2F%2B%3F&limit=25");
  assert.equal(calls[2]?.input, "/slate/api/workspaces/workspace%2F1/messenger/conversations/conversation%3F1/messages?beforeSequence=9007199254740993&limit=50");
  assert.equal(calls[3]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), {
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.equal(calls[4]?.init?.method, "PUT");
  assert.equal(calls[5]?.input.endsWith("/messages/message%231/reactions"), true);
  assert.equal(calls[6]?.input.endsWith("/messages/message%231/reactions/reaction%2F1"), true);
  assert.ok(calls.every((call) => call.init?.signal === controller.signal));
  assert.ok(calls.every((call) => call.init?.cache === "no-store"));
  assert.ok(calls.every((call) => call.init?.credentials === "same-origin"));
});

test("runs the attachment API lifecycle and builds only authorized content URLs", async () => {
  const attachment = {
    byteSize: "1024",
    contentType: "image/png",
    createdAt: timestamp,
    durationMs: null,
    expiresAt: "2026-07-12T12:00:00.000Z",
    fileName: "design.png",
    height: 100,
    id: "attachment-1",
    kind: "image",
    rejectionCode: null,
    status: "ready",
    width: 100
  };
  const responses = [
    jsonResponse({
      attachment: { ...attachment, height: null, status: "reserved", width: null },
      upload: {
        expiresAt: "2026-07-11T12:15:00.000Z",
        fields: { key: "signed" },
        headers: null,
        method: "POST",
        url: "https://storage.test/upload?signature=opaque"
      }
    }, 201),
    jsonResponse({ attachment }, 202),
    jsonResponse({ attachment }),
    jsonResponse({ attachment: { ...attachment, status: "deleting" } }, 202)
  ];
  const calls: Array<{ init?: MessengerFetchOptions; input: string }> = [];
  const client = new MessengerClient({
    basePath: "/slate",
    fetch: async (input, init) => {
      calls.push({ init, input });
      return responses.shift() as Response;
    }
  });
  const reserved = await client.reserveAttachment("workspace/1", "conversation?1", {
    byteSize: 1024,
    declaredContentType: "image/png",
    fileName: "design.png"
  });
  assert.equal(reserved.attachment.status, "reserved");
  assert.equal(reserved.upload.fields.key, "signed");
  assert.equal((await client.completeAttachment("workspace/1", "conversation?1", "attachment#1", "etag")).status, "ready");
  assert.equal((await client.getAttachment("workspace/1", "conversation?1", "attachment#1")).fileName, "design.png");
  assert.equal((await client.abandonAttachment("workspace/1", "conversation?1", "attachment#1")).status, "deleting");
  assert.equal(client.attachmentContentUrl("workspace/1", "conversation?1", "attachment#1", "thumbnail"), "/slate/api/workspaces/workspace%2F1/messenger/conversations/conversation%3F1/attachments/attachment%231/content?variant=thumbnail");
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "POST", "GET", "DELETE"]);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { checksum: null, etag: "etag" });
});

test("parses stable server errors and rejects malformed successful responses", async () => {
  const rateLimited = new MessengerClient({
    fetch: async () => jsonResponse({
      code: "rate_limited",
      error: "Too many requests",
      requestId: "request-1",
      retryAfterMs: 2500,
      retryable: true
    }, 429)
  });
  await assert.rejects(rateLimited.listUnread("workspace-1"), (error) => {
    assertClientError(error, "rate_limited");
    assert.equal((error as MessengerClientError).requestId, "request-1");
    assert.equal((error as MessengerClientError).retryAfterMs, 2500);
    assert.equal((error as MessengerClientError).status, 429);
    return true;
  });

  const malformed = new MessengerClient({
    fetch: async () => jsonResponse({ byConversation: [], total: "0" }, 200, { "x-request-id": "request-2" })
  });
  await assert.rejects(malformed.listUnread("workspace-1"), (error) => {
    assertClientError(error, "invalid_response");
    assert.equal((error as MessengerClientError).requestId, "request-2");
    return true;
  });

  const unavailable = new MessengerClient({ fetch: async () => jsonResponse({ unexpected: true }, 503) });
  await assert.rejects(unavailable.listUnread("workspace-1"), (error) => {
    assertClientError(error, "messenger_request_failed");
    assert.equal((error as MessengerClientError).retryable, true);
    return true;
  });
});

test("distinguishes network failure from cancellation and never persists message content", async () => {
  const networkClient = new MessengerClient({ fetch: async () => { throw new TypeError("offline"); } });
  await assert.rejects(networkClient.listUnread("workspace-1"), (error) => assertClientError(error, "network_error"));

  const controller = new AbortController();
  const cancellation = new Error("cancelled");
  cancellation.name = "AbortError";
  const abortingClient = new MessengerClient({ fetch: async () => { throw cancellation; } });
  controller.abort();
  await assert.rejects(abortingClient.listUnread("workspace-1", { signal: controller.signal }), (error) => error === cancellation);

  let storageReads = 0;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      storageReads += 1;
      throw new Error("Messenger must not access localStorage");
    }
  });
  try {
    const client = new MessengerClient({ fetch: async () => jsonResponse({ message, replayed: true }) });
    await client.sendMessage("workspace-1", "conversation-1", {
      body: "private content",
      clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
    });
    assert.equal(storageReads, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("validates mutually exclusive history cursors and receipt input before fetching", () => {
  let requestCount = 0;
  const client = new MessengerClient({
    fetch: async () => {
      requestCount += 1;
      return jsonResponse({});
    }
  });
  assert.throws(
    () => client.listMessages("workspace-1", "conversation-1", { afterSequence: "1", beforeSequence: "2" }),
    (error) => assertClientError(error, "invalid_cursor")
  );
  assert.throws(
    () => client.updateReceipt("workspace-1", "conversation-1", {}),
    (error) => assertClientError(error, "invalid_cursor")
  );
  assert.equal(requestCount, 0);
});
