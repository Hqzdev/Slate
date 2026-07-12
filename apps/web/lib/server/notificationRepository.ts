import { prisma } from "./prisma";

type NotificationRow = {
  createdAt: Date;
  id: string;
  invite: {
    acceptedAt: Date | null;
    createdBy: { name: string };
    declinedAt: Date | null;
    expiresAt: Date;
    id: string;
    revokedAt: Date | null;
    role: "owner" | "editor" | "viewer";
  };
  readAt: Date | null;
  workspace: { id: string; name: string; slug: string };
};

type NotificationClient = {
  userNotification: {
    findMany(input: unknown): Promise<NotificationRow[]>;
    updateMany(input: unknown): Promise<unknown>;
  };
};

export type UserNotificationPayload = {
  createdAt: string;
  id: string;
  invite: {
    acceptedAt: string | null;
    declinedAt: string | null;
    expiresAt: string;
    id: string;
    revokedAt: string | null;
    role: "editor" | "viewer";
  };
  inviterName: string;
  readAt: string | null;
  type: "workspace_invite";
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

export class NotificationRepository {
  constructor(private readonly client: NotificationClient = prisma as unknown as NotificationClient) {}

  async list(userId: string): Promise<UserNotificationPayload[]> {
    const notifications = await this.client.userNotification.findMany({
      include: {
        invite: { include: { createdBy: { select: { name: true } } } },
        workspace: { select: { id: true, name: true, slug: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      where: { recipientId: userId }
    });

    return notifications.map((notification) => ({
      createdAt: notification.createdAt.toISOString(),
      id: notification.id,
      invite: {
        acceptedAt: notification.invite.acceptedAt?.toISOString() ?? null,
        declinedAt: notification.invite.declinedAt?.toISOString() ?? null,
        expiresAt: notification.invite.expiresAt.toISOString(),
        id: notification.invite.id,
        revokedAt: notification.invite.revokedAt?.toISOString() ?? null,
        role: notification.invite.role === "editor" ? "editor" : "viewer"
      },
      inviterName: notification.invite.createdBy.name,
      readAt: notification.readAt?.toISOString() ?? null,
      type: "workspace_invite",
      workspace: notification.workspace
    }));
  }

  async markAllRead(userId: string) {
    const readAt = new Date();
    await this.client.userNotification.updateMany({
      data: { readAt },
      where: { readAt: null, recipientId: userId }
    });
    return { readAt: readAt.toISOString() };
  }
}

export const notificationRepository = new NotificationRepository();
