import assert from "node:assert/strict";
import test from "node:test";
import { OutboxPublisher } from "../src/outboxPublisher.js";

test("publishes stable event ids before acknowledging leases", async () => {
  const calls = [];
  const repository = {
    acknowledge: async (id) => calls.push(["ack", id]),
    claim: async () => [{
      attemptCount: 1,
      conversationId: "conversation-1",
      createdAt: "2026-07-11T10:00:00.000Z",
      eventId: "event-1",
      id: "row-1",
      payload: { messageId: "message-1", sequence: "1" },
      targetUserId: null,
      type: "message.created",
      workspaceId: "workspace-1"
    }],
    retry: async () => assert.fail("retry should not run")
  };
  const redis = { publish: async (channel, value) => calls.push(["publish", channel, JSON.parse(value).eventId]) };
  const publisher = new OutboxPublisher(repository, redis);
  assert.equal(await publisher.publishBatch(), 1);
  assert.deepEqual(calls, [
    ["publish", "slate:messenger:workspace:workspace-1", "event-1"],
    ["ack", "row-1"]
  ]);
});

test("releases a failed event for bounded retry", async () => {
  const retries = [];
  const repository = {
    acknowledge: async () => assert.fail("ack should not run"),
    claim: async () => [{ attemptCount: 2, conversationId: null, createdAt: new Date(), eventId: "event-1", id: "row-1", payload: {}, targetUserId: null, type: "unknown", workspaceId: "workspace-1" }],
    retry: async (...args) => retries.push(args)
  };
  const publisher = new OutboxPublisher(repository, { publish: async () => assert.fail("publish should not run") });
  await publisher.publishBatch();
  assert.deepEqual(retries, [["row-1", 2, "invalid_event_contract"]]);
});

test("stops while an idle poll is waiting and releases owned leases", async () => {
  let released = false;
  const repository = {
    claim: async () => [],
    release: async () => {
      released = true;
    }
  };
  const publisher = new OutboxPublisher(repository, {}, { pollIntervalMs: 30_000 });
  publisher.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await publisher.stop();
  assert.equal(released, true);
});
