import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { MessengerProvisioningService, type MessengerMembershipEpoch } from "../lib/server/messenger/provisioningService";

type ConversationMemberRow = {
  conversationId: string;
  createdAt: Date;
  historyFromSequence: bigint;
  id: string;
  joinedAt: Date;
  openedAt: Date | null;
  revokedAt: Date | null;
  state: "active" | "revoked";
  updatedAt: Date;
  userId: string;
};

function membership(userId: string, role: WorkspaceRole = "editor"): MessengerMembershipEpoch {
  return {
    id: `workspace-member-${userId}`,
    messengerAccessVersion: 1,
    role,
    userId,
    workspaceId: "workspace-1"
  };
}

function createTransaction() {
  const now = new Date("2026-07-11T10:00:00.000Z");
  const state = {
    audits: [] as Array<{ data: Record<string, unknown> }>,
    blocks: [] as Array<{ userId: string; workspaceId: string }>,
    conversation: null as null | {
      activatedAt: Date;
      createdAt: Date;
      createdByUserId: null;
      directPairKey: null;
      generalKey: string;
      id: string;
      kind: "general";
      lastMessageAt: null;
      lastMessageSequence: bigint;
      retainedFromSequence: bigint;
      updatedAt: Date;
      workspaceId: string;
    },
    keys: [] as Array<Record<string, unknown>>,
    members: new Map<string, ConversationMemberRow>(),
    outbox: [] as Array<{ data: Record<string, unknown> }>,
    receipts: new Map<string, {
      conversationId: string;
      deliveredAt: Date | null;
      deliveredThroughSequence: bigint;
      id: string;
      readAt: Date | null;
      readThroughSequence: bigint;
      updatedAt: Date;
      userId: string;
    }>(),
    workspaceMembers: [] as MessengerMembershipEpoch[]
  };
  const transaction = {
    auditEvent: {
      async create(input: { data: Record<string, unknown> }) {
        state.audits.push(input);
        return input;
      }
    },
    messengerConversation: {
      async create(input: { data: { activatedAt: Date; generalKey: string; kind: "general"; workspaceId: string } }) {
        state.conversation = {
          activatedAt: input.data.activatedAt,
          createdAt: now,
          createdByUserId: null,
          directPairKey: null,
          generalKey: input.data.generalKey,
          id: "general-1",
          kind: input.data.kind,
          lastMessageAt: null,
          lastMessageSequence: BigInt(0),
          retainedFromSequence: BigInt(1),
          updatedAt: now,
          workspaceId: input.data.workspaceId
        };
        return state.conversation;
      },
      async findUnique(input: { where: { generalKey: string } }) {
        return state.conversation?.generalKey === input.where.generalKey ? state.conversation : null;
      }
    },
    messengerConversationMember: {
      async createMany(input: {
        data: Array<{ conversationId: string; historyFromSequence: bigint; joinedAt: Date; state: "active"; userId: string }>;
      }) {
        let count = 0;
        for (const data of input.data) {
          const key = `${data.conversationId}:${data.userId}`;
          if (state.members.has(key)) continue;
          state.members.set(key, {
            ...data,
            createdAt: now,
            id: `conversation-member-${data.userId}`,
            openedAt: null,
            revokedAt: null,
            updatedAt: now
          });
          count += 1;
        }
        return { count };
      },
      async findMany(input: { where: { conversationId: string } }) {
        return [...state.members.values()].filter((member) => member.conversationId === input.where.conversationId);
      },
      async findUnique(input: { where: { conversationId_userId: { conversationId: string; userId: string } } }) {
        const key = `${input.where.conversationId_userId.conversationId}:${input.where.conversationId_userId.userId}`;
        return state.members.get(key) ?? null;
      },
      async updateMany(input: {
        data: Partial<ConversationMemberRow>;
        where: {
          conversationId?: string;
          id?: { in: string[] };
          state?: "active" | "revoked";
          userId?: string | { in: string[] };
        };
      }) {
        let count = 0;
        for (const [key, member] of state.members) {
          const matchesUser = input.where.userId === undefined
            || (typeof input.where.userId === "string"
              ? member.userId === input.where.userId
              : input.where.userId.in.includes(member.userId));
          const matchesId = input.where.id === undefined || input.where.id.in.includes(member.id);
          const matchesState = input.where.state === undefined || member.state === input.where.state;
          const matchesConversation = input.where.conversationId === undefined || member.conversationId === input.where.conversationId;
          if (matchesState && matchesUser && matchesId && matchesConversation) {
            state.members.set(key, { ...member, ...input.data, updatedAt: now });
            count += 1;
          }
        }
        return { count };
      },
      async upsert(input: {
        create: { conversationId: string; historyFromSequence: bigint; joinedAt: Date; state: "active"; userId: string };
        update: { historyFromSequence: bigint; joinedAt?: Date; revokedAt: null; state: "active" };
        where: { conversationId_userId: { conversationId: string; userId: string } };
      }) {
        const identity = input.where.conversationId_userId;
        const key = `${identity.conversationId}:${identity.userId}`;
        const existing = state.members.get(key);
        if (existing) {
          const joinedAt = input.update.joinedAt ?? existing.joinedAt;
          const updated = { ...existing, ...input.update, joinedAt, updatedAt: now };
          state.members.set(key, updated);
          return updated;
        }
        const created: ConversationMemberRow = {
          ...input.create,
          createdAt: now,
          id: `conversation-member-${identity.userId}`,
          openedAt: null,
          revokedAt: null,
          updatedAt: now
        };
        state.members.set(key, created);
        return created;
      }
    },
    messengerKeyEnvelope: {
      async create(input: { data: Record<string, unknown> }) {
        const created = { id: "key-1", ...input.data };
        state.keys.push(created);
        return created;
      },
      async findFirst() {
        return state.keys.find((key) => key.state === "active") ?? null;
      },
      async findMany() {
        return state.keys.filter((key) => key.state === "active").map((key) => ({ id: key.id }));
      }
    },
    messengerMessageReceipt: {
      async createMany(input: { data: Array<{ conversationId: string; userId: string }> }) {
        let count = 0;
        for (const data of input.data) {
          const key = `${data.conversationId}:${data.userId}`;
          if (state.receipts.has(key)) continue;
          state.receipts.set(key, {
            ...data,
            deliveredAt: null,
            deliveredThroughSequence: BigInt(0),
            id: `receipt-${data.userId}`,
            readAt: null,
            readThroughSequence: BigInt(0),
            updatedAt: now
          });
          count += 1;
        }
        return { count };
      },
      async findMany(input: { where: { conversationId: string } }) {
        return [...state.receipts.values()]
          .filter((receipt) => receipt.conversationId === input.where.conversationId);
      },
      async upsert(input: {
        create: { conversationId: string; userId: string };
        where: { conversationId_userId: { conversationId: string; userId: string } };
      }) {
        const identity = input.where.conversationId_userId;
        const key = `${identity.conversationId}:${identity.userId}`;
        const existing = state.receipts.get(key);
        if (existing) return existing;
        const created = {
          conversationId: identity.conversationId,
          deliveredAt: null,
          deliveredThroughSequence: BigInt(0),
          id: `receipt-${identity.userId}`,
          readAt: null,
          readThroughSequence: BigInt(0),
          updatedAt: now,
          userId: identity.userId
        };
        state.receipts.set(key, created);
        return created;
      }
    },
    messengerOutboxEvent: {
      async create(input: { data: Record<string, unknown> }) {
        state.outbox.push(input);
        return input;
      }
    },
    workspaceBlock: {
      async findMany() {
        return state.blocks.map((block) => ({ userId: block.userId }));
      }
    },
    workspaceMember: {
      async findMany() {
        return state.workspaceMembers;
      }
    }
  };
  return { state, transaction: transaction as unknown as Prisma.TransactionClient };
}

