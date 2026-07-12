import { randomUUID } from "node:crypto";
import { Prisma, type MessengerAuthorKind, type MessengerConversationKind, type MessengerMessageAttachment, type WorkspaceRole } from "@prisma/client";
import { prisma } from "../prisma";
import { messengerAccessPolicy, type MessengerAccessPolicy } from "./accessPolicy";
import { messengerAiService } from "./messengerAiService";
import { messengerPayloadCodec, type MessengerPayloadCodec } from "./cryptography";
import { createDirectPairKey } from "./directConversation";
import { MessengerDomainError } from "./errors";
import { messengerKeyEnvelopeService, type MessengerKeyEnvelopeService, type ResolvedMessengerDataKey } from "./keyEnvelopeService";
import { messengerOutboxRepository, type MessengerOutboxRepository } from "./outboxRepository";
import type { MessengerHistoryQuery, MessengerReceiptInput, MessengerSendInput, MessengerReactionEmoji } from "./input";

const messageRelations = {
  attachments: {
    orderBy: { createdAt: "asc" as const },
    where: { status: "attached" as const }
  },
  author: {
    select: {
      color: true,
      email: true,
      id: true,
      initials: true,
      name: true
    }
  },
  reactions: {
    include: {
      user: {
        select: {
          color: true,
          id: true,
          initials: true,
          name: true
        }
      }
    },
    orderBy: { createdAt: "asc" as const }
  },
  sourceAiInvocation: {
    include: {
      handoffs: {
        select: { requestedByUserId: true }
      }
    }
  }
} satisfies Prisma.MessengerMessageInclude;

const conversationMembershipRelations = {
  conversation: {
    include: {
      members: {
        include: {
          user: {
            select: {
              color: true,
              email: true,
              id: true,
              initials: true,
              name: true
            }
          }
        },
        orderBy: { joinedAt: "asc" as const }
      }
    }
  },
  receipt: true
} satisfies Prisma.MessengerConversationMemberInclude;

type MessageRow = Prisma.MessengerMessageGetPayload<{ include: typeof messageRelations }>;
type ConversationMembershipRow = Prisma.MessengerConversationMemberGetPayload<{
  include: typeof conversationMembershipRelations;
}>;

type ConversationListQuery = {
  cursor: string | null;
  limit: number;
};

export type MessengerRepositoryDependencies = {
  accessPolicy: Pick<MessengerAccessPolicy, "requireConversationReader" | "requireConversationReaderWithClient" | "requireConversationWriter" | "requireConversationWriterWithClient" | "requireWorkspaceReader">;
  client: typeof prisma;
  keyService: Pick<MessengerKeyEnvelopeService, "ensureActiveKey" | "resolveKeyVersion">;
  outboxRepository: Pick<MessengerOutboxRepository, "append">;
  payloadCodec: Pick<MessengerPayloadCodec, "createRequestFingerprint" | "decryptAttachmentFileName" | "decryptBody" | "encryptBody">;
};

const defaultDependencies: MessengerRepositoryDependencies = {
  accessPolicy: messengerAccessPolicy,
  client: prisma,
  keyService: messengerKeyEnvelopeService,
  outboxRepository: messengerOutboxRepository,
  payloadCodec: messengerPayloadCodec
};

const writerRoles = new Set<WorkspaceRole>(["owner", "editor"]);

export class MessengerRepository {
  constructor(
    private readonly dependencies: MessengerRepositoryDependencies = defaultDependencies,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env
  ) {}

  async listUnread(userId: string, workspaceId: string) {
    await this.dependencies.accessPolicy.requireWorkspaceReader(userId, workspaceId);
    const memberships = await this.dependencies.client.messengerConversationMember.findMany({
      include: { conversation: true, receipt: true },
      where: {
        conversation: { workspaceId },
        state: "active",
        userId
      }
    });
    const visibleMemberships = memberships.filter((membership) => this.isMembershipVisible(membership));
    const byConversation = await Promise.all(visibleMemberships.map(async (membership) => ({
      conversationId: membership.conversationId,
      unreadCount: await this.countUnreadMessages(userId, membership)
    })));
    return {
      byConversation,
      total: byConversation.reduce((total, conversation) => total + conversation.unreadCount, 0)
    };
  }

