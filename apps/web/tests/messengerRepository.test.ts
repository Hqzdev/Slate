import assert from "node:assert/strict";
import test from "node:test";
import type { MessengerMessageAttachment, Prisma } from "@prisma/client";
import { AesMessengerKeyProvider, MessengerPayloadCodec } from "../lib/server/messenger/cryptography";
import { MessengerDomainError } from "../lib/server/messenger/errors";
import { MessengerRepository, type MessengerRepositoryDependencies } from "../lib/server/messenger/repository";

type StoredMessage = {
  author: {
    color: string;
    email: string;
    id: string;
    initials: string;
    name: string;
  };
  authorKind: "member";
  authorUserId: string;
  bodyCiphertext: Uint8Array;
  bodyEncoding: "server_aead_v1";
  bodyKeyVersion: number;
  bodyNonce: Uint8Array;
  clientRequestId: string;
  conversationId: string;
  createdAt: Date;
  id: string;
  reactions: [];
  requestFingerprint: string;
  sequence: bigint;
  attachments?: MessengerMessageAttachment[];
};

function createRepository() {
  const dataKey = Buffer.alloc(32, 4);
  let nonce = 0;
  const provider = new AesMessengerKeyProvider({
    activeKeyId: "test-key",
    fingerprintKey: Buffer.alloc(32, 8),
    keys: { "test-key": Buffer.alloc(32, 7) }
  });
  const payloadCodec = new MessengerPayloadCodec(provider, (size) => {
    nonce += 1;
    return Buffer.alloc(size, nonce);
  });
  const state = {
    failOutbox: false,
    lastMessageSequence: BigInt(0),
    messages: [] as StoredMessage[],
    attachments: [] as MessengerMessageAttachment[],
    outbox: [] as Array<{ payload: unknown; type: string }>,
    receipt: null as null | {
      deliveredAt: Date;
      deliveredThroughSequence: bigint;
      readAt: Date;
      readThroughSequence: bigint;
      userId: string;
    }
  };
  const findByIdempotency = (input: {
    where: { conversationId_authorUserId_clientRequestId: { authorUserId: string; clientRequestId: string; conversationId: string } };
  }) => {
    const identity = input.where.conversationId_authorUserId_clientRequestId;
    return state.messages.find((message) => (
      message.authorUserId === identity.authorUserId
      && message.clientRequestId === identity.clientRequestId
      && message.conversationId === identity.conversationId
    )) ?? null;
  };
  const transaction = {
    messengerConversation: {
      async update() {
        state.lastMessageSequence += BigInt(1);
        return { lastMessageSequence: state.lastMessageSequence };
      }
    },
    messengerKeyEnvelope: {
      async findUnique() {
        return { state: "active" as const };
      }
    },
    messengerMessage: {
      async create(input: { data: Omit<StoredMessage, "author" | "createdAt" | "reactions"> }) {
        const message: StoredMessage = {
          ...input.data,
          author: {
            color: "blue",
            email: "writer@slate.test",
            id: "user-1",
            initials: "WR",
            name: "Writer"
          },
          createdAt: new Date("2026-07-11T10:00:00.000Z"),
          reactions: []
        };
        state.messages.push(message);
        return message;
      },
      findUnique: findByIdempotency
    },
    messengerMessageAttachment: {
      async aggregate(input: { where: { createdByUserId?: string } }) {
        const matching = state.attachments.filter((attachment) => !input.where.createdByUserId || attachment.createdByUserId === input.where.createdByUserId);
        return { _sum: { declaredByteSize: matching.reduce((sum, attachment) => sum + attachment.declaredByteSize, BigInt(0)) } };
      },
      async findMany(input: { where: { id: { in: string[] } } }) {
        return state.attachments.filter((attachment) => input.where.id.in.includes(attachment.id));
      },
      async updateMany(input: { data: Partial<MessengerMessageAttachment>; where: { id: { in: string[] }; messageId: null; status: "ready" } }) {
        let count = 0;
        state.attachments = state.attachments.map((attachment) => {
          if (!input.where.id.in.includes(attachment.id) || attachment.messageId !== null || attachment.status !== "ready") return attachment;
          count += 1;
          return { ...attachment, ...input.data };
        });
        return { count };
      }
    },
    messengerMessageReceipt: {
      async upsert(input: {
        create: {
          deliveredAt: Date;
          deliveredThroughSequence: bigint;
          readAt: Date;
          readThroughSequence: bigint;
          userId: string;
        };
        update: {
          deliveredAt: Date;
          deliveredThroughSequence: bigint;
          readAt: Date;
          readThroughSequence: bigint;
        };
      }) {
        state.receipt = { ...(state.receipt ?? input.create), ...input.update };
        return state.receipt;
      }
    }
  };
  const client = {
    async $transaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>) {
      const snapshot = {
        lastMessageSequence: state.lastMessageSequence,
        messages: [...state.messages],
        attachments: state.attachments.map((attachment) => ({ ...attachment })),
        outbox: [...state.outbox],
        receipt: state.receipt ? { ...state.receipt } : null
      };
      try {
        return await operation(transaction as unknown as Prisma.TransactionClient);
      } catch (error) {
        state.lastMessageSequence = snapshot.lastMessageSequence;
        state.messages = snapshot.messages;
        state.attachments = snapshot.attachments;
        state.outbox = snapshot.outbox;
        state.receipt = snapshot.receipt;
        throw error;
      }
    },
    messengerMessage: {
      async count() {
        return 0;
      },
      async findFirst(input: { where: { id?: string } }) {
        const message = input.where.id
          ? state.messages.find((message) => message.id === input.where.id) ?? null
          : state.messages.at(-1) ?? null;
        return message ? { ...message, attachments: state.attachments.filter((attachment) => attachment.messageId === message.id) } : null;
      },
      async findMany() {
        return state.messages;
      },
      findUnique: findByIdempotency
    }
  };
  const accessPolicy = {
    async requireConversationReader() {
      throw new Error("Not used");
    },
    async requireConversationReaderWithClient() {
      throw new Error("Not used");
    },
    async requireConversationWriter() {
      return { conversationId: "conversation-1" };
    },
    async requireConversationWriterWithClient() {
      return { conversationId: "conversation-1" };
    },
    async requireWorkspaceReader() {
      return { role: "editor" as const };
    }
  };
  const dependencies = {
    accessPolicy,
    client,
    keyService: {
      async ensureActiveKey() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      },
      async resolveKeyVersion() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      }
    },
    outboxRepository: {
      async append(_client: unknown, input: { payload: unknown; type: string }) {
        if (state.failOutbox) throw new Error("Outbox unavailable");
        state.outbox.push({ payload: input.payload, type: input.type });
        return input;
      }
    },
    payloadCodec
  } as unknown as MessengerRepositoryDependencies;
  return {
    addReadyAttachment(id = "attachment-1") {
      const encryptedName = payloadCodec.encryptAttachmentFileName({
        attachmentId: id,
        conversationId: "conversation-1",
        dataKey,
        fileName: "design.png",
        keyVersion: 1,
        workspaceId: "workspace-1"
      });
      state.attachments.push({
        attachedAt: null,
        checksumSha256: "checksum-1",
        conversationId: "conversation-1",
        createdAt: new Date("2026-07-11T09:00:00.000Z"),
        createdByUserId: "user-1",
        declaredByteSize: BigInt(1024),
        declaredContentType: "image/png",
        deletedAt: null,
        detectedContentType: "image/png",
        durationMs: null,
        expiresAt: new Date("2099-07-12T09:00:00.000Z"),
        fileNameCiphertext: Uint8Array.from(encryptedName.ciphertext),
        fileNameKeyVersion: 1,
        fileNameNonce: Uint8Array.from(encryptedName.nonce),
        height: 100,
        id,
        kind: "image",
        messageId: null,
        objectEtag: "etag-1",
        objectVersion: null,
        posterStorageKey: null,
        readyAt: new Date("2026-07-11T09:05:00.000Z"),
        rejectionCode: null,
        reservedAt: new Date("2026-07-11T08:55:00.000Z"),
        scanStartedAt: new Date("2026-07-11T09:01:00.000Z"),
        status: "ready",
        storageKey: `messenger/workspace-1/${id}/object`,
        thumbnailStorageKey: null,
        updatedAt: new Date("2026-07-11T09:05:00.000Z"),
        uploadedAt: new Date("2026-07-11T09:00:00.000Z"),
        verifiedByteSize: BigInt(1024),
        width: 100,
        workspaceId: "workspace-1"
      });
      return id;
    },
    repository: new MessengerRepository(dependencies),
    state
  };
}

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof MessengerDomainError);
  assert.equal(error.code, code);
  return true;
}