test("provisions General, its owner membership, receipt, key envelope and durable event", async () => {
  const service = new MessengerProvisioningService();
  const { state, transaction } = createTransaction();
  const owner = membership("owner-1", "owner");
  await service.provisionGeneral(transaction, {
    member: owner,
    now: new Date("2026-07-11T11:00:00.000Z"),
    preparedKeyEnvelope: {
      algorithm: "aes-256-gcm-v1",
      kmsKeyId: "test-key",
      version: 1,
      wrapNonce: Buffer.alloc(12, 1),
      wrappedDataKey: Buffer.alloc(48, 2)
    }
  });
  assert.equal(state.conversation?.generalKey, "workspace-1");
  assert.equal(state.members.get("general-1:owner-1")?.state, "active");
  assert.equal(state.receipts.has("general-1:owner-1"), true);
  assert.equal(state.keys.length, 1);
  assert.equal(state.outbox.some((event) => event.data.type === "conversation.added"), true);
  assert.equal(state.audits.some((event) => event.data.type === "messenger.general.provisioned"), true);
});

test("activation is idempotent and reactivates a revoked General membership once", async () => {
  const service = new MessengerProvisioningService();
  const { state, transaction } = createTransaction();
  const member = membership("user-1");
  await service.activateGeneralMember(transaction, { member, now: new Date(), reason: "invite_accepted" });
  await service.activateGeneralMember(transaction, { member, now: new Date(), reason: "invite_accepted" });
  assert.equal(state.outbox.filter((event) => event.data.type === "conversation.added").length, 1);
  const stored = state.members.get("general-1:user-1");
  assert.ok(stored);
  state.members.set("general-1:user-1", { ...stored, revokedAt: new Date(), state: "revoked" });
  await service.activateGeneralMember(transaction, { member, now: new Date(), reason: "invite_accepted" });
  assert.equal(state.members.get("general-1:user-1")?.state, "active");
  assert.equal(state.outbox.filter((event) => event.data.type === "conversation.added").length, 2);
  assert.equal(state.receipts.size, 1);
});

