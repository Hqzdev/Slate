import assert from "node:assert/strict";
import test from "node:test";
import { MessengerOutboxRepository } from "../lib/server/messenger/outboxRepository";

test("appends minimal targeted events with stable generated identifiers", async () => {
  const writes: unknown[] = [];
  const client = {
    messengerOutboxEvent: {
      async create(input: unknown) {
        writes.push(input);
        return input;
      }
    }
  };
  const repository = new MessengerOutboxRepository(() => "event-1");
  await repository.append(client, {
    conversationId: "conversation-1",
    payload: { messageId: "message-1", sequence: "7" },
    targetUserId: "user-1",
    type: "message.created",
    workspaceId: "workspace-1"
  });
  assert.deepEqual(writes[0], {
    data: {
      conversationId: "conversation-1",
      eventId: "event-1",
      payload: { messageId: "message-1", sequence: "7" },
      targetUserId: "user-1",
      type: "message.created",
      workspaceId: "workspace-1"
    }
  });
});
