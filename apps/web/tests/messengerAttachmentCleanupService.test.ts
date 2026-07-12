import assert from "node:assert/strict";
import test from "node:test";
import { MessengerAttachmentCleanupService } from "../lib/server/messenger/attachmentCleanupService";

test("deletes every private variant after atomically claiming cleanup", async () => {
  const keys: string[] = [];
  let deletedAt: Date | null = null;
  const attachment = {
    createdAt: new Date("2026-07-10T12:00:00.000Z"),
    deletedAt: null,
    expiresAt: new Date("2026-07-11T11:00:00.000Z"),
    id: "attachment-1",
    posterStorageKey: "poster-key",
    status: "ready" as const,
    storageKey: "original-key",
    thumbnailStorageKey: "thumbnail-key"
  };
  const client = {
    messengerMessageAttachment: {
      async findMany() {
        return [attachment];
      },
      async update() {
        deletedAt = new Date("2026-07-11T12:00:00.000Z");
        return attachment;
      },
      async updateMany() {
        return { count: 1 };
      }
    }
  };
  const cleanup = new MessengerAttachmentCleanupService(client as never, {
    async deleteObject(key: string) {
      keys.push(key);
    }
  }, () => new Date("2026-07-11T12:00:00.000Z"));
  assert.deepEqual(await cleanup.runBatch(), { deleted: 1, scanned: 1 });
  assert.deepEqual(keys.sort(), ["original-key", "poster-key", "thumbnail-key"]);
  assert.ok(deletedAt);
});

test("leaves deletion retryable when storage is unavailable", async () => {
  let markedDeleting = false;
  const client = {
    messengerMessageAttachment: {
      async findMany() {
        return [{
          createdAt: new Date(),
          deletedAt: null,
          expiresAt: new Date(),
          id: "attachment-1",
          posterStorageKey: null,
          status: "rejected" as const,
          storageKey: "original-key",
          thumbnailStorageKey: null
        }];
      },
      async update() {
        assert.fail("deletedAt must not be written");
      },
      async updateMany() {
        markedDeleting = true;
        return { count: 1 };
      }
    }
  };
  const cleanup = new MessengerAttachmentCleanupService(client as never, {
    async deleteObject() {
      throw new Error("offline");
    }
  });
  assert.deepEqual(await cleanup.runBatch(), { deleted: 0, scanned: 1 });
  assert.equal(markedDeleting, true);
});