test("revocation closes every active conversation membership and targets the removed principal", async () => {
  const service = new MessengerProvisioningService();
  const { state, transaction } = createTransaction();
  const member = membership("user-1");
  await service.activateGeneralMember(transaction, { member, now: new Date(), reason: "invite_accepted" });
  const revokedCount = await service.revokeWorkspaceAccess(transaction, {
    actorUserId: "owner-1",
    member,
    now: new Date(),
    reason: "blocked"
  });
  assert.equal(revokedCount, 1);
  assert.equal(state.members.get("general-1:user-1")?.state, "revoked");
  const event = state.outbox.find((candidate) => candidate.data.type === "access.revoked");
  assert.equal(event?.data.targetUserId, "user-1");
  assert.deepEqual(event?.data.payload, {
    accessVersion: 1,
    membershipId: "workspace-member-user-1",
    reason: "blocked",
    scope: "workspace",
    userId: "user-1"
  });
});

test("reconciliation excludes blocks, activates missing members and revokes stray access", async () => {
  const service = new MessengerProvisioningService();
  const { state, transaction } = createTransaction();
  state.workspaceMembers.push(membership("active-1"), membership("blocked-1"));
  state.blocks.push({ userId: "blocked-1", workspaceId: "workspace-1" });
  await service.activateGeneralMember(transaction, {
    emitEvent: false,
    member: membership("stray-1"),
    now: new Date(),
    reason: "reconciled"
  });
  const result = await service.reconcileGeneral(transaction, {
    now: new Date(),
    preparedKeyEnvelope: {
      algorithm: "aes-256-gcm-v1",
      kmsKeyId: "test-key",
      version: 1,
      wrapNonce: Buffer.alloc(12, 1),
      wrappedDataKey: Buffer.alloc(48, 2)
    },
    workspaceId: "workspace-1"
  });
  assert.equal(result.activeMemberCount, 1);
  assert.equal(result.invariantViolations, 0);
  assert.equal(result.membershipsActivated, 1);
  assert.equal(result.membershipsRevoked, 1);
  assert.equal(result.receiptsCreated, 1);
  assert.equal(state.members.get("general-1:active-1")?.state, "active");
  assert.equal(state.members.has("general-1:blocked-1"), false);
  assert.equal(state.members.get("general-1:stray-1")?.state, "revoked");
});

test("reconciliation fails closed on a receipt above the conversation high-water mark", async () => {
  const service = new MessengerProvisioningService();
  const { state, transaction } = createTransaction();
  const member = membership("active-1");
  state.workspaceMembers.push(member);
  await service.provisionGeneral(transaction, {
    member,
    now: new Date(),
    preparedKeyEnvelope: {
      algorithm: "aes-256-gcm-v1",
      kmsKeyId: "test-key",
      version: 1,
      wrapNonce: Buffer.alloc(12, 1),
      wrappedDataKey: Buffer.alloc(48, 2)
    }
  });
  const receipt = state.receipts.get("general-1:active-1");
  assert.ok(receipt);
  state.receipts.set("general-1:active-1", {
    ...receipt,
    deliveredAt: new Date(),
    deliveredThroughSequence: BigInt(2),
    readAt: new Date(),
    readThroughSequence: BigInt(2)
  });
  await assert.rejects(
    () => service.reconcileGeneral(transaction, { now: new Date(), workspaceId: "workspace-1" }),
    /Messenger reconciliation invariant failed/
  );
});
