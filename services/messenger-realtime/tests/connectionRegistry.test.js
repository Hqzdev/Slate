import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { ConnectionRegistry } from "../src/connectionRegistry.js";

function createSession(overrides = {}) {
  const sent = [];
  const closed = [];
  return {
    closed,
    sent,
    session: {
      claims: { sub: "user-1", workspaceId: "workspace-1" },
      conversationIds: new Set(["conversation-1"]),
      socket: {
        bufferedAmount: 0,
        close: (code, reason) => closed.push([code, reason]),
        readyState: WebSocket.OPEN,
        send: (value) => sent.push(JSON.parse(value))
      },
      ...overrides
    }
  };
}

function envelope(overrides = {}) {
  return {
    conversationId: "conversation-1",
    eventId: "event-1",
    occurredAt: "2026-07-11T10:00:00.000Z",
    payload: { messageId: "message-1", sequence: "1" },
    targetUserId: null,
    type: "message.created",
    v: 1,
    workspaceId: "workspace-1",
    ...overrides
  };
}

test("filters conversation and targeted events before sending", async () => {
  const registry = new ConnectionRegistry({ canAccessConversation: async () => false });
  const target = createSession();
  registry.add(target.session);
  await registry.dispatch(envelope({ conversationId: "conversation-2" }));
  await registry.dispatch(envelope({ targetUserId: "user-2" }));
  assert.deepEqual(target.sent, []);
});

test("reauthorizes added conversations and strips internal targets", async () => {
  const registry = new ConnectionRegistry({ canAccessConversation: async () => true });
  const target = createSession();
  registry.add(target.session);
  await registry.dispatch(envelope({ conversationId: "conversation-2", targetUserId: "user-1", type: "conversation.added" }));
  assert.equal(target.session.conversationIds.has("conversation-2"), true);
  assert.equal(target.sent[0].targetUserId, undefined);
});

test("closes revoked and changed capability sessions with distinct codes", async () => {
  const registry = new ConnectionRegistry({ canAccessConversation: async () => true });
  const revoked = createSession();
  const changed = createSession();
  registry.add(revoked.session);
  await registry.dispatch(envelope({ conversationId: null, targetUserId: "user-1", type: "access.revoked" }));
  registry.remove(revoked.session);
  registry.add(changed.session);
  await registry.dispatch(envelope({ conversationId: null, targetUserId: "user-1", type: "capabilities.changed" }));
  assert.equal(revoked.closed[0][0], 4003);
  assert.equal(changed.closed[0][0], 4004);
});
