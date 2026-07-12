CREATE TYPE "UserNotificationType" AS ENUM ('workspace_invite');

ALTER TABLE "Workspace" ADD COLUMN "createdByUserId" TEXT;

UPDATE "Workspace" AS workspace
SET "createdByUserId" = (
    SELECT member."userId"
    FROM "WorkspaceMember" AS member
    WHERE member."workspaceId" = workspace."id"
    ORDER BY CASE WHEN member."role" = 'owner' THEN 0 ELSE 1 END, member."createdAt" ASC, member."id" ASC
    LIMIT 1
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Workspace" WHERE "createdByUserId" IS NULL) THEN
        RAISE EXCEPTION 'Every workspace must have at least one member before access management can be migrated';
    END IF;
END $$;

WITH ranked_owners AS (
    SELECT member."id", ROW_NUMBER() OVER (
        PARTITION BY member."workspaceId"
        ORDER BY CASE WHEN member."userId" = workspace."createdByUserId" THEN 0 ELSE 1 END, member."createdAt" ASC, member."id" ASC
    ) AS owner_rank
    FROM "WorkspaceMember" AS member
    INNER JOIN "Workspace" AS workspace ON workspace."id" = member."workspaceId"
    WHERE member."role" = 'owner'
)
UPDATE "WorkspaceMember" AS member
SET "role" = 'editor'
FROM ranked_owners
WHERE member."id" = ranked_owners."id" AND ranked_owners.owner_rank > 1;

UPDATE "WorkspaceMember" AS member
SET "role" = 'owner'
FROM "Workspace" AS workspace
WHERE member."workspaceId" = workspace."id" AND member."userId" = workspace."createdByUserId";

ALTER TABLE "Workspace" ALTER COLUMN "createdByUserId" SET NOT NULL;
ALTER TABLE "WorkspaceInvite" ADD COLUMN "declinedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceInvite" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceInvite" ADD COLUMN "recipientUserId" TEXT;

CREATE TABLE "WorkspaceBlock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blockedByUserId" TEXT NOT NULL,
    CONSTRAINT "WorkspaceBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "type" "UserNotificationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "recipientId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMember_one_owner_per_workspace_key" ON "WorkspaceMember"("workspaceId") WHERE "role" = 'owner';
CREATE INDEX "WorkspaceInvite_recipientUserId_createdAt_idx" ON "WorkspaceInvite"("recipientUserId", "createdAt");
CREATE UNIQUE INDEX "WorkspaceBlock_userId_workspaceId_key" ON "WorkspaceBlock"("userId", "workspaceId");
CREATE INDEX "WorkspaceBlock_workspaceId_createdAt_idx" ON "WorkspaceBlock"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "UserNotification_inviteId_key" ON "UserNotification"("inviteId");
CREATE INDEX "UserNotification_recipientId_createdAt_idx" ON "UserNotification"("recipientId", "createdAt");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBlock" ADD CONSTRAINT "WorkspaceBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBlock" ADD CONSTRAINT "WorkspaceBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBlock" ADD CONSTRAINT "WorkspaceBlock_blockedByUserId_fkey" FOREIGN KEY ("blockedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "WorkspaceInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