  async listConversations(userId: string, workspaceId: string, query: ConversationListQuery) {
    const workspaceMember = await this.dependencies.accessPolicy.requireWorkspaceReader(userId, workspaceId);
    const decodedCursor = query.cursor ? this.decodeConversationCursor(query.cursor) : null;
    if (decodedCursor) {
      const cursorMembership = await this.dependencies.client.messengerConversationMember.findFirst({
        select: { id: true },
        where: {
          conversation: { kind: "direct", workspaceId },
          id: decodedCursor,
          state: "active",
          userId
        }
      });
      if (!cursorMembership) {
        throw new MessengerDomainError("invalid_cursor", "Conversation cursor is invalid", 400);
      }
    }
    const general = decodedCursor
      ? null
      : await this.dependencies.client.messengerConversationMember.findFirst({
          include: conversationMembershipRelations,
          where: {
            conversation: { kind: "general", workspaceId },
            state: "active",
            userId
          }
        });
    const remaining = Math.max(0, query.limit - (general ? 1 : 0));
    const directMemberships = remaining > 0
      ? await this.dependencies.client.messengerConversationMember.findMany({
          cursor: decodedCursor ? { id: decodedCursor } : undefined,
          include: conversationMembershipRelations,
          orderBy: [
            { conversation: { lastMessageAt: "desc" } },
            { id: "desc" }
          ],
          skip: decodedCursor ? 1 : 0,
          take: remaining + 1,
          where: {
            conversation: {
              kind: "direct",
              workspaceId
            },
            OR: [
              { conversation: { activatedAt: { not: null } } },
              { openedAt: { not: null } }
            ],
            state: "active",
            userId
          }
        })
      : [];
    const hasMore = directMemberships.length > remaining;
    const page = [
      ...(general ? [general] : []),
      ...directMemberships.slice(0, remaining)
    ];
    const conversations = await Promise.all(page.map((membership) => this.toConversationDto(userId, workspaceMember.role, membership)));
    await this.dependencies.accessPolicy.requireWorkspaceReader(userId, workspaceId);
    const finalDirect = directMemberships.slice(0, remaining).at(-1);
    return {
      conversations,
      nextCursor: hasMore && finalDirect ? this.encodeConversationCursor(finalDirect.id) : null
    };
  }

