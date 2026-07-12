import { Prisma, type WorkspaceRole } from "@prisma/client";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { type PreparedMessengerKeyEnvelope } from "./cryptography";
import { MessengerDomainError } from "./errors";
import { messengerKeyEnvelopeService } from "./keyEnvelopeService";
import { messengerOutboxRepository } from "./outboxRepository";

export type MessengerMembershipEpoch = {
  id: string;
  messengerAccessVersion: number;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

type GeneralActivationReason = "workspace_created" | "invite_accepted" | "reconciled";
type WorkspaceRevocationReason = "blocked" | "removed";

export type MessengerReconciliationResult = {
  activeMemberCount: number;
  conversationId: string;
  invariantViolations: 0;
  keyCreated: boolean;
  membershipsActivated: number;
  membershipsRevoked: number;
  receiptsCreated: number;
};

export class MessengerProvisioningService {
  async provisionGeneral(
    transaction: Prisma.TransactionClient,
    input: {
      member: MessengerMembershipEpoch;
      now: Date;
      preparedKeyEnvelope: PreparedMessengerKeyEnvelope;
    }
  ) {
    const conversation = await this.ensureGeneralConversation(transaction, input.member.workspaceId, input.now);
    await this.ensureKeyEnvelope(transaction, input.member.workspaceId, input.preparedKeyEnvelope, input.now);
    await this.activateGeneralMember(transaction, {
      emitEvent: true,
      member: input.member,
      now: input.now,
      reason: "workspace_created"
    });
    return { conversationId: conversation.id };
  }

  async activateGeneralMember(
    transaction: Prisma.TransactionClient,
    input: {
      emitEvent?: boolean;
      member: MessengerMembershipEpoch;
      now: Date;
      reason: GeneralActivationReason;
    }
  ) {
    const conversation = await this.ensureGeneralConversation(transaction, input.member.workspaceId, input.now);
    const existing = await transaction.messengerConversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: input.member.userId
        }
      }
    });
    const member = await transaction.messengerConversationMember.upsert({
      create: {
        conversationId: conversation.id,
        historyFromSequence: BigInt(1),
        joinedAt: input.now,
        state: "active",
        userId: input.member.userId
      },
      update: {
        historyFromSequence: BigInt(1),
        joinedAt: existing?.state === "revoked" ? input.now : existing?.joinedAt,
        revokedAt: null,
        state: "active"
      },
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: input.member.userId
        }
      }
    });
    const receipt = await transaction.messengerMessageReceipt.upsert({
      create: {
        conversationId: conversation.id,
        userId: input.member.userId
      },
      update: {},
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: input.member.userId
        }
      }
    });
    if (input.emitEvent !== false && (!existing || existing.state === "revoked")) {
      await messengerOutboxRepository.append(transaction, {
        conversationId: conversation.id,
        payload: {
          conversationId: conversation.id,
          membershipId: input.member.id,
          reason: input.reason,
          userId: input.member.userId
        },
        targetUserId: input.member.userId,
        type: "conversation.added",
        workspaceId: input.member.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: input.member.userId,
        metadata: {
          conversationId: conversation.id,
          reason: input.reason
        },
        targetUserId: input.member.userId,
        type: existing ? "messenger.membership.reactivated" : "messenger.membership.activated",
        workspaceId: input.member.workspaceId
      });
    }
    return { conversation, member, receipt };
  }

  async revokeWorkspaceAccess(
    transaction: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      member: MessengerMembershipEpoch;
      now: Date;
      reason: WorkspaceRevocationReason;
    }
  ) {
    const revoked = await transaction.messengerConversationMember.updateMany({
      data: {
        revokedAt: input.now,
        state: "revoked"
      },
      where: {
        conversation: { workspaceId: input.member.workspaceId },
        state: "active",
        userId: input.member.userId
      }
    });
    await messengerOutboxRepository.append(transaction, {
      payload: {
        accessVersion: input.member.messengerAccessVersion,
        membershipId: input.member.id,
        reason: input.reason,
        scope: "workspace",
        userId: input.member.userId
      },
      targetUserId: input.member.userId,
      type: "access.revoked",
      workspaceId: input.member.workspaceId
    });
    await auditLogService.recordWithClient(transaction, {
      actorUserId: input.actorUserId,
      metadata: {
        accessVersion: input.member.messengerAccessVersion,
        membershipId: input.member.id,
        reason: input.reason,
        revokedConversationCount: revoked.count
      },
      targetUserId: input.member.userId,
      type: "messenger.membership.revoked",
      workspaceId: input.member.workspaceId
    });
    return revoked.count;
  }

  async appendCapabilitiesChanged(
    transaction: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      member: MessengerMembershipEpoch;
      previousRole: WorkspaceRole;
    }
  ) {
    await messengerOutboxRepository.append(transaction, {
      payload: {
        accessVersion: input.member.messengerAccessVersion,
        membershipId: input.member.id,
        role: input.member.role,
        userId: input.member.userId
      },
      targetUserId: input.member.userId,
      type: "capabilities.changed",
      workspaceId: input.member.workspaceId
    });
    await auditLogService.recordWithClient(transaction, {
      actorUserId: input.actorUserId,
      metadata: {
        accessVersion: input.member.messengerAccessVersion,
        membershipId: input.member.id,
        nextRole: input.member.role,
        previousRole: input.previousRole
      },
      targetUserId: input.member.userId,
      type: "messenger.capabilities.changed",
      workspaceId: input.member.workspaceId
    });
  }

  async reconcileGeneral(
    transaction: Prisma.TransactionClient,
    input: {
      now: Date;
      preparedKeyEnvelope?: PreparedMessengerKeyEnvelope;
      workspaceId: string;
    }
  ): Promise<MessengerReconciliationResult> {
    const conversation = await this.ensureGeneralConversation(transaction, input.workspaceId, input.now);
    const keyCreated = input.preparedKeyEnvelope
      ? await this.ensureKeyEnvelope(transaction, input.workspaceId, input.preparedKeyEnvelope, input.now)
      : false;
    const [workspaceMembers, blocks, existingMembers, existingReceipts] = await Promise.all([
      transaction.workspaceMember.findMany({ where: { workspaceId: input.workspaceId } }),
      transaction.workspaceBlock.findMany({ select: { userId: true }, where: { workspaceId: input.workspaceId } }),
      transaction.messengerConversationMember.findMany({ where: { conversationId: conversation.id } }),
      transaction.messengerMessageReceipt.findMany({
        select: { userId: true },
        where: { conversationId: conversation.id }
      })
    ]);
    const blockedUserIds = new Set(blocks.map((block) => block.userId));
    const activeWorkspaceMembers = workspaceMembers.filter((member) => !blockedUserIds.has(member.userId));
    const activeUserIds = new Set(activeWorkspaceMembers.map((member) => member.userId));
    const existingByUserId = new Map(existingMembers.map((member) => [member.userId, member]));
    const receiptUserIds = new Set(existingReceipts.map((receipt) => receipt.userId));
    const missingMembers = activeWorkspaceMembers.filter((member) => !existingByUserId.has(member.userId));
    const reactivatedUserIds = activeWorkspaceMembers
      .filter((member) => existingByUserId.get(member.userId)?.state === "revoked")
      .map((member) => member.userId);
    const missingReceiptUserIds = activeWorkspaceMembers
      .filter((member) => !receiptUserIds.has(member.userId))
      .map((member) => member.userId);
    if (missingMembers.length > 0) {
      await transaction.messengerConversationMember.createMany({
        data: missingMembers.map((member) => ({
          conversationId: conversation.id,
          historyFromSequence: BigInt(1),
          joinedAt: input.now,
          state: "active" as const,
          userId: member.userId
        })),
        skipDuplicates: true
      });
    }
    if (reactivatedUserIds.length > 0) {
      await transaction.messengerConversationMember.updateMany({
        data: {
          historyFromSequence: BigInt(1),
          joinedAt: input.now,
          revokedAt: null,
          state: "active"
        },
        where: {
          conversationId: conversation.id,
          state: "revoked",
          userId: { in: reactivatedUserIds }
        }
      });
    }
    if (activeWorkspaceMembers.length > 0) {
      await transaction.messengerConversationMember.updateMany({
        data: { historyFromSequence: BigInt(1) },
        where: {
          conversationId: conversation.id,
          state: "active",
          userId: { in: activeWorkspaceMembers.map((member) => member.userId) }
        }
      });
    }
    if (missingReceiptUserIds.length > 0) {
      await transaction.messengerMessageReceipt.createMany({
        data: missingReceiptUserIds.map((userId) => ({ conversationId: conversation.id, userId })),
        skipDuplicates: true
      });
    }

    const strayIds = existingMembers
      .filter((member) => member.state === "active" && !activeUserIds.has(member.userId))
      .map((member) => member.id);
    const revoked = strayIds.length > 0
      ? await transaction.messengerConversationMember.updateMany({
          data: { revokedAt: input.now, state: "revoked" },
          where: { id: { in: strayIds }, state: "active" }
        })
      : { count: 0 };

    const [finalMembers, finalReceipts, activeKeys] = await Promise.all([
      transaction.messengerConversationMember.findMany({
        select: { state: true, userId: true },
        where: { conversationId: conversation.id }
      }),
      transaction.messengerMessageReceipt.findMany({
        select: {
          deliveredThroughSequence: true,
          readThroughSequence: true,
          userId: true
        },
        where: { conversationId: conversation.id }
      }),
      transaction.messengerKeyEnvelope.findMany({
        select: { id: true },
        where: { state: "active", workspaceId: input.workspaceId }
      })
    ]);
    const finalActiveUserIds = new Set(finalMembers.filter((member) => member.state === "active").map((member) => member.userId));
    const finalReceiptUserIds = new Set(finalReceipts.map((receipt) => receipt.userId));
    const membershipDrift = [...activeUserIds].some((userId) => !finalActiveUserIds.has(userId))
      || [...finalActiveUserIds].some((userId) => !activeUserIds.has(userId));
    const receiptDrift = [...activeUserIds].some((userId) => !finalReceiptUserIds.has(userId));
    const receiptHighWaterDrift = finalReceipts.some((receipt) => (
      receipt.readThroughSequence > receipt.deliveredThroughSequence
      || receipt.deliveredThroughSequence > conversation.lastMessageSequence
    ));
    if (membershipDrift || receiptDrift || receiptHighWaterDrift || activeKeys.length !== 1) {
      throw new MessengerDomainError("messenger_reconciliation_failed", "Messenger reconciliation invariant failed", 503);
    }

    return {
      activeMemberCount: activeWorkspaceMembers.length,
      conversationId: conversation.id,
      invariantViolations: 0,
      keyCreated,
      membershipsActivated: missingMembers.length + reactivatedUserIds.length,
      membershipsRevoked: revoked.count,
      receiptsCreated: missingReceiptUserIds.length
    };
  }

  private async ensureGeneralConversation(transaction: Prisma.TransactionClient, workspaceId: string, now: Date) {
    const existing = await transaction.messengerConversation.findUnique({ where: { generalKey: workspaceId } });
    if (existing) {
      if (existing.kind !== "general" || existing.workspaceId !== workspaceId) {
        throw new MessengerDomainError("messenger_invariant_failed", "General conversation invariant failed", 503);
      }
      return existing;
    }
    const conversation = await transaction.messengerConversation.create({
      data: {
        activatedAt: now,
        generalKey: workspaceId,
        kind: "general",
        workspaceId
      }
    });
    await auditLogService.recordWithClient(transaction, {
      metadata: { conversationId: conversation.id },
      type: "messenger.general.provisioned",
      workspaceId
    });
    return conversation;
  }

  private async ensureKeyEnvelope(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    prepared: PreparedMessengerKeyEnvelope,
    now: Date
  ) {
    const active = await transaction.messengerKeyEnvelope.findFirst({
      select: { id: true },
      where: { state: "active", workspaceId }
    });
    if (active) return false;
    await transaction.messengerKeyEnvelope.create({
      data: messengerKeyEnvelopeService.toCreateData(workspaceId, prepared, now)
    });
    return true;
  }
}

