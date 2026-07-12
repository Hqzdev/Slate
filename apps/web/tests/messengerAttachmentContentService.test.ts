import assert from "node:assert/strict";
import test from "node:test";
import type { MessengerMessageAttachment } from "@prisma/client";
import { MessengerAttachmentContentService, MessengerContentRangeError, parseMessengerByteRange } from "../lib/server/messenger/attachmentContentService";
import { MessengerMediaStreamRegistry } from "../lib/server/messenger/mediaStreamRegistry";

test("normalizes single byte ranges and rejects unsatisfiable or multipart ranges", () => {
  assert.deepEqual(parseMessengerByteRange(null, 100), null);
  assert.deepEqual(parseMessengerByteRange("bytes=10-19", 100), { end: 19, start: 10, storageHeader: "bytes=10-19" });
  assert.deepEqual(parseMessengerByteRange("bytes=90-", 100), { end: 99, start: 90, storageHeader: "bytes=90-99" });
  assert.deepEqual(parseMessengerByteRange("bytes=-12", 100), { end: 99, start: 88, storageHeader: "bytes=88-99" });
  assert.throws(() => parseMessengerByteRange("bytes=100-", 100), MessengerContentRangeError);
  assert.throws(() => parseMessengerByteRange("bytes=1-2,4-5", 100), MessengerContentRangeError);
  assert.throws(() => parseMessengerByteRange("items=1-2", 100), MessengerContentRangeError);
});

test("authorizes an attached visible object before and after storage access", async () => {
  const attachment = {
    conversationId: "conversation-1",
    detectedContentType: "image/png",
    fileNameCiphertext: Buffer.from("encrypted"),
    fileNameKeyVersion: 1,
    fileNameNonce: Buffer.alloc(12),
    id: "attachment-1",
    storageKey: "private/original",
    verifiedByteSize: BigInt(4),
    workspaceId: "workspace-1"
  } as unknown as MessengerMessageAttachment;
  let accessChecks = 0;
  let query: unknown = null;
  const registry = new MessengerMediaStreamRegistry();
  const service = new MessengerAttachmentContentService({
    accessPolicy: {
      async requireConversationReader() {
        accessChecks += 1;
        return {} as never;
      }
    },
    client: {
      messengerMessageAttachment: {
        async findFirst(input: unknown) {
          query = input;
          return attachment;
        }
      }
    } as never,
    keyService: {
      async resolveKeyVersion() {
        return { dataKey: Buffer.alloc(32, 1), version: 1 };
      }
    },
    objectStorage: {
      async headObject() {
        assert.fail("Original content must not require a variant HEAD");
      },
      async readObject(_storageKey: string, range: string | null) {
        assert.equal(range, "bytes=1-2");
        return {
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([2, 3])); controller.close(); } }),
          byteSize: 2,
          contentRange: "bytes 1-2/4",
          contentType: "image/png",
          etag: "etag"
        };
      }
    },
    payloadCodec: {
      decryptAttachmentFileName() {
        return "design.png";
      }
    },
    streamRegistry: registry
  });
  const content = await service.open({
    attachmentId: "attachment-1",
    conversationId: "conversation-1",
    rangeHeader: "bytes=1-2",
    userId: "user-1",
    variant: "original",
    workspaceId: "workspace-1"
  });
  assert.equal(accessChecks, 2);
  assert.equal(content.status, 206);
  assert.equal(content.contentRange, "bytes 1-2/4");
  assert.match(content.contentDisposition, /^inline;/u);
  assert.deepEqual(query, {
    where: {
      conversationId: "conversation-1",
      id: "attachment-1",
      message: { conversationId: "conversation-1" },
      messageId: { not: null },
      status: "attached",
      workspaceId: "workspace-1"
    }
  });
  const reader = content.body.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.from([2, 3]));
});

test("revokes only streams belonging to the affected workspace user", async () => {
  const registry = new MessengerMediaStreamRegistry();
  let firstCancelled = false;
  let secondCancelled = false;
  const first = registry.track(new ReadableStream<Uint8Array>({ cancel() { firstCancelled = true; } }), { userId: "user-1", workspaceId: "workspace-1" });
  const second = registry.track(new ReadableStream<Uint8Array>({ cancel() { secondCancelled = true; } }), { userId: "user-2", workspaceId: "workspace-1" });
  const firstReader = first.getReader();
  const secondReader = second.getReader();
  assert.equal(registry.revoke("workspace-1", "user-1"), 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(firstCancelled, true);
  assert.equal(secondCancelled, false);
  await firstReader.cancel();
  await secondReader.cancel();
});
