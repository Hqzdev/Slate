import { randomUUID } from "node:crypto";
import { Prisma, type MessengerMessageAttachment } from "@prisma/client";
import { prisma } from "../prisma";
import { messengerAccessPolicy, type MessengerAccessPolicy } from "./accessPolicy";
import { messengerPayloadCodec, type MessengerPayloadCodec } from "./cryptography";
import { MessengerDomainError } from "./errors";
import type { MessengerAttachmentCompletionInput, MessengerAttachmentReservationInput } from "./input";
import { messengerKeyEnvelopeService, type MessengerKeyEnvelopeService } from "./keyEnvelopeService";
import { messengerObjectStorage, normalizeEtag, type MessengerObjectStorage } from "./objectStorage";
import { messengerOutboxRepository, type MessengerOutboxRepository } from "./outboxRepository";

const activeStorageStatuses = ["reserved", "uploaded", "scanning", "ready", "attached"] as const;
const maximumActiveUploadsPerUser = 50;
const reservationLifetimeMs = 15 * 60 * 1_000;

export type AttachmentServiceDependencies = {
  accessPolicy: Pick<MessengerAccessPolicy, "requireConversationReader" | "requireConversationWriter" | "requireConversationWriterWithClient">;
  client: typeof prisma;
  keyService: Pick<MessengerKeyEnvelopeService, "ensureActiveKey" | "resolveKeyVersion">;
  objectStorage: Pick<MessengerObjectStorage, "createUpload" | "deleteObject" | "headObject">;
  outboxRepository: Pick<MessengerOutboxRepository, "append">;
  payloadCodec: Pick<MessengerPayloadCodec, "decryptAttachmentFileName" | "encryptAttachmentFileName">;
};

const defaultDependencies: AttachmentServiceDependencies = {
  accessPolicy: messengerAccessPolicy,
  client: prisma,
  keyService: messengerKeyEnvelopeService,
  objectStorage: messengerObjectStorage,
  outboxRepository: messengerOutboxRepository,
  payloadCodec: messengerPayloadCodec
};

export class MessengerAttachmentService {
  constructor(
    private readonly dependencies: AttachmentServiceDependencies = defaultDependencies,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env
  ) {}