export class MessengerProvisioningCoordinator {
  constructor(private readonly service: MessengerProvisioningService = new MessengerProvisioningService()) {}

  async reconcileWorkspace(workspaceId: string) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const latestEnvelope = await prisma.messengerKeyEnvelope.findFirst({
        orderBy: { version: "desc" },
        select: { state: true, version: true },
        where: { workspaceId }
      });
      const preparedKeyEnvelope = latestEnvelope?.state === "active"
        ? undefined
        : messengerKeyEnvelopeService.prepareWorkspaceKey(workspaceId, (latestEnvelope?.version ?? 0) + 1);
      try {
        return await prisma.$transaction(
          (transaction) => this.service.reconcileGeneral(transaction, {
            now: new Date(),
            preparedKeyEnvelope,
            workspaceId
          }),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5_000,
            timeout: 15_000
          }
        );
      } catch (error) {
        const retryableConflict = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === "P2002" || error.code === "P2034");
        if (!retryableConflict || attempt === 3) throw error;
      }
    }
    throw new MessengerDomainError("messenger_reconciliation_failed", "Messenger reconciliation failed", 503, true);
  }
}

export const messengerProvisioningService = new MessengerProvisioningService();
export const messengerProvisioningCoordinator = new MessengerProvisioningCoordinator(messengerProvisioningService);
