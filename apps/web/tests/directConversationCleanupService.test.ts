import assert from "node:assert/strict";
import test from "node:test";
import { DirectConversationCleanupService } from "../lib/server/messenger/directConversationCleanupService";

test("deletes only expired empty provisional direct conversations", async () => {
  const calls: unknown[] = [];
  const client = {
    messengerConversation: {
      async deleteMany(input: unknown) {
        calls.push(input);
        return { count: 2 };
      },
      async findMany(input: unknown) {
        calls.push(input);
        return [{ id: "direct-1" }, { id: "direct-2" }];
      }
    }
  };
  const service = new DirectConversationCleanupService(client as never, () => new Date("2026-07-11T12:00:00.000Z"));
  assert.deepEqual(await service.runBatch(20), { deleted: 2, scanned: 2 });
  const query = calls[0] as { where: { activatedAt: null; attachments: { none: object }; createdAt: { lte: Date }; kind: string; messages: { none: object } } };
  assert.equal(query.where.kind, "direct");
  assert.equal(query.where.activatedAt, null);
  assert.deepEqual(query.where.attachments, { none: {} });
  assert.deepEqual(query.where.messages, { none: {} });
  assert.equal(query.where.createdAt.lte.toISOString(), "2026-07-10T12:00:00.000Z");
});

test("keeps activated and non-empty direct conversations when no candidate qualifies", async () => {
  let deleted = false;
  const service = new DirectConversationCleanupService({
    messengerConversation: {
      async deleteMany() { deleted = true; return { count: 0 }; },
      async findMany() { return []; }
    }
  } as never);
  assert.deepEqual(await service.runBatch(), { deleted: 0, scanned: 0 });
  assert.equal(deleted, false);
});