  async reserve(
    userId: string,
    workspaceId: string,
    conversationId: string,
    input: MessengerAttachmentReservationInput
  ) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    await this.requireQuota(userId, workspaceId, input.byteSize);
    const activeKey = await this.dependencies.keyService.ensureActiveKey(workspaceId);
    const attachmentId = this.idFactory();
    const storageKey = `messenger/${workspaceId}/${attachmentId}/${this.idFactory()}`;
    const expiresAt = new Date(this.now().getTime() + reservationLifetimeMs);
    try {
      const encryptedName = this.dependencies.payloadCodec.encryptAttachmentFileName({
        attachmentId,
        conversationId,
        dataKey: activeKey.dataKey,
        fileName: input.fileName,
        keyVersion: activeKey.version,
        workspaceId
      });
      const attachment = await this.dependencies.client.$transaction(async (transaction) => {
        await this.dependencies.accessPolicy.requireConversationWriterWithClient(transaction, userId, workspaceId, conversationId);
        await this.requireQuota(userId, workspaceId, input.byteSize, transaction);
        return transaction.messengerMessageAttachment.create({
          data: {
            conversationId,
            createdByUserId: userId,
            declaredByteSize: BigInt(input.byteSize),
            declaredContentType: input.declaredContentType,
            expiresAt,
            fileNameCiphertext: new Uint8Array(encryptedName.ciphertext),
            fileNameKeyVersion: encryptedName.keyVersion,
            fileNameNonce: new Uint8Array(encryptedName.nonce),
            id: attachmentId,
            kind: input.kind,
            storageKey,
            workspaceId
          }
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      try {
        const upload = await this.dependencies.objectStorage.createUpload({
          attachmentId,
          byteSize: input.byteSize,
          contentType: input.declaredContentType,
          storageKey
        });
        return { attachment: await this.toDto(attachment), upload };
      } catch (error) {
        await this.dependencies.client.messengerMessageAttachment.update({
          data: { status: "deleting" },
          where: { id: attachmentId }
        }).catch(() => undefined);
        throw error;
      }
    } finally {
      activeKey.dataKey.fill(0);
    }
  }

  async complete(
    userId: string,
    workspaceId: string,
    conversationId: string,
    attachmentId: string,
    input: MessengerAttachmentCompletionInput
  ) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    const attachment = await this.requireOwnedAttachment(userId, workspaceId, conversationId, attachmentId);
    if (new Set(["uploaded", "scanning", "ready"]).has(attachment.status)) return this.toDto(attachment);
    if (attachment.status !== "reserved") throw this.stateError(attachment.status);
    if (attachment.expiresAt <= this.now()) {
      await this.dependencies.client.messengerMessageAttachment.update({ data: { status: "expired" }, where: { id: attachment.id } });
      throw new MessengerDomainError("upload_expired", "Attachment upload expired", 410);
    }
    const stored = await this.dependencies.objectStorage.headObject(attachment.storageKey);
    if (stored.attachmentId !== attachment.id
      || stored.byteSize !== Number(attachment.declaredByteSize)
      || stored.contentType.toLowerCase() !== attachment.declaredContentType
      || normalizeEtag(input.etag) !== stored.etag
      || input.checksum && stored.checksum && input.checksum !== stored.checksum) {
      await this.rejectAttachment(attachment.id, "object_metadata_mismatch");
      throw new MessengerDomainError("invalid_attachment", "Uploaded object does not match its reservation", 400);
    }
    const now = this.now();
    const updated = await this.dependencies.client.$transaction(async (transaction) => {
      await this.dependencies.accessPolicy.requireConversationWriterWithClient(transaction, userId, workspaceId, conversationId);
      const changed = await transaction.messengerMessageAttachment.updateMany({
        data: {
          checksumSha256: stored.checksum,
          objectEtag: stored.etag,
          objectVersion: stored.version,
          status: "uploaded",
          uploadedAt: now
        },
        where: { id: attachment.id, status: "reserved" }
      });
      const canonical = await transaction.messengerMessageAttachment.findUnique({ where: { id: attachment.id } });
      if (!canonical) throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
      if (changed.count === 0 && !new Set(["uploaded", "scanning", "ready"]).has(canonical.status)) throw this.stateError(canonical.status);
      await transaction.messengerMediaJob.upsert({
        create: { attachmentId: attachment.id, workspaceId },
        update: {},
        where: { attachmentId: attachment.id }
      });
      await this.dependencies.outboxRepository.append(transaction, {
        conversationId,
        payload: { attachmentId: attachment.id, status: canonical.status === "reserved" ? "uploaded" : canonical.status },
        targetUserId: userId,
        type: "attachment.changed",
        workspaceId
      });
      return canonical.status === "reserved" ? { ...canonical, status: "uploaded" as const, uploadedAt: now } : canonical;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.toDto(updated);
  }

  async getStatus(userId: string, workspaceId: string, conversationId: string, attachmentId: string) {
    await this.dependencies.accessPolicy.requireConversationReader(userId, workspaceId, conversationId);
    const attachment = await this.dependencies.client.messengerMessageAttachment.findFirst({
      where: {
        conversationId,
        id: attachmentId,
        workspaceId,
        OR: [{ createdByUserId: userId }, { messageId: { not: null }, status: "attached" }]
      }
    });
    if (!attachment) throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
    return this.toDto(attachment);
  }

  async abandon(userId: string, workspaceId: string, conversationId: string, attachmentId: string) {
    await this.dependencies.accessPolicy.requireConversationWriter(userId, workspaceId, conversationId);
    const attachment = await this.requireOwnedAttachment(userId, workspaceId, conversationId, attachmentId);
    if (attachment.messageId || attachment.status === "attached") throw new MessengerDomainError("attachment_state_conflict", "Attached files cannot be abandoned", 409);
    if (attachment.status !== "deleting") {
      await this.dependencies.client.messengerMessageAttachment.update({ data: { status: "deleting" }, where: { id: attachment.id } });
    }
    try {
      await this.dependencies.objectStorage.deleteObject(attachment.storageKey);
      const deleted = await this.dependencies.client.messengerMessageAttachment.update({
        data: { deletedAt: this.now() },
        where: { id: attachment.id }
      });
      return this.toDto(deleted);
    } catch {
      return this.toDto({ ...attachment, status: "deleting" as const });
    }
  }

  private async requireQuota(
    userId: string,
    workspaceId: string,
    byteSize: number,
    client: Pick<typeof prisma, "messengerMessageAttachment"> = this.dependencies.client
  ) {
    const [activeUploads, userUsage, workspaceUsage] = await Promise.all([
      client.messengerMessageAttachment.count({
        where: { createdByUserId: userId, status: { in: [...activeStorageStatuses] }, workspaceId }
      }),
      client.messengerMessageAttachment.aggregate({
        _sum: { declaredByteSize: true },
        where: { createdByUserId: userId, status: { in: [...activeStorageStatuses] }, workspaceId }
      }),
      client.messengerMessageAttachment.aggregate({
        _sum: { declaredByteSize: true },
        where: { status: { in: [...activeStorageStatuses] }, workspaceId }
      })
    ]);
    const userQuota = readPositiveInteger(this.environment.MESSENGER_STORAGE_USER_QUOTA_BYTES, 1024 * 1024 * 1024);
    const workspaceQuota = readPositiveInteger(this.environment.MESSENGER_STORAGE_WORKSPACE_QUOTA_BYTES, 5 * 1024 * 1024 * 1024);
    if (activeUploads >= maximumActiveUploadsPerUser
      || (userUsage._sum.declaredByteSize ?? BigInt(0)) + BigInt(byteSize) > BigInt(userQuota)
      || (workspaceUsage._sum.declaredByteSize ?? BigInt(0)) + BigInt(byteSize) > BigInt(workspaceQuota)) {
      throw new MessengerDomainError("attachment_quota_exceeded", "Attachment storage quota exceeded", 413);
    }
  }

  private async requireOwnedAttachment(userId: string, workspaceId: string, conversationId: string, attachmentId: string) {
    const attachment = await this.dependencies.client.messengerMessageAttachment.findFirst({
      where: { conversationId, createdByUserId: userId, id: attachmentId, workspaceId }
    });
    if (!attachment) throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
    return attachment;
  }

  private async rejectAttachment(attachmentId: string, rejectionCode: string) {
    await this.dependencies.client.messengerMessageAttachment.updateMany({
      data: { rejectionCode, status: "rejected" },
      where: { id: attachmentId, status: "reserved" }
    });
  }

  private async toDto(attachment: MessengerMessageAttachment) {
    const key = await this.dependencies.keyService.resolveKeyVersion(attachment.workspaceId, attachment.fileNameKeyVersion);
    try {
      return {
        byteSize: (attachment.verifiedByteSize ?? attachment.declaredByteSize).toString(),
        contentType: attachment.detectedContentType ?? attachment.declaredContentType,
        createdAt: attachment.createdAt.toISOString(),
        durationMs: attachment.durationMs,
        expiresAt: attachment.expiresAt.toISOString(),
        fileName: this.dependencies.payloadCodec.decryptAttachmentFileName({
          attachmentId: attachment.id,
          ciphertext: Buffer.from(attachment.fileNameCiphertext),
          conversationId: attachment.conversationId,
          dataKey: key.dataKey,
          keyVersion: attachment.fileNameKeyVersion,
          nonce: Buffer.from(attachment.fileNameNonce),
          workspaceId: attachment.workspaceId
        }),
        height: attachment.height,
        id: attachment.id,
        kind: attachment.kind,
        rejectionCode: attachment.rejectionCode,
        status: attachment.status,
        width: attachment.width
      };
    } finally {
      key.dataKey.fill(0);
    }
  }

  private stateError(status: string) {
    return new MessengerDomainError("attachment_state_conflict", `Attachment cannot be completed from ${status}`, 409);
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new MessengerDomainError("storage_configuration_invalid", "Attachment quota is invalid", 503);
  return parsed;
}

export const messengerAttachmentService = new MessengerAttachmentService();