test("deduplicates exact retries and rejects an idempotency-key payload conflict", async () => {
  const { repository, state } = createRepository();
  const request = {
    body: "Alpha",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  };
  const created = await repository.sendMessage("user-1", "workspace-1", "conversation-1", request);
  const replay = await repository.sendMessage("user-1", "workspace-1", "conversation-1", request);
  assert.equal(created.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(created.message.body, "Alpha");
  assert.equal(created.message.clientRequestId, request.clientRequestId);
  assert.equal(replay.message.clientRequestId, request.clientRequestId);
  assert.equal(replay.message.id, created.message.id);
  assert.equal(state.messages.length, 1);
  assert.equal(state.lastMessageSequence, BigInt(1));
  assert.equal(state.outbox.length, 2);
  assert.equal(Buffer.from(state.messages[0].bodyCiphertext).includes(Buffer.from("Alpha")), false);
  await assert.rejects(
    () => repository.sendMessage("user-1", "workspace-1", "conversation-1", { ...request, body: "Beta" }),
    (error) => assertCode(error, "idempotency_conflict")
  );
  assert.equal(state.messages.length, 1);
  assert.equal(state.lastMessageSequence, BigInt(1));
});

test("allocates stable per-conversation sequences and advances the sender receipt", async () => {
  const { repository, state } = createRepository();
  const first = await repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    body: "First",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  const second = await repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    body: "Second",
    clientRequestId: "0af85892-9d8f-4c32-8940-c5c5369e459a"
  });
  assert.equal(first.message.sequence, "1");
  assert.equal(second.message.sequence, "2");
  assert.equal(state.receipt?.deliveredThroughSequence, BigInt(2));
  assert.equal(state.receipt?.readThroughSequence, BigInt(2));
  assert.deepEqual(state.outbox.map((event) => event.type), [
    "message.created",
    "conversation.changed",
    "message.created",
    "conversation.changed"
  ]);
});

