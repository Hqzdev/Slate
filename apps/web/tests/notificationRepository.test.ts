import assert from "node:assert/strict";
import test from "node:test";
import { NotificationRepository } from "../lib/server/notificationRepository";

function createRepository() {
  const calls: { findMany: unknown[]; updateMany: unknown[] } = { findMany: [], updateMany: [] };
  const client = {
    userNotification: {
      async findMany(input: unknown) {
        calls.findMany.push(input);
        return [{
          createdAt: new Date("2026-07-11T10:00:00.000Z"),
          id: "notification-1",
          invite: {
            acceptedAt: null,
            createdBy: { name: "Owner" },
            declinedAt: null,
            expiresAt: new Date("2026-07-18T10:00:00.000Z"),
            id: "invite-1",
            revokedAt: null,
            role: "editor" as const
          },
          readAt: null,
          workspace: { id: "workspace-1", name: "Slate", slug: "slate" }
        }];
      },
      async updateMany(input: unknown) {
        calls.updateMany.push(input);
        return { count: 1 };
      }
    }
  };
  return { calls, repository: new NotificationRepository(client) };
}

test("lists only the recipient notifications with invite state", async () => {
  const { calls, repository } = createRepository();
  const notifications = await repository.list("user-1");
  assert.equal(notifications[0]?.invite.id, "invite-1");
  assert.equal(notifications[0]?.invite.role, "editor");
  assert.equal(notifications[0]?.inviterName, "Owner");
  assert.deepEqual(calls.findMany[0], {
    include: {
      invite: { include: { createdBy: { select: { name: true } } } },
      workspace: { select: { id: true, name: true, slug: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    where: { recipientId: "user-1" }
  });
});

test("marks unread notifications for one recipient only", async () => {
  const { calls, repository } = createRepository();
  await repository.markAllRead("user-1");
  const update = calls.updateMany[0] as { where: unknown };
  assert.deepEqual(update.where, { readAt: null, recipientId: "user-1" });
});
