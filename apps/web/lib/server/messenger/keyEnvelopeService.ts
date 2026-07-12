import { Prisma, type PrismaClient } from "@prisma/client";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { messengerPayloadCodec, type MessengerPayloadCodec, type PreparedMessengerKeyEnvelope } from "./cryptography";
import { MessengerDomainError } from "./errors";

type MessengerKeyEnvelopeClient = Pick<PrismaClient, "$transaction" | "messengerKeyEnvelope">;

export type ResolvedMessengerDataKey = {
  dataKey: Buffer;
  version: number;
};

export class MessengerKeyEnvelopeService {
  constructor(
    private readonly client: MessengerKeyEnvelopeClient = prisma,
    private readonly codec: MessengerPayloadCodec = messengerPayloadCodec
  ) {}

  prepareWorkspaceKey(workspaceId: string, version = 1) {
    return this.codec.prepareWorkspaceKey(workspaceId, version);
  }

  async ensureActiveKey(workspaceId: string): Promise<ResolvedMessengerDataKey> {
    const active = await this.client.messengerKeyEnvelope.findFirst({
      orderBy: { version: "desc" },
      where: { state: "active", workspaceId }
    });
    if (active) return this.resolveStoredEnvelope(active);

    const latest = await this.client.messengerKeyEnvelope.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
      where: { workspaceId }
    });
    const prepared = this.prepareWorkspaceKey(workspaceId, (latest?.version ?? 0) + 1);
    try {
      const created = await this.client.messengerKeyEnvelope.create({
        data: this.toCreateData(workspaceId, prepared)
      });
      return this.resolveStoredEnvelope(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const concurrent = await this.client.messengerKeyEnvelope.findFirst({
        orderBy: { version: "desc" },
        where: { state: "active", workspaceId }
      });
      if (!concurrent) {
        throw new MessengerDomainError("messenger_key_unavailable", "Messenger data key is unavailable", 503, true);
      }
      return this.resolveStoredEnvelope(concurrent);
    }
  }

  async resolveKeyVersion(workspaceId: string, version: number): Promise<ResolvedMessengerDataKey> {
    const envelope = await this.client.messengerKeyEnvelope.findUnique({
      where: { workspaceId_version: { version, workspaceId } }
    });
    if (!envelope || envelope.state === "retired") {
      throw new MessengerDomainError("messenger_key_unavailable", "Messenger data key is unavailable", 503);
    }
    return this.resolveStoredEnvelope(envelope);
  }

  async rotateActiveKey(workspaceId: string) {
    return this.client.$transaction(async (transaction) => {
      const [active, latest] = await Promise.all([
        transaction.messengerKeyEnvelope.findFirst({
          orderBy: { version: "desc" },
          where: { state: "active", workspaceId }
        }),
        transaction.messengerKeyEnvelope.findFirst({
          orderBy: { version: "desc" },
          select: { version: true },
          where: { workspaceId }
        })
      ]);
      if (!active || !latest) {
        throw new MessengerDomainError("messenger_key_unavailable", "Messenger data key is unavailable", 503);
      }
      const nextVersion = latest.version + 1;
      const prepared = this.prepareWorkspaceKey(workspaceId, nextVersion);
      await transaction.messengerKeyEnvelope.updateMany({
        data: { state: "decrypt_only" },
        where: { state: "active", workspaceId }
      });
      const created = await transaction.messengerKeyEnvelope.create({
        data: this.toCreateData(workspaceId, prepared)
      });
      await auditLogService.recordWithClient(transaction, {
        metadata: { keyVersion: created.version },
        type: "messenger.key.rotated",
        workspaceId
      });
      return { kmsKeyId: created.kmsKeyId, version: created.version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  toCreateData(
    workspaceId: string,
    prepared: PreparedMessengerKeyEnvelope,
    activatedAt = new Date()
  ): Prisma.MessengerKeyEnvelopeUncheckedCreateInput {
    return {
      activatedAt,
      algorithm: prepared.algorithm,
      kmsKeyId: prepared.kmsKeyId,
      state: "active" as const,
      version: prepared.version,
      workspaceId,
      wrapNonce: new Uint8Array(prepared.wrapNonce),
      wrappedDataKey: new Uint8Array(prepared.wrappedDataKey)
    };
  }

  private resolveStoredEnvelope(envelope: {
    algorithm: string;
    kmsKeyId: string;
    version: number;
    workspaceId: string;
    wrapNonce: Uint8Array;
    wrappedDataKey: Uint8Array;
  }) {
    return {
      dataKey: this.codec.unwrapWorkspaceKey({
        algorithm: envelope.algorithm,
        kmsKeyId: envelope.kmsKeyId,
        version: envelope.version,
        workspaceId: envelope.workspaceId,
        wrapNonce: Buffer.from(envelope.wrapNonce),
        wrappedDataKey: Buffer.from(envelope.wrappedDataKey)
      }),
      version: envelope.version
    };
  }
}

export const messengerKeyEnvelopeService = new MessengerKeyEnvelopeService();