test("claims ready attachments atomically and returns only decrypted safe metadata", async () => {
  const { addReadyAttachment, repository, state } = createRepository();
  const attachmentId = addReadyAttachment();
  const created = await repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    attachmentIds: [attachmentId],
    body: null,
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.equal(state.attachments[0]?.status, "attached");
  assert.equal(state.attachments[0]?.messageId, created.message.id);
  assert.deepEqual(created.message.attachments, [{
    byteSize: "1024",
    contentType: "image/png",
    durationMs: null,
    fileName: "design.png",
    height: 100,
    id: attachmentId,
    kind: "image",
    status: "attached",
    width: 100
  }]);
  const replay = await repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    attachmentIds: [attachmentId],
    body: null,
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.equal(replay.replayed, true);
  const otherAttachmentId = addReadyAttachment("attachment-2");
  await assert.rejects(() => repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    attachmentIds: [otherAttachmentId],
    body: null,
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), (error) => assertCode(error, "idempotency_conflict"));
});

test("rolls back attachment claims when durable publication fails", async () => {
  const { addReadyAttachment, repository, state } = createRepository();
  const attachmentId = addReadyAttachment();
  state.failOutbox = true;
  await assert.rejects(() => repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    attachmentIds: [attachmentId],
    body: "Must roll back",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), /Outbox unavailable/u);
  assert.equal(state.attachments[0]?.status, "ready");
  assert.equal(state.attachments[0]?.messageId, null);
});

test("rolls back message, sequence, receipt and outbox when the durable event fails", async () => {
  const { repository, state } = createRepository();
  state.failOutbox = true;
  await assert.rejects(() => repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    body: "Must roll back",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), /Outbox unavailable/);
  assert.equal(state.messages.length, 0);
  assert.equal(state.lastMessageSequence, BigInt(0));
  assert.equal(state.receipt, null);
  assert.equal(state.outbox.length, 0);
  state.failOutbox = false;
  const created = await repository.sendMessage("user-1", "workspace-1", "conversation-1", {
    body: "Now durable",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.equal(created.message.sequence, "1");
});

test("rechecks conversation access after history materialization before returning plaintext", async () => {
  const dataKey = Buffer.alloc(32, 4);
  const provider = new AesMessengerKeyProvider({
    activeKeyId: "test-key",
    fingerprintKey: Buffer.alloc(32, 8),
    keys: { "test-key": Buffer.alloc(32, 7) }
  });
  const payloadCodec = new MessengerPayloadCodec(provider, (size) => Buffer.alloc(size, 3));
  const encrypted = payloadCodec.encryptBody({
    body: "must not escape after revocation",
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  });
  let accessChecks = 0;
  const dependencies = {
    accessPolicy: {
      async requireConversationReader() {
        accessChecks += 1;
        if (accessChecks > 1) {
          throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
        }
        return {
          conversation: {
            lastMessageSequence: BigInt(1),
            retainedFromSequence: BigInt(1)
          },
          historyFromSequence: BigInt(1)
        };
      }
    },
    client: {
      messengerMessage: {
        async findMany() {
          return [{
            author: {
              color: "blue",
              email: "writer@slate.test",
              id: "user-2",
              initials: "WR",
              name: "Writer"
            },
            authorKind: "member" as const,
            authorUserId: "user-2",
            bodyCiphertext: encrypted.bodyCiphertext,
            bodyEncoding: encrypted.bodyEncoding,
            bodyKeyVersion: encrypted.bodyKeyVersion,
            bodyNonce: encrypted.bodyNonce,
            clientRequestId: randomUuid(),
            conversationId: "conversation-1",
            createdAt: new Date(),
            id: "message-1",
            reactions: [],
            requestFingerprint: "fingerprint",
            sequence: BigInt(1)
          }];
        }
      }
    },
    keyService: {
      async resolveKeyVersion() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      }
    },
    payloadCodec
  } as unknown as MessengerRepositoryDependencies;
  const repository = new MessengerRepository(dependencies);
  await assert.rejects(
    () => repository.listMessages("user-1", "workspace-1", "conversation-1", {
      afterSequence: null,
      beforeSequence: null,
      limit: 50
    }),
    (error) => assertCode(error, "conversation_not_found")
  );
  assert.equal(accessChecks, 2);
});

