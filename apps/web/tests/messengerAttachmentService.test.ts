import assert from "node:assert/strict";
import test from "node:test";
import type { MessengerMessageAttachment, Prisma } from "@prisma/client";
import { MessengerAttachmentService, type AttachmentServiceDependencies } from "../lib/server/messenger/attachmentService";
import { AesMessengerKeyProvider, MessengerPayloadCodec } from "../lib/server/messenger/cryptography";
import { MessengerDomainError } from "../lib/server/messenger/errors";
import { normalizeEtag, readMessengerStorageConfiguration } from "../lib/server/messenger/objectStorage";

const now = new Date("2026-07-11T12:00:00.000Z");

function createFixture() {
  const dataKey = Buffer.alloc(32, 4);
  const codec = new MessengerPayloadCodec(new AesMessengerKeyProvider({
    activeKeyId: "test-key",
    fingerprintKey: Buffer.alloc(32, 8),
    keys: { "test-key": Buffer.alloc(32, 7) }
  }), () => Buffer.alloc(12, 3));
  let attachment: MessengerMessageAttachment | null = null;
  let createdJob = false;
  let deletedKey: string | null = null;
  const events: Array<{ payload: unknown; type: string }> = [];
  const table = {
    messengerMediaJob: {
      async upsert() {
        createdJob = true;
        return {};
      }
    },
    messengerMessageAttachment: {
      async aggregate() {
        return { _sum: { declaredByteSize: null } };
      },
      async count() {
        return 0;
      },
      async create(input: { data: Prisma.MessengerMessageAttachmentUncheckedCreateInput }) {
        attachment = {
          attachedAt: null,
          checksumSha256: null,
          conversationId: String(input.data.conversationId),
          createdAt: now,
          createdByUserId: String(input.data.createdByUserId),
          declaredByteSize: BigInt(input.data.declaredByteSize),
          declaredContentType: String(input.data.declaredContentType),
          deletedAt: null,
          detectedContentType: null,
          durationMs: null,
          expiresAt: input.data.expiresAt as Date,
          fileNameCiphertext: Buffer.from(input.data.fileNameCiphertext as Uint8Array),
          fileNameKeyVersion: Number(input.data.fileNameKeyVersion),
          fileNameNonce: Buffer.from(input.data.fileNameNonce as Uint8Array),
          height: null,
          id: String(input.data.id),
          kind: input.data.kind,
          messageId: null,
          objectEtag: null,
          objectVersion: null,
          posterStorageKey: null,
          readyAt: null,
          rejectionCode: null,
          reservedAt: now,
          scanStartedAt: null,
          status: "reserved",
          storageKey: String(input.data.storageKey),
          thumbnailStorageKey: null,
          updatedAt: now,
          uploadedAt: null,
          verifiedByteSize: null,
          width: null,
          workspaceId: String(input.data.workspaceId)
        };
        return attachment;
      },
      async findUnique() {
        return attachment;
      },
      async update(input: { data: Partial<MessengerMessageAttachment> }) {
        assert.ok(attachment);
        attachment = { ...attachment, ...input.data };
        return attachment;
      },
      async updateMany(input: { data: Partial<MessengerMessageAttachment>; where: { status?: string } }) {
        if (!attachment || input.where.status && attachment.status !== input.where.status) return { count: 0 };
        attachment = { ...attachment, ...input.data };
        return { count: 1 };
      }
    }
  };
  const client = {
    async $transaction<T>(operation: (transaction: typeof table) => Promise<T>) {
      return operation(table);
    },
    messengerMessageAttachment: {
      async findFirst() {
        return attachment;
      },
      ...table.messengerMessageAttachment
    }
  };
  const dependencies = {
    accessPolicy: {
      async requireConversationReader() {
        return {};
      },
      async requireConversationWriter() {
        return {};
      },
      async requireConversationWriterWithClient() {
        return {};
      }
    },
    client,
    keyService: {
      async ensureActiveKey() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      },
      async resolveKeyVersion() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      }
    },
    objectStorage: {
      async createUpload() {
        return { expiresAt: "2026-07-11T12:15:00.000Z", fields: { key: "signed" }, headers: null, method: "POST" as const, url: "http://storage/upload" };
      },
      async deleteObject(key: string) {
        deletedKey = key;
      },
      async headObject() {
        assert.ok(attachment);
        return {
          attachmentId: attachment.id,
          byteSize: Number(attachment.declaredByteSize),
          checksum: "checksum-value-00000000000000000000000000000000",
          contentType: attachment.declaredContentType,
          etag: "etag-1",
          version: "version-1"
        };
      }
    },
    outboxRepository: {
      async append(_transaction: unknown, event: { payload: unknown; type: string }) {
        events.push(event);
      }
    },
    payloadCodec: codec
  } as unknown as AttachmentServiceDependencies;
  const ids = ["attachment-1", "object-random-1"];
  const service = new MessengerAttachmentService(dependencies, () => new Date(now), () => ids.shift() ?? "extra-id", {});
  return {
    attachment: () => attachment,
    createdJob: () => createdJob,
    deletedKey: () => deletedKey,
    dependencies,
    events,
    service
  };
}

