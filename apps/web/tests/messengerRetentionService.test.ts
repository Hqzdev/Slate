import assert from "node:assert/strict";
import test from "node:test";
import { MessengerRetentionService } from "../lib/server/messenger/retentionService";

test("retention disables access, removes ciphertext after attachment cleanup, and completes its tombstone", async () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const calls: string[] = [];
  const message = {
    conversation: { workspace: { settings: { retentionDays: 90 } } },
    conversationId: "conversation-1",
    createdAt: new Date("2026-04-01T12:00:00.000Z"),
    id: "message-1",
    sequence: BigInt(4),
    workspaceId: "workspace-1"
  };
  let findManyCount = 0;
  const transaction = {
    messengerConversation: {
      async updateMany() {
        calls.push("floor");
        return { count: 1 };
      }
    },
    messengerDeletionTombstone: {
      async updateMany() {
        calls.push("complete-tombstone");
        return { count: 1 };
      },
      async upsert() {
        calls.push("tombstone");
        return {};
      }
    },
    messengerMessage: {
      async updateMany(input: { data: { deletingAt?: Date; deletedAt?: Date | null } }) {
        calls.push(input.data.deletingAt ? "mark-message" : "erase-message");
        return { count: 1 };
      }
    },
    messengerMessageAttachment: {
      async updateMany() {
        calls.push("mark-attachments");
        return { count: 1 };
      }
    }
  };
  const client = {
    async $transaction<T>(operation: (client: typeof transaction) => Promise<T>) {
      return operation(transaction);
    },
    messengerMessage: {
      async findMany() {
        findManyCount += 1;
        return findManyCount === 1 ? [message] : [{ id: "message-1" }];
      }
    }
  };
  const auditEvents: Array<{ type: string }> = [];
  const service = new MessengerRetentionService(
    client as never,
    { async runBatch() { return { deleted: 1, scanned: 1 }; } },
    () => now,
    90,
    { async record(input) { auditEvents.push(input); } }
  );

  assert.deepEqual(await service.runBatch(1), {
    attachmentsDeleted: 1,
    messagesCompleted: 1,
    messagesMarked: 1,
    scanned: 1
  });
  assert.deepEqual(calls, ["mark-message", "tombstone", "mark-attachments", "floor", "erase-message", "complete-tombstone"]);
  assert.deepEqual(auditEvents, [{ type: "messenger.retention.completed", metadata: { attachmentsDeleted: 1, messagesCompleted: 1, messagesMarked: 1 } }]);
});

test("retention leaves messages inside the workspace retention window untouched", async () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  let findManyCount = 0;
  const client = {
    async $transaction() {
      assert.fail("No deletion transaction should run");
    },
    messengerMessage: {
      async findMany() {
        findManyCount += 1;
        if (findManyCount > 1) return [];
        return [{
          conversation: { workspace: { settings: { retentionDays: 90 } } },
          conversationId: "conversation-1",
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          id: "message-1",
          sequence: BigInt(4),
          workspaceId: "workspace-1"
        }];
      }
    }
  };
  const service = new MessengerRetentionService(
    client as never,
    { async runBatch() { return { deleted: 0, scanned: 0 }; } },
    () => now,
    90,
    { async record() { assert.fail("No audit event should be written"); } }
  );

  assert.deepEqual(await service.runBatch(1), {
    attachmentsDeleted: 0,
    messagesCompleted: 0,
    messagesMarked: 0,
    scanned: 1
  });
});

test("retention scans past large non-expired workspace prefixes", async () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const calls: string[] = [];
  const nonExpired = Array.from({ length: 100 }, (_, index) => ({
    conversation: { workspace: { settings: { retentionDays: 365 } } },
    conversationId: "long-retention",
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    id: `message-${String(index).padStart(3, "0")}`,
    sequence: BigInt(index + 1)
  }));
  const transaction = {
    messengerConversation: { updateMany: async () => ({ count: 1 }) },
    messengerDeletionTombstone: { updateMany: async () => ({ count: 1 }), upsert: async () => ({}) },
    messengerMessage: { updateMany: async () => ({ count: 1 }) },
    messengerMessageAttachment: { updateMany: async () => ({ count: 0 }) }
  };
  const client = {
    async $transaction<T>(operation: (value: typeof transaction) => Promise<T>) { return operation(transaction); },
    messengerMessage: {
      async findMany(input: { cursor?: { id: string }; where: { attachments?: unknown } }) {
        if (input.where.attachments) return [];
        if (!input.cursor) return nonExpired;
        calls.push(input.cursor.id);
        return [{
          conversation: { workspace: { settings: { retentionDays: 7 } } },
          conversationId: "short-retention",
          createdAt: new Date("2026-06-20T12:00:00.000Z"),
          id: "expired-message",
          sequence: BigInt(1)
        }];
      }
    }
  };
  const service = new MessengerRetentionService(client as never, { async runBatch() { return { deleted: 0, scanned: 0 }; } }, () => now, 90, { async record() {} });
  const result = await service.runBatch(1);
  assert.equal(result.messagesMarked, 1);
  assert.equal(result.scanned, 101);
  assert.deepEqual(calls, ["message-099"]);
});

test("replays restored tombstones before expiring completed markers", async () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const actions: string[] = [];
  const transaction = {
    messengerDeletionTombstone: { update: async () => { actions.push("reset-tombstone"); return {}; } },
    messengerMessage: { updateMany: async () => { actions.push("disable-message"); return { count: 1 }; } },
    messengerMessageAttachment: { updateMany: async () => { actions.push("disable-attachments"); return { count: 1 }; } }
  };
  const client = {
    async $transaction<T>(operation: (value: typeof transaction) => Promise<T>) { return operation(transaction); },
    messengerDeletionTombstone: {
      async deleteMany() { return { count: 2 }; },
      async findMany() {
        return [{
          backupExpiresAt: new Date("2026-10-01T12:00:00.000Z"),
          effectiveAt: new Date("2026-07-01T12:00:00.000Z"),
          id: "tombstone-1",
          resourceId: "message-1"
        }];
      }
    }
  };
  const service = new MessengerRetentionService(client as never, {} as never, () => now, 90, {} as never);
  assert.deepEqual(await service.replayTombstones(10), { expired: 2, replayed: 1, scanned: 1 });
  assert.deepEqual(actions, ["disable-message", "disable-attachments", "reset-tombstone"]);
});