test("returns client request IDs only to the author and exposes safe reactor identities", async () => {
  const dataKey = Buffer.alloc(32, 4);
  const provider = new AesMessengerKeyProvider({
    activeKeyId: "test-key",
    fingerprintKey: Buffer.alloc(32, 8),
    keys: { "test-key": Buffer.alloc(32, 7) }
  });
  const payloadCodec = new MessengerPayloadCodec(provider, (size) => Buffer.alloc(size, 3));
  const encrypted = payloadCodec.encryptBody({
    body: "visible body",
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  });
  const membership = {
    conversation: {
      lastMessageSequence: BigInt(1),
      retainedFromSequence: BigInt(1)
    },
    historyFromSequence: BigInt(1)
  };
  const dependencies = {
    accessPolicy: {
      async requireConversationReader() {
        return membership;
      }
    },
    client: {
      messengerMessage: {
        async findMany() {
          return [{
            author: {
              color: "blue",
              email: "writer@slate.test",
              id: "user-2",
              initials: "WR",
              name: "Writer"
            },
            authorKind: "member" as const,
            authorUserId: "user-2",
            bodyCiphertext: encrypted.bodyCiphertext,
            bodyEncoding: encrypted.bodyEncoding,
            bodyKeyVersion: encrypted.bodyKeyVersion,
            bodyNonce: encrypted.bodyNonce,
            clientRequestId: randomUuid(),
            conversationId: "conversation-1",
            createdAt: new Date("2026-07-11T10:00:00.000Z"),
            id: "message-1",
            reactions: [{
              createdAt: new Date("2026-07-11T10:01:00.000Z"),
              emoji: "👍",
              id: "reaction-own",
              messageId: "message-1",
              user: { color: "green", id: "user-1", initials: "ME", name: "Reader" },
              userId: "user-1"
            }, {
              createdAt: new Date("2026-07-11T10:02:00.000Z"),
              emoji: "👍",
              id: "reaction-other",
              messageId: "message-1",
              user: { color: "violet", id: "user-3", initials: "OT", name: "Other" },
              userId: "user-3"
            }],
            requestFingerprint: "fingerprint",
            sequence: BigInt(1)
          }];
        }
      }
    },
    keyService: {
      async resolveKeyVersion() {
        return { dataKey: Buffer.from(dataKey), version: 1 };
      }
    },
    payloadCodec
  } as unknown as MessengerRepositoryDependencies;
  const repository = new MessengerRepository(dependencies);
  const history = await repository.listMessages("user-1", "workspace-1", "conversation-1", {
    afterSequence: null,
    beforeSequence: null,
    limit: 50
  });
  assert.equal(history.messages[0].clientRequestId, null);
  assert.deepEqual(history.messages[0].reactions, [{
    count: 2,
    emoji: "👍",
    ownReactionId: "reaction-own",
    reactors: [
      { color: "green", id: "user-1", initials: "ME", name: "Reader" },
      { color: "violet", id: "user-3", initials: "OT", name: "Other" }
    ]
  }]);
});

