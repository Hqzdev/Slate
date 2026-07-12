CREATE TYPE "MessengerDeletionTombstoneStatus" AS ENUM ('pending', 'completed');
CREATE TYPE "MessengerDeletionResourceType" AS ENUM ('message');

ALTER TABLE "MessengerMessage"
ADD COLUMN "deletingAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "MessengerMessage_conversationId_deletingAt_deletedAt_sequence_idx"
ON "MessengerMessage"("conversationId", "deletingAt", "deletedAt", "sequence");

CREATE TABLE "MessengerDeletionTombstone" (
    "id" TEXT NOT NULL,
    "resourceType" "MessengerDeletionResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MessengerDeletionTombstoneStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "backupExpiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    CONSTRAINT "MessengerDeletionTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessengerDeletionTombstone_resourceType_resourceId_key"
ON "MessengerDeletionTombstone"("resourceType", "resourceId");
CREATE INDEX "MessengerDeletionTombstone_status_effectiveAt_idx"
ON "MessengerDeletionTombstone"("status", "effectiveAt");
CREATE INDEX "MessengerDeletionTombstone_workspaceId_status_idx"
ON "MessengerDeletionTombstone"("workspaceId", "status");
CREATE INDEX "MessengerDeletionTombstone_backupExpiresAt_idx"
ON "MessengerDeletionTombstone"("backupExpiresAt");

ALTER TABLE "MessengerDeletionTombstone"
ADD CONSTRAINT "MessengerDeletionTombstone_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
