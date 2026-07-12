import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope, parseEnvelope, workspaceChannel } from "../src/eventContract.js";

test("creates minimal content-free event envelopes", () => {
  const envelope = createEnvelope({
    conversationId: "conversation-1",
    createdAt: "2026-07-11T10:00:00.000Z",
    eventId: "event-1",
    payload: { messageId: "message-1", sequence: "4" },
    targetUserId: null,
    type: "message.created",
    workspaceId: "workspace-1"
  });
  assert.equal(parseEnvelope(envelope)?.eventId, "event-1");
  assert.equal(workspaceChannel("workspace-1"), "slate:messenger:workspace:workspace-1");
  assert.throws(() => createEnvelope({ ...envelope, payload: { body: "secret" } }));
});

test("accepts targeted attachment status without storage metadata", () => {
  const envelope = createEnvelope({
    conversationId: "conversation-1",
    createdAt: "2026-07-11T10:00:00.000Z",
    eventId: "event-2",
    payload: { attachmentId: "attachment-1", status: "uploaded" },
    targetUserId: "user-1",
    type: "attachment.changed",
    workspaceId: "workspace-1"
  });
  assert.equal(envelope.payload.status, "uploaded");
  assert.throws(() => createEnvelope({ ...envelope, payload: { storageKey: "secret" } }));
});

test("accepts transient typing events without message content", () => {
  const envelope = createEnvelope({
    conversationId: "conversation-1",
    createdAt: "2026-07-11T10:00:00.000Z",
    eventId: "event-3",
    payload: { active: "start", userId: "user-1" },
    targetUserId: null,
    type: "typing.changed",
    workspaceId: "workspace-1"
  });
  assert.equal(parseEnvelope(envelope)?.type, "typing.changed");
});