test("reserves an encrypted exact-object upload and completes it idempotently", async () => {
  const fixture = createFixture();
  const reserved = await fixture.service.reserve("user-1", "workspace-1", "conversation-1", {
    byteSize: 1024,
    declaredContentType: "image/png",
    fileName: "design.png",
    kind: "image"
  });
  assert.equal(reserved.attachment.fileName, "design.png");
  assert.equal(reserved.upload.method, "POST");
  assert.match(fixture.attachment()?.storageKey ?? "", /^messenger\/workspace-1\/attachment-1\/object-random-1$/u);
  assert.notEqual(Buffer.from(fixture.attachment()?.fileNameCiphertext ?? []).toString("utf8"), "design.png");
  const completed = await fixture.service.complete("user-1", "workspace-1", "conversation-1", "attachment-1", { checksum: null, etag: "\"etag-1\"" });
  assert.equal(completed.status, "uploaded");
  assert.equal(fixture.createdJob(), true);
  assert.equal(fixture.events[0]?.type, "attachment.changed");
  const repeated = await fixture.service.complete("user-1", "workspace-1", "conversation-1", "attachment-1", { checksum: null, etag: "etag-1" });
  assert.equal(repeated.status, "uploaded");
});

test("rejects mismatched stored object metadata and abandons private objects", async () => {
  const fixture = createFixture();
  await fixture.service.reserve("user-1", "workspace-1", "conversation-1", {
    byteSize: 1024,
    declaredContentType: "image/png",
    fileName: "design.png",
    kind: "image"
  });
  fixture.dependencies.objectStorage.headObject = async () => ({
    attachmentId: "forged",
    byteSize: 1024,
    checksum: null,
    contentType: "image/png",
    etag: "etag-1",
    version: null
  });
  await assert.rejects(
    fixture.service.complete("user-1", "workspace-1", "conversation-1", "attachment-1", { checksum: null, etag: "etag-1" }),
    (error) => error instanceof MessengerDomainError && error.code === "invalid_attachment"
  );
  assert.equal(fixture.attachment()?.status, "rejected");
  const abandoned = await fixture.service.abandon("user-1", "workspace-1", "conversation-1", "attachment-1");
  assert.equal(abandoned.status, "deleting");
  assert.match(fixture.deletedKey() ?? "", /^messenger\//u);
});

test("storage configuration fails closed in production and normalizes etags", () => {
  assert.throws(() => readMessengerStorageConfiguration({ NODE_ENV: "production" }), (error) => (
    error instanceof MessengerDomainError && error.code === "storage_configuration_invalid"
  ));
  const local = readMessengerStorageConfiguration({});
  assert.equal(local.bucket, "slate-messenger");
  assert.equal(local.forcePathStyle, true);
  assert.equal(normalizeEtag("\"etag-1\""), "etag-1");
});
