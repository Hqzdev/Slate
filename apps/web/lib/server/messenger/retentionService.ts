import { Prisma } from "@prisma/client";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { messengerAttachmentCleanupService, type MessengerAttachmentCleanupService } from "./attachmentCleanupService";

type RetentionClient = Pick<typeof prisma, "$transaction" | "messengerDeletionTombstone" | "messengerMessage">;

type RetentionMessage = {
  conversationId: string;
  createdAt: Date;
  id: string;
  sequence: bigint;
  conversation: {
    workspaceId: string;
    workspace: {
      settings: {
        retentionDays: number;
      } | null;
    };
  };
};

export type MessengerRetentionResult = {
  attachmentsDeleted: number;
  messagesCompleted: number;
  messagesMarked: number;
  scanned: number;
};

export class MessengerRetentionService {
  constructor(
    private readonly client: RetentionClient = prisma,
    private readonly attachmentCleanup: Pick<MessengerAttachmentCleanupService, "runBatch"> = messengerAttachmentCleanupService,
    private readonly now: () => Date = () => new Date(),
    private readonly backupRetentionDays: number = readBackupRetentionDays(process.env),
    private readonly audit: Pick<typeof auditLogService, "record"> = auditLogService
  ) {}

  async runBatch(limit = 100): Promise<MessengerRetentionResult> {
    const now = this.now();
    const { expired, scanned } = await this.findExpiredMessages(limit, now);
    for (const message of expired) await this.markForDeletion(message, now);
    const attachmentResult = await this.attachmentCleanup.runBatch(Math.max(limit, expired.length * 4));
    const messagesCompleted = await this.completeMarkedMessages(limit, now);
    if (expired.length > 0 || attachmentResult.deleted > 0 || messagesCompleted > 0) {
      await this.audit.record({
        metadata: {
          attachmentsDeleted: attachmentResult.deleted,
          messagesCompleted,
          messagesMarked: expired.length
        },
        type: "messenger.retention.completed"
      });
    }
    return {
      attachmentsDeleted: attachmentResult.deleted,
      messagesCompleted,
      messagesMarked: expired.length,
      scanned
    };
  }

  async replayTombstones(limit = 100) {
    const now = this.now();
    const tombstones = await this.client.messengerDeletionTombstone.findMany({
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      take: limit,
      where: {
        backupExpiresAt: { gt: now },
        effectiveAt: { lte: now },
        resourceType: "message"
      }
    });
    let replayed = 0;
    for (const tombstone of tombstones) {
      const restored = await this.client.$transaction(async (transaction) => {
        const message = await transaction.messengerMessage.updateMany({
          data: { deletingAt: tombstone.effectiveAt },
          where: { deletedAt: null, deletingAt: null, id: tombstone.resourceId }
        });
        if (message.count !== 1) return false;
        await transaction.messengerMessageAttachment.updateMany({
          data: { status: "deleting" },
          where: { deletedAt: null, messageId: tombstone.resourceId }
        });
        await transaction.messengerDeletionTombstone.update({
          data: { completedAt: null, status: "pending" },
          where: { id: tombstone.id }
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (restored) replayed += 1;
    }
    const expired = await this.client.messengerDeletionTombstone.deleteMany({
      where: { backupExpiresAt: { lte: now }, status: "completed" }
    });
    return { expired: expired.count, replayed, scanned: tombstones.length };
  }

  private async findExpiredMessages(limit: number, now: Date) {
    const expired: RetentionMessage[] = [];
    const pageSize = Math.max(100, limit * 10);
    let cursor: string | null = null;
    let scanned = 0;
    while (expired.length < limit) {
      const page = await this.client.messengerMessage.findMany({
        cursor: cursor ? { id: cursor } : undefined,
        include: {
          conversation: {
            include: {
              workspace: {
                include: { settings: { select: { retentionDays: true } } }
              }
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: cursor ? 1 : 0,
        take: pageSize,
        where: {
          createdAt: { lte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000) },
          deletedAt: null,
          deletingAt: null
        }
      }) as RetentionMessage[];
      scanned += page.length;
      for (const message of page) {
        if (message.createdAt <= this.expiryAt(message, now)) expired.push(message);
        if (expired.length === limit) break;
      }
      if (page.length < pageSize) break;
      cursor = page.at(-1)?.id ?? null;
      if (!cursor) break;
    }
    return { expired, scanned };
  }

  private async markForDeletion(message: RetentionMessage, now: Date) {
    const nextRetainedSequence = message.sequence + BigInt(1);
    await this.client.$transaction(async (transaction) => {
      const claimed = await transaction.messengerMessage.updateMany({
        data: { deletingAt: now },
        where: { deletedAt: null, deletingAt: null, id: message.id }
      });
      if (claimed.count !== 1) return;
      await transaction.messengerDeletionTombstone.upsert({
        create: {
          backupExpiresAt: new Date(now.getTime() + this.backupRetentionDays * 24 * 60 * 60 * 1_000),
          conversationId: message.conversationId,
          effectiveAt: now,
          reason: "retention_expired",
          resourceId: message.id,
          resourceType: "message",
          workspaceId: message.conversation.workspaceId
        },
        update: {},
        where: {
          resourceType_resourceId: { resourceId: message.id, resourceType: "message" }
        }
      });
      await transaction.messengerMessageAttachment.updateMany({
        data: { status: "deleting" },
        where: {
          deletedAt: null,
          messageId: message.id,
          status: { in: ["attached", "ready", "uploaded", "scanning", "reserved"] }
        }
      });
      await transaction.messengerConversation.updateMany({
        data: { retainedFromSequence: nextRetainedSequence },
        where: {
          id: message.conversationId,
          retainedFromSequence: { lte: message.sequence }
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async completeMarkedMessages(limit: number, now: Date) {
    const messages = await this.client.messengerMessage.findMany({
      select: { id: true },
      take: limit,
      where: {
        deletedAt: null,
        deletingAt: { not: null },
        attachments: { none: { deletedAt: null } }
      }
    });
    let completed = 0;
    for (const message of messages) {
      const didComplete = await this.client.$transaction(async (transaction) => {
        const updated = await transaction.messengerMessage.updateMany({
          data: {
            bodyCiphertext: null,
            bodyKeyVersion: null,
            bodyNonce: null,
            deletedAt: now
          },
          where: { deletedAt: null, deletingAt: { not: null }, id: message.id }
        });
        if (updated.count !== 1) return false;
        await transaction.messengerDeletionTombstone.updateMany({
          data: { completedAt: now, status: "completed" },
          where: { resourceId: message.id, resourceType: "message", status: "pending" }
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (didComplete) completed += 1;
    }
    return completed;
  }

  private expiryAt(message: RetentionMessage, now: Date) {
    const retentionDays = message.conversation.workspace.settings?.retentionDays ?? 90;
    const effectiveRetentionDays = Number.isInteger(retentionDays) && retentionDays >= 7 ? retentionDays : 90;
    return new Date(now.getTime() - effectiveRetentionDays * 24 * 60 * 60 * 1_000);
  }
}

function readBackupRetentionDays(environment: Readonly<Record<string, string | undefined>>) {
  const value = Number(environment.MESSENGER_BACKUP_RETENTION_DAYS ?? "90");
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error("MESSENGER_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650");
  return value;
}

export const messengerRetentionService = new MessengerRetentionService();
