ALTER TABLE "AiConversation" ADD COLUMN "publicId" TEXT;
ALTER TABLE "AiConversation" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Workspace chat';
ALTER TABLE "AiConversation" ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "AiConversation"
SET "publicId" = 'sltx-' || substr(md5("id"), 1, 4) || '-' || substr(md5("id"), 5, 4);

ALTER TABLE "AiConversation" ALTER COLUMN "publicId" SET NOT NULL;
DROP INDEX "AiConversation_workspaceId_ownerUserId_key";
CREATE UNIQUE INDEX "AiConversation_publicId_key" ON "AiConversation"("publicId");
CREATE INDEX "AiConversation_workspaceId_ownerUserId_archivedAt_updatedAt_idx" ON "AiConversation"("workspaceId", "ownerUserId", "archivedAt", "updatedAt");