test("includes the current user's receipt in conversation summaries", async () => {
  const receipt = {
    deliveredAt: new Date("2026-07-11T10:03:00.000Z"),
    deliveredThroughSequence: BigInt(5),
    readAt: new Date("2026-07-11T10:02:00.000Z"),
    readThroughSequence: BigInt(4),
    userId: "user-1"
  };
  const dependencies = {
    accessPolicy: {
      async requireWorkspaceReader() {
        return { role: "editor" as const };
      }
    },
    client: {
      messengerConversationMember: {
        async findFirst() {
          return {
            conversation: {
              activatedAt: new Date("2026-07-11T09:00:00.000Z"),
              id: "conversation-1",
              kind: "general" as const,
              lastMessageAt: new Date("2026-07-11T10:00:00.000Z"),
              lastMessageSequence: BigInt(5),
              members: [{
                joinedAt: new Date("2026-07-11T09:00:00.000Z"),
                state: "active" as const,
                user: {
                  color: "green",
                  email: "reader@slate.test",
                  id: "user-1",
                  initials: "ME",
                  name: "Reader"
                },
                userId: "user-1"
              }],
              retainedFromSequence: BigInt(1),
              workspaceId: "workspace-1"
            },
            conversationId: "conversation-1",
            historyFromSequence: BigInt(1),
            id: "membership-1",
            joinedAt: new Date("2026-07-11T09:00:00.000Z"),
            openedAt: new Date("2026-07-11T09:00:00.000Z"),
            receipt,
            state: "active" as const,
            userId: "user-1"
          };
        }
      },
      messengerMessage: {
        async count() {
          return 1;
        },
        async findFirst() {
          return null;
        }
      }
    }
  } as unknown as MessengerRepositoryDependencies;
  const repository = new MessengerRepository(dependencies);
  const result = await repository.listConversations("user-1", "workspace-1", { cursor: null, limit: 1 });
  assert.deepEqual(result.conversations[0].receipt, {
    deliveredAt: "2026-07-11T10:03:00.000Z",
    deliveredThroughSequence: "5",
    readAt: "2026-07-11T10:02:00.000Z",
    readThroughSequence: "4",
    userId: "user-1"
  });
});

test("rechecks workspace access after converting conversation previews", async () => {
  let accessChecks = 0;
  let previewConverted = false;
  const dependencies = {
    accessPolicy: {
      async requireWorkspaceReader() {
        accessChecks += 1;
        if (accessChecks > 1) {
          assert.equal(previewConverted, true);
          throw new MessengerDomainError("resource_not_found", "Resource was not found", 404);
        }
        return { role: "editor" as const };
      }
    },
    client: {
      messengerConversationMember: {
        async findFirst() {
          return {
            conversation: {
              activatedAt: new Date("2026-07-11T09:00:00.000Z"),
              id: "conversation-1",
              kind: "general" as const,
              lastMessageAt: new Date("2026-07-11T10:00:00.000Z"),
              lastMessageSequence: BigInt(1),
              members: [],
              retainedFromSequence: BigInt(1),
              workspaceId: "workspace-1"
            },
            conversationId: "conversation-1",
            historyFromSequence: BigInt(1),
            id: "membership-1",
            joinedAt: new Date("2026-07-11T09:00:00.000Z"),
            openedAt: new Date("2026-07-11T09:00:00.000Z"),
            receipt: null,
            state: "active" as const,
            userId: "user-1"
          };
        }
      },
      messengerMessage: {
        async count() {
          return 1;
        },
        async findFirst() {
          return {
            author: {
              color: "blue",
              email: "writer@slate.test",
              id: "user-2",
              initials: "WR",
              name: "Writer"
            },
            authorKind: "member" as const,
            authorUserId: "user-2",
            bodyCiphertext: new Uint8Array([1]),
            bodyEncoding: "server_aead_v1" as const,
            bodyKeyVersion: 1,
            bodyNonce: new Uint8Array([2]),
            clientRequestId: randomUuid(),
            conversationId: "conversation-1",
            createdAt: new Date("2026-07-11T10:00:00.000Z"),
            id: "message-1",
            reactions: [],
            requestFingerprint: "fingerprint",
            sequence: BigInt(1)
          };
        }
      }
    },
    keyService: {
      async resolveKeyVersion() {
        return { dataKey: Buffer.alloc(32, 4), version: 1 };
      }
    },
    payloadCodec: {
      decryptBody() {
        previewConverted = true;
        return "must not escape after revocation";
      }
    }
  } as unknown as MessengerRepositoryDependencies;
  const repository = new MessengerRepository(dependencies);
  await assert.rejects(
    () => repository.listConversations("user-1", "workspace-1", { cursor: null, limit: 1 }),
    (error) => assertCode(error, "resource_not_found")
  );
  assert.equal(accessChecks, 2);
  assert.equal(previewConverted, true);
});

function randomUuid() {
  return "e8c947c4-f75c-4e24-a4c4-10416862b94f";
}