  async openDirectConversation(userId: string, workspaceId: string, recipientUserId: string) {
    const directPairKey = createDirectPairKey(userId, recipientUserId);
    const result = await this.runSerializable(async (transaction) => {
      const [requester, recipient, blocks] = await Promise.all([
        transaction.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }),
        transaction.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: recipientUserId, workspaceId } } }),
        transaction.workspaceBlock.findMany({ where: { userId: { in: [userId, recipientUserId] }, workspaceId } })
      ]);
      const requesterBlocked = blocks.some((block) => block.userId === userId);
      const recipientBlocked = blocks.some((block) => block.userId === recipientUserId);
      if (!requester || requesterBlocked) {
        throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
      }
      if (!writerRoles.has(requester.role)) {
        throw new MessengerDomainError("workspace_write_denied", "Workspace role is read-only", 403);
      }
      if (!recipient || recipientBlocked) {
        throw new MessengerDomainError("recipient_unavailable", "Recipient is unavailable", 404);
      }
      const existing = await transaction.messengerConversation.findUnique({
        include: { members: true },
        where: { workspaceId_directPairKey: { directPairKey, workspaceId } }
      });
      const now = new Date();
      const conversation = existing ?? await transaction.messengerConversation.create({
        data: {
          createdByUserId: userId,
          directPairKey,
          kind: "direct",
          workspaceId
        }
      });
      const existingByUserId = new Map((existing?.members ?? []).map((member) => [member.userId, member]));
      const reactivating = Boolean(existing) && [userId, recipientUserId].some((memberId) => existingByUserId.get(memberId)?.state === "revoked");
      const memberIds = [userId, recipientUserId];
      for (const memberId of memberIds) {
        const current = existingByUserId.get(memberId);
        await transaction.messengerConversationMember.upsert({
          create: {
            conversationId: conversation.id,
            historyFromSequence: BigInt(1),
            joinedAt: now,
            openedAt: memberId === userId ? now : null,
            state: "active",
            userId: memberId
          },
          update: {
            joinedAt: current?.state === "revoked" ? now : current?.joinedAt,
            openedAt: memberId === userId ? now : current?.openedAt,
            revokedAt: null,
            state: "active"
          },
          where: { conversationId_userId: { conversationId: conversation.id, userId: memberId } }
        });
        await transaction.messengerMessageReceipt.upsert({
          create: { conversationId: conversation.id, userId: memberId },
          update: {},
          where: { conversationId_userId: { conversationId: conversation.id, userId: memberId } }
        });
      }
      const memberships = await transaction.messengerConversationMember.findMany({ where: { conversationId: conversation.id } });
      const membershipByUserId = new Map(memberships.map((member) => [member.userId, member]));
      const targets = reactivating ? memberIds : [userId];
      for (const targetUserId of targets) {
        const member = membershipByUserId.get(targetUserId);
        if (!member) throw new MessengerDomainError("messenger_invariant_failed", "Direct conversation membership is missing", 503);
        await this.dependencies.outboxRepository.append(transaction, {
          conversationId: conversation.id,
          payload: {
            conversationId: conversation.id,
            membershipId: member.id,
            reason: reactivating ? "reactivated" : "opened",
            userId: targetUserId
          },
          targetUserId,
          type: "conversation.added",
          workspaceId
        });
      }
      return { conversationId: conversation.id, created: !existing };
    }, true);
    const workspaceMember = await this.dependencies.accessPolicy.requireWorkspaceReader(userId, workspaceId);
    const membership = await this.dependencies.client.messengerConversationMember.findFirst({
      include: conversationMembershipRelations,
      where: { conversationId: result.conversationId, state: "active", userId }
    });
    if (!membership) throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
    return { conversation: await this.toConversationDto(userId, workspaceMember.role, membership), created: result.created };
  }

  async listMessages(
    userId: string,
    workspaceId: string,
    conversationId: string,
    query: MessengerHistoryQuery
  ) {
    const membership = await this.dependencies.accessPolicy.requireConversationReader(userId, workspaceId, conversationId);
    const historyFloor = this.maximumSequence(membership.historyFromSequence, membership.conversation.retainedFromSequence);
    const sequenceFilter: Prisma.BigIntFilter = { gte: historyFloor };
    if (query.beforeSequence !== null) sequenceFilter.lt = query.beforeSequence;
    if (query.afterSequence !== null) sequenceFilter.gt = query.afterSequence;
    const ascending = query.afterSequence !== null;
    const rows = await this.dependencies.client.messengerMessage.findMany({
      include: messageRelations,
      orderBy: { sequence: ascending ? "asc" : "desc" },
      take: query.limit + 1,
      where: {
        deletedAt: null,
        deletingAt: null,
        conversation: {
          members: { some: { state: "active", userId } },
          workspace: {
            blocks: { none: { userId } },
            members: { some: { userId } }
          },
          workspaceId
        },
        conversationId,
        sequence: sequenceFilter
      }
    });
    const hasExtra = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    if (!ascending) pageRows.reverse();
    const messages = await this.toMessageDtos(userId, workspaceId, pageRows);
    await this.dependencies.accessPolicy.requireConversationReader(userId, workspaceId, conversationId);
    const oldestSequence = pageRows[0]?.sequence ?? null;
    const newestSequence = pageRows.at(-1)?.sequence ?? null;
    const serverLastSequence = membership.conversation.lastMessageSequence;
    const resolvedThroughSequence = query.afterSequence !== null && !hasExtra
      ? serverLastSequence
      : newestSequence ?? this.maximumSequence(query.afterSequence ?? BigInt(0), historyFloor - BigInt(1));
    return {
      hasMoreAfter: query.afterSequence !== null ? hasExtra : newestSequence !== null && newestSequence < serverLastSequence,
      hasMoreBefore: query.afterSequence === null
        ? hasExtra
        : oldestSequence !== null && oldestSequence > historyFloor,
      messages,
      newestSequence: newestSequence?.toString() ?? null,
      oldestSequence: oldestSequence?.toString() ?? null,
      retainedFromSequence: membership.conversation.retainedFromSequence.toString(),
      resolvedThroughSequence: resolvedThroughSequence.toString(),
      serverLastSequence: serverLastSequence.toString()
    };
  }

  async sendMessage(userId: string, workspaceId: string, conversationId: string, input: MessengerSendInput) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    const attachmentIds = [...(input.attachmentIds ?? [])].sort();
    const aiAttachmentIds = [...(input.aiAttachmentIds ?? [])].sort();
    const fingerprint = this.dependencies.payloadCodec.createRequestFingerprint({
      attachmentIds,
      aiAttachmentIds,
      authorUserId: userId,
      body: input.body ?? "",
      conversationId,
      workspaceId
    });
    const activeKey = await this.dependencies.keyService.ensureActiveKey(workspaceId);
    let result: { aiInvocation: { id: string; status: string } | null; messageId: string; replayed: boolean };
    try {
      result = await this.runSerializable(async (transaction) => {
        await this.dependencies.accessPolicy.requireConversationWriterWithClient(transaction, userId, workspaceId, conversationId);
        const existing = await transaction.messengerMessage.findUnique({
          where: {
            conversationId_authorUserId_clientRequestId: {
              authorUserId: userId,
              clientRequestId: input.clientRequestId,
              conversationId
            }
          }
        });
        if (existing) {
          this.assertMatchingFingerprint(existing.requestFingerprint, fingerprint);
          return { aiInvocation: null, messageId: existing.id, replayed: true };
        }
        const activeEnvelope = await transaction.messengerKeyEnvelope.findUnique({
          select: { state: true },
          where: { workspaceId_version: { version: activeKey.version, workspaceId } }
        });
        if (activeEnvelope?.state !== "active") {
          throw new MessengerDomainError("messenger_key_changed", "Messenger data key changed during the request", 409, true);
        }
        const now = new Date();
        const attachments = attachmentIds.length === 0 ? [] : await transaction.messengerMessageAttachment.findMany({
          where: { id: { in: attachmentIds } }
        });
        this.requireClaimableAttachments(attachments, {
          attachmentIds,
          conversationId,
          now,
          userId,
          workspaceId
        });
        if (attachmentIds.length > 0) await this.requireAttachmentQuota(transaction, userId, workspaceId);
        const conversationBeforeUpdate = await (transaction.messengerConversation as unknown as {
          findUnique?: (input: { select: { activatedAt: true; kind: true }; where: { id: string } }) => Promise<{ activatedAt: Date | null; kind: MessengerConversationKind } | null>;
        }).findUnique?.({
          select: { activatedAt: true, kind: true },
          where: { id: conversationId }
        });
        const conversation = await transaction.messengerConversation.update({
          data: {
            activatedAt: conversationBeforeUpdate?.kind === "direct" ? conversationBeforeUpdate.activatedAt ?? now : undefined,
            lastMessageAt: now,
            lastMessageSequence: { increment: 1 }
          },
          select: { lastMessageSequence: true },
          where: { id: conversationId }
        });
        if (conversationBeforeUpdate?.kind === "direct" && !conversationBeforeUpdate.activatedAt) {
          const recipients = await transaction.messengerConversationMember.findMany({ where: { conversationId, state: "active" } });
          for (const recipient of recipients) {
            if (recipient.userId === userId) continue;
            await this.dependencies.outboxRepository.append(transaction, {
              conversationId,
              payload: { conversationId, membershipId: recipient.id, reason: "activated", userId: recipient.userId },
              targetUserId: recipient.userId,
              type: "conversation.added",
              workspaceId
            });
          }
        }
        const messageId = randomUUID();
        const encryptedBody = input.body ? this.dependencies.payloadCodec.encryptBody({
          body: input.body,
          conversationId,
          dataKey: activeKey.dataKey,
          keyVersion: activeKey.version,
          messageId,
          workspaceId
        }) : null;
        const message = await transaction.messengerMessage.create({
          data: {
            authorKind: "member",
            authorUserId: userId,
            bodyCiphertext: encryptedBody ? new Uint8Array(encryptedBody.bodyCiphertext) : null,
            bodyEncoding: encryptedBody?.bodyEncoding,
            bodyKeyVersion: encryptedBody?.bodyKeyVersion,
            bodyNonce: encryptedBody ? new Uint8Array(encryptedBody.bodyNonce) : null,
            clientRequestId: input.clientRequestId,
            conversationId,
            id: messageId,
            requestFingerprint: fingerprint,
            sequence: conversation.lastMessageSequence
          }
        });
        if (attachmentIds.length > 0) {
          const claimed = await transaction.messengerMessageAttachment.updateMany({
            data: { attachedAt: now, messageId: message.id, status: "attached" },
            where: { id: { in: attachmentIds }, messageId: null, status: "ready" }
          });
          if (claimed.count !== attachmentIds.length) {
            throw new MessengerDomainError("attachment_claim_conflict", "Attachment was claimed concurrently", 409);
          }
        }
        await transaction.messengerMessageReceipt.upsert({
          create: {
            conversationId,
            deliveredAt: now,
            deliveredThroughSequence: message.sequence,
            readAt: now,
            readThroughSequence: message.sequence,
            userId
          },
          update: {
            deliveredAt: now,
            deliveredThroughSequence: message.sequence,
            readAt: now,
            readThroughSequence: message.sequence
          },
          where: {
            conversationId_userId: { conversationId, userId }
          }
        });
        await this.dependencies.outboxRepository.append(transaction, {
          conversationId,
          payload: {
            messageId: message.id,
            sequence: message.sequence.toString()
          },
          type: "message.created",
          workspaceId
        });
        await this.dependencies.outboxRepository.append(transaction, {
          conversationId,
          payload: { conversationId },
          type: "conversation.changed",
          workspaceId
        });
        const aiInvocation = await messengerAiService.createInvocationInTransaction(transaction, {
          aiAttachmentIds,
          body: input.body,
          conversationId,
          messageId: message.id,
          sequence: message.sequence,
          userId,
          workspaceId
        });
        return { aiInvocation, messageId: message.id, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await this.dependencies.client.messengerMessage.findUnique({
        where: {
          conversationId_authorUserId_clientRequestId: {
            authorUserId: userId,
            clientRequestId: input.clientRequestId,
            conversationId
          }
        }
      });
      if (!existing) throw error;
      this.assertMatchingFingerprint(existing.requestFingerprint, fingerprint);
      result = { aiInvocation: null, messageId: existing.id, replayed: true };
    } finally {
      activeKey.dataKey.fill(0);
    }
    const message = await this.requireMessageRow(workspaceId, conversationId, result.messageId);
    const [dto] = await this.toMessageDtos(userId, workspaceId, [message]);
    return { aiInvocation: result.aiInvocation, message: dto, replayed: result.replayed };
  }

  async updateReceipt(
    userId: string,
    workspaceId: string,
    conversationId: string,
    input: MessengerReceiptInput
  ) {
    await this.dependencies.accessPolicy.requireConversationReader(userId, workspaceId, conversationId);
    return this.runSerializable(async (transaction) => {
      const membership = await this.dependencies.accessPolicy.requireConversationReaderWithClient(
        transaction,
        userId,
        workspaceId,
        conversationId
      );
      const receipt = await transaction.messengerMessageReceipt.findUnique({
        where: { conversationId_userId: { conversationId, userId } }
      });
      if (!receipt) {
        throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
      }
      const deliveredThroughSequence = this.maximumSequence(
        receipt.deliveredThroughSequence,
        input.deliveredThroughSequence ?? receipt.deliveredThroughSequence
      );
      const readThroughSequence = this.maximumSequence(
        receipt.readThroughSequence,
        input.readThroughSequence ?? receipt.readThroughSequence
      );
      const visibleFloor = this.maximumSequence(
        membership.historyFromSequence,
        membership.conversation.retainedFromSequence
      );
      const proposedAdvances = [
        input.deliveredThroughSequence !== undefined && input.deliveredThroughSequence > receipt.deliveredThroughSequence
          ? input.deliveredThroughSequence
          : null,
        input.readThroughSequence !== undefined && input.readThroughSequence > receipt.readThroughSequence
          ? input.readThroughSequence
          : null
      ].filter((sequence): sequence is bigint => sequence !== null && sequence > BigInt(0));
      if (
        readThroughSequence > deliveredThroughSequence
        || deliveredThroughSequence > membership.conversation.lastMessageSequence
        || readThroughSequence > membership.conversation.lastMessageSequence
        || proposedAdvances.some((sequence) => sequence < visibleFloor)
      ) {
        throw new MessengerDomainError("invalid_cursor", "Receipt cursor is outside the visible conversation range", 400);
      }
      if (proposedAdvances.length > 0) {
        const visibleSequences = await transaction.messengerMessage.findMany({
          select: { sequence: true },
          where: {
            conversationId,
            deletedAt: null,
            deletingAt: null,
            sequence: { in: [...new Set(proposedAdvances)] }
          }
        });
        const visibleSequenceSet = new Set(visibleSequences.map((message) => message.sequence.toString()));
        if (proposedAdvances.some((sequence) => !visibleSequenceSet.has(sequence.toString()))) {
          throw new MessengerDomainError("invalid_cursor", "Receipt cursor is outside the visible conversation range", 400);
        }
      }
      const changed = deliveredThroughSequence !== receipt.deliveredThroughSequence
        || readThroughSequence !== receipt.readThroughSequence;
      if (!changed) return this.toReceiptDto(receipt);
      const now = new Date();
      const updated = await transaction.messengerMessageReceipt.update({
        data: {
          deliveredAt: deliveredThroughSequence > receipt.deliveredThroughSequence ? now : receipt.deliveredAt,
          deliveredThroughSequence,
          readAt: readThroughSequence > receipt.readThroughSequence ? now : receipt.readAt,
          readThroughSequence
        },
        where: { id: receipt.id }
      });
      await this.dependencies.outboxRepository.append(transaction, {
        conversationId,
        payload: {
          deliveredThroughSequence: updated.deliveredThroughSequence.toString(),
          readThroughSequence: updated.readThroughSequence.toString(),
          userId
        },
        targetUserId: userId,
        type: "receipt.changed",
        workspaceId
      });
      return this.toReceiptDto(updated);
    });
  }

  async addReaction(
    userId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
    emoji: MessengerReactionEmoji
  ) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    return this.runSerializable(async (transaction) => {
      await this.dependencies.accessPolicy.requireConversationWriterWithClient(transaction, userId, workspaceId, conversationId);
      const message = await transaction.messengerMessage.findFirst({
        select: { id: true, sequence: true },
        where: { conversationId, deletedAt: null, deletingAt: null, id: messageId }
      });
      if (!message) {
        throw new MessengerDomainError("message_not_found", "Message was not found", 404);
      }
      const existing = await transaction.messengerMessageReaction.findUnique({
        where: { messageId_userId_emoji: { emoji, messageId, userId } }
      });
      if (existing) return this.toReactionDto(existing);
      const reaction = await transaction.messengerMessageReaction.create({
        data: { emoji, messageId, userId }
      });
      await this.dependencies.outboxRepository.append(transaction, {
        conversationId,
        payload: { messageId, sequence: message.sequence.toString() },
        type: "reaction.changed",
        workspaceId
      });
      return this.toReactionDto(reaction);
    });
  }

  async removeReaction(
    userId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
    reactionId: string
  ) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    return this.runSerializable(async (transaction) => {
      await this.dependencies.accessPolicy.requireConversationWriterWithClient(transaction, userId, workspaceId, conversationId);
      const reaction = await transaction.messengerMessageReaction.findFirst({
        include: { message: { select: { conversationId: true, sequence: true } } },
        where: { id: reactionId, messageId, userId }
      });
      if (!reaction || reaction.message.conversationId !== conversationId) {
        throw new MessengerDomainError("message_not_found", "Message was not found", 404);
      }
      await transaction.messengerMessageReaction.delete({ where: { id: reaction.id } });
      await this.dependencies.outboxRepository.append(transaction, {
        conversationId,
        payload: { messageId, sequence: reaction.message.sequence.toString() },
        type: "reaction.changed",
        workspaceId
      });
      return { id: reaction.id };
    });
  }

  private async toConversationDto(
    userId: string,
    role: WorkspaceRole,
    membership: ConversationMembershipRow
  ) {
    const [lastMessage, unreadCount] = await Promise.all([
      this.dependencies.client.messengerMessage.findFirst({
        include: messageRelations,
        orderBy: { sequence: "desc" },
        where: { conversationId: membership.conversationId, deletedAt: null, deletingAt: null }
      }),
      this.countUnreadMessages(userId, membership)
    ]);
    const lastMessageDto = lastMessage
      ? (await this.toMessageDtos(userId, membership.conversation.workspaceId, [lastMessage]))[0]
      : null;
    const participants = membership.conversation.members.map((member) => ({
      color: member.user.color,
      email: member.user.email,
      id: member.user.id,
      initials: member.user.initials,
      joinedAt: member.joinedAt.toISOString(),
      name: member.user.name,
      state: member.state,
      userId: member.userId
    }));
    const otherParticipant = participants.find((participant) => participant.userId !== userId);
    return {
      activatedAt: membership.conversation.activatedAt?.toISOString() ?? null,
      capabilities: {
        canRead: true,
        canReact: writerRoles.has(role) && this.isConversationWritable(membership),
        canSend: writerRoles.has(role) && this.isConversationWritable(membership)
      },
      id: membership.conversation.id,
      kind: membership.conversation.kind,
      lastMessage: lastMessageDto,
      lastMessageAt: membership.conversation.lastMessageAt?.toISOString() ?? null,
      lastMessageSequence: membership.conversation.lastMessageSequence.toString(),
      participants,
      receipt: membership.receipt ? this.toReceiptDto(membership.receipt) : null,
      retainedFromSequence: membership.conversation.retainedFromSequence.toString(),
      title: membership.conversation.kind === "general" ? "General" : otherParticipant?.name ?? "Direct message",
      unreadCount,
      workspaceId: membership.conversation.workspaceId
    };
  }

  private async countUnreadMessages(
    userId: string,
    membership: {
      conversation: { retainedFromSequence: bigint };
      conversationId: string;
      historyFromSequence: bigint;
      receipt: { readThroughSequence: bigint } | null;
    }
  ) {
    const readThroughSequence = membership.receipt?.readThroughSequence ?? BigInt(0);
    const minimumSequence = this.maximumSequence(
      readThroughSequence + BigInt(1),
      membership.historyFromSequence,
      membership.conversation.retainedFromSequence
    );
    return this.dependencies.client.messengerMessage.count({
      where: {
        OR: [
          { authorUserId: null },
          { authorUserId: { not: userId } }
        ],
        conversationId: membership.conversationId,
        deletedAt: null,
        deletingAt: null,
        sequence: { gte: minimumSequence }
      }
    });
  }

  private async requireMessageRow(workspaceId: string, conversationId: string, messageId: string) {
    const message = await this.dependencies.client.messengerMessage.findFirst({
      include: messageRelations,
      where: {
        conversation: { workspaceId },
        conversationId,
        deletedAt: null,
        deletingAt: null,
        id: messageId
      }
    });
    if (!message) {
      throw new MessengerDomainError("message_not_found", "Message was not found", 404);
    }
    return message;
  }

  private async toMessageDtos(userId: string, workspaceId: string, messages: MessageRow[]) {
    const keys = new Map<number, ResolvedMessengerDataKey>();
    try {
      const result = [];
      for (const message of messages) {
        let body: string | null = null;
        if (message.bodyCiphertext && message.bodyNonce && message.bodyKeyVersion) {
          let key = keys.get(message.bodyKeyVersion);
          if (!key) {
            key = await this.dependencies.keyService.resolveKeyVersion(workspaceId, message.bodyKeyVersion);
            keys.set(message.bodyKeyVersion, key);
          }
          body = this.dependencies.payloadCodec.decryptBody({
            bodyCiphertext: Buffer.from(message.bodyCiphertext),
            bodyEncoding: message.bodyEncoding,
            bodyNonce: Buffer.from(message.bodyNonce),
            conversationId: message.conversationId,
            dataKey: key.dataKey,
            keyVersion: message.bodyKeyVersion,
            messageId: message.id,
            workspaceId
          });
        }
        result.push({
          attachments: await Promise.all((message.attachments ?? []).map(async (attachment) => {
            let key = keys.get(attachment.fileNameKeyVersion);
            if (!key) {
              key = await this.dependencies.keyService.resolveKeyVersion(workspaceId, attachment.fileNameKeyVersion);
              keys.set(attachment.fileNameKeyVersion, key);
            }
            return {
              byteSize: (attachment.verifiedByteSize ?? attachment.declaredByteSize).toString(),
              contentType: attachment.detectedContentType ?? attachment.declaredContentType,
              durationMs: attachment.durationMs,
              fileName: this.dependencies.payloadCodec.decryptAttachmentFileName({
                attachmentId: attachment.id,
                ciphertext: Buffer.from(attachment.fileNameCiphertext),
                conversationId: attachment.conversationId,
                dataKey: key.dataKey,
                keyVersion: attachment.fileNameKeyVersion,
                nonce: Buffer.from(attachment.fileNameNonce),
                workspaceId
              }),
              height: attachment.height,
              id: attachment.id,
              kind: attachment.kind,
              status: attachment.status,
              width: attachment.width
            };
          })),
          aiInvocation: message.sourceAiInvocation ? {
            canOpenAssistant: message.sourceAiInvocation.requestedByUserId === userId && message.sourceAiInvocation.status === "completed",
            errorCode: message.sourceAiInvocation.errorCode,
            handoffCreated: message.sourceAiInvocation.handoffs.some((handoff) => handoff.requestedByUserId === userId),
            id: message.sourceAiInvocation.id,
            responseMessageId: message.sourceAiInvocation.responseMessageId,
            sourceMessageId: message.sourceAiInvocation.sourceMessageId,
            status: message.sourceAiInvocation.status
          } : null,
          author: this.toAuthorDto(message.authorKind, message.author),
          body,
          clientRequestId: message.authorUserId === userId ? message.clientRequestId : null,
          conversationId: message.conversationId,
          createdAt: message.createdAt.toISOString(),
          id: message.id,
          inReplyToMessageId: message.inReplyToMessageId,
          reactions: this.aggregateReactions(userId, message.reactions),
          sequence: message.sequence.toString()
        });
      }
      return result;
    } finally {
      for (const key of keys.values()) key.dataKey.fill(0);
    }
  }

  private requireClaimableAttachments(
    attachments: MessengerMessageAttachment[],
    input: {
      attachmentIds: string[];
      conversationId: string;
      now: Date;
      userId: string;
      workspaceId: string;
    }
  ) {
    if (attachments.length !== input.attachmentIds.length) {
      throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
    }
    const totalBytes = attachments.reduce((total, attachment) => total + (attachment.verifiedByteSize ?? BigInt(0)), BigInt(0));
    const videoCount = attachments.filter((attachment) => attachment.kind === "video").length;
    if (totalBytes > BigInt(300 * 1024 * 1024) || videoCount > 2) {
      throw new MessengerDomainError("invalid_attachment", "Attachment message limits exceeded", 400);
    }
    for (const attachment of attachments) {
      if (attachment.workspaceId !== input.workspaceId
        || attachment.conversationId !== input.conversationId
        || attachment.createdByUserId !== input.userId
        || attachment.status !== "ready"
        || attachment.messageId !== null
        || attachment.expiresAt <= input.now
        || attachment.verifiedByteSize === null
        || !attachment.detectedContentType
        || !attachment.checksumSha256) {
        throw new MessengerDomainError("attachment_state_conflict", "Attachment is not ready to send", 409);
      }
    }
  }

  private async requireAttachmentQuota(transaction: Prisma.TransactionClient, userId: string, workspaceId: string) {
    const statuses = ["reserved", "uploaded", "scanning", "ready", "attached"] as const;
    const [userUsage, workspaceUsage] = await Promise.all([
      transaction.messengerMessageAttachment.aggregate({
        _sum: { declaredByteSize: true },
        where: { createdByUserId: userId, status: { in: [...statuses] }, workspaceId }
      }),
      transaction.messengerMessageAttachment.aggregate({
        _sum: { declaredByteSize: true },
        where: { status: { in: [...statuses] }, workspaceId }
      })
    ]);
    const userQuota = this.readPositiveQuota("MESSENGER_STORAGE_USER_QUOTA_BYTES", 1024 * 1024 * 1024);
    const workspaceQuota = this.readPositiveQuota("MESSENGER_STORAGE_WORKSPACE_QUOTA_BYTES", 5 * 1024 * 1024 * 1024);
    if ((userUsage._sum.declaredByteSize ?? BigInt(0)) > BigInt(userQuota)
      || (workspaceUsage._sum.declaredByteSize ?? BigInt(0)) > BigInt(workspaceQuota)) {
      throw new MessengerDomainError("attachment_quota_exceeded", "Attachment storage quota exceeded", 413);
    }
  }

  private readPositiveQuota(name: string, fallback: number) {
    const value = this.environment[name];
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new MessengerDomainError("storage_configuration_invalid", "Attachment quota is invalid", 503);
    }
    return parsed;
  }

  private toAuthorDto(
    authorKind: MessengerAuthorKind,
    author: MessageRow["author"]
  ) {
    if (authorKind === "member" && author) {
      return {
        color: author.color,
        email: author.email,
        id: author.id,
        initials: author.initials,
        kind: authorKind,
        name: author.name
      };
    }
    return {
      color: "slate",
      email: null,
      id: null,
      initials: authorKind === "slate_ai" ? "AI" : "S",
      kind: authorKind,
      name: authorKind === "slate_ai" ? "Slate AI" : "Slate"
    };
  }

  private aggregateReactions(userId: string, reactions: MessageRow["reactions"]) {
    const groups = new Map<string, {
      count: number;
      emoji: string;
      ownReactionId: string | null;
      reactors: Array<{ color: string; id: string; initials: string; name: string }>;
    }>();
    for (const reaction of reactions) {
      const group = groups.get(reaction.emoji) ?? { count: 0, emoji: reaction.emoji, ownReactionId: null, reactors: [] };
      group.count += 1;
      if (reaction.userId === userId) group.ownReactionId = reaction.id;
      group.reactors.push({
        color: reaction.user.color,
        id: reaction.user.id,
        initials: reaction.user.initials,
        name: reaction.user.name
      });
      groups.set(reaction.emoji, group);
    }
    return [...groups.values()];
  }

  private toReceiptDto(receipt: {
    deliveredAt: Date | null;
    deliveredThroughSequence: bigint;
    readAt: Date | null;
    readThroughSequence: bigint;
    userId: string;
  }) {
    return {
      deliveredAt: receipt.deliveredAt?.toISOString() ?? null,
      deliveredThroughSequence: receipt.deliveredThroughSequence.toString(),
      readAt: receipt.readAt?.toISOString() ?? null,
      readThroughSequence: receipt.readThroughSequence.toString(),
      userId: receipt.userId
    };
  }

  private toReactionDto(reaction: { createdAt: Date; emoji: string; id: string; messageId: string; userId: string }) {
    return {
      createdAt: reaction.createdAt.toISOString(),
      emoji: reaction.emoji,
      id: reaction.id,
      messageId: reaction.messageId,
      userId: reaction.userId
    };
  }

  private assertMatchingFingerprint(existing: string | null, requested: string) {
    if (existing !== requested) {
      throw new MessengerDomainError("idempotency_conflict", "clientRequestId was already used for a different message", 409);
    }
  }

  private isMembershipVisible(membership: {
    conversation: { activatedAt: Date | null; kind: MessengerConversationKind };
    openedAt: Date | null;
  }) {
    return membership.conversation.kind === "general"
      || membership.conversation.activatedAt !== null
      || membership.openedAt !== null;
  }

  private isConversationWritable(membership: ConversationMembershipRow) {
    return membership.conversation.kind !== "direct" || membership.conversation.members.filter((member) => member.state === "active").length === 2;
  }

  private maximumSequence(...values: bigint[]) {
    return values.reduce((maximum, value) => value > maximum ? value : maximum);
  }

  private encodeConversationCursor(membershipId: string) {
    return Buffer.from(JSON.stringify({ membershipId }), "utf8").toString("base64url");
  }

  private decodeConversationCursor(cursor: string) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { membershipId?: unknown };
      if (typeof parsed.membershipId !== "string" || !parsed.membershipId) throw new Error("Invalid cursor");
      return parsed.membershipId;
    } catch {
      throw new MessengerDomainError("invalid_cursor", "Conversation cursor is invalid", 400);
    }
  }

  private async runSerializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>, retryUniqueConflict = false): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.dependencies.client.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000
        });
      } catch (error) {
        const retryableTransactionConflict = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === "P2034" || retryUniqueConflict && error.code === "P2002");
        if (!retryableTransactionConflict || attempt === 3) {
          throw error;
        }
      }
    }
    throw new MessengerDomainError("messenger_unavailable", "Messenger transaction failed", 503, true);
  }
}

export const messengerRepository = new MessengerRepository();
