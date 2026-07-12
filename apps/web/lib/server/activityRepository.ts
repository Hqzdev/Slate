import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { workspaceAccessPolicy } from "./workspaceAccessPolicy";

export type ActivityEventPayload = {
  actorName: string | null;
  createdAt: string;
  documentTitle: string | null;
  id: string;
  metadata: Prisma.JsonValue;
  type: string;
};

type ActivityEventInput = {
  actorUserId?: string | null;
  documentId?: string | null;
  metadata?: Prisma.InputJsonValue;
  type: string;
  workspaceId: string;
};

export class ActivityRepository {
  async listWorkspaceEvents(userId: string, workspaceId: string): Promise<ActivityEventPayload[]> {
    await workspaceAccessPolicy.requireWorkspaceLogReader(userId, workspaceId);
    const events = await prisma.activityEvent.findMany({
      include: {
        actor: { select: { name: true } },
        document: { select: { title: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      where: { workspaceId }
    });

    return events.map((event) => ({
      actorName: event.actor?.name ?? null,
      createdAt: event.createdAt.toISOString(),
      documentTitle: event.document?.title ?? null,
      id: event.id,
      metadata: event.metadata ?? null,
      type: event.type
    }));
  }

  async record(input: ActivityEventInput) {
    return this.recordWithClient(prisma, input);
  }

  async recordWithClient(client: Prisma.TransactionClient, input: ActivityEventInput) {
    return client.activityEvent.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        documentId: input.documentId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        type: input.type,
        workspaceId: input.workspaceId
      }
    });
  }
}

export const activityRepository = new ActivityRepository();
