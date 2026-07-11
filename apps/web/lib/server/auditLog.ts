import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditEventInput = {
  actorUserId?: string | null;
  documentId?: string | null;
  metadata?: Prisma.InputJsonValue;
  targetUserId?: string | null;
  type: string;
  workspaceId?: string | null;
};

type AuditLogClient = {
  auditEvent: {
    create(input: {
      data: {
        actorUserId: string | null;
        documentId: string | null;
        metadata: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue;
        targetUserId: string | null;
        type: string;
        workspaceId: string | null;
      };
    }): Promise<unknown>;
  };
};

export class AuditLogService {
  async record(input: AuditEventInput) {
    return this.recordWithClient(prisma, input);
  }

  async recordWithClient(client: AuditLogClient, input: AuditEventInput) {
    return client.auditEvent.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        documentId: input.documentId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        targetUserId: input.targetUserId ?? null,
        type: input.type,
        workspaceId: input.workspaceId ?? null
      }
    });
  }
}

export const auditLogService = new AuditLogService();
