ALTER TYPE "MessengerOutboxStatus" ADD VALUE IF NOT EXISTS 'failed';

CREATE TYPE "MessengerAttachmentKind" AS ENUM ('image', 'video', 'file');
CREATE TYPE "MessengerAttachmentStatus" AS ENUM ('reserved', 'uploaded', 'scanning', 'ready', 'attached', 'rejected', 'expired', 'deleting');
CREATE TYPE "MessengerMediaJobStatus" AS ENUM ('pending', 'queued', 'processing', 'completed', 'failed');

CREATE TABLE "MessengerMessageAttachment" (
    "id" TEXT NOT NULL,
    "kind" "MessengerAttachmentKind" NOT NULL,
    "status" "MessengerAttachmentStatus" NOT NULL DEFAULT 'reserved',
    "storageKey" TEXT NOT NULL,
    "thumbnailStorageKey" TEXT,
    "posterStorageKey" TEXT,
    "objectEtag" TEXT,
    "objectVersion" TEXT,
    "checksumSha256" TEXT,
    "fileNameCiphertext" BYTEA NOT NULL,
    "fileNameNonce" BYTEA NOT NULL,
    "fileNameKeyVersion" INTEGER NOT NULL,
    "declaredContentType" TEXT NOT NULL,
    "declaredByteSize" BIGINT NOT NULL,
    "detectedContentType" TEXT,
    "verifiedByteSize" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "rejectionCode" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "scanStartedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "attachedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "messageId" TEXT,
    CONSTRAINT "MessengerMessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerMediaJob" (
    "id" TEXT NOT NULL,
    "status" "MessengerMediaJobStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    CONSTRAINT "MessengerMediaJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessengerMessageAttachment_storageKey_key" ON "MessengerMessageAttachment"("storageKey");
CREATE UNIQUE INDEX "MessengerMessageAttachment_thumbnailStorageKey_key" ON "MessengerMessageAttachment"("thumbnailStorageKey");
CREATE UNIQUE INDEX "MessengerMessageAttachment_posterStorageKey_key" ON "MessengerMessageAttachment"("posterStorageKey");
CREATE INDEX "MessengerMessageAttachment_workspaceId_createdByUserId_status_expiresAt_idx" ON "MessengerMessageAttachment"("workspaceId", "createdByUserId", "status", "expiresAt");
CREATE INDEX "MessengerMessageAttachment_conversationId_status_createdAt_idx" ON "MessengerMessageAttachment"("conversationId", "status", "createdAt");
CREATE INDEX "MessengerMessageAttachment_messageId_idx" ON "MessengerMessageAttachment"("messageId");
CREATE INDEX "MessengerMessageAttachment_status_expiresAt_idx" ON "MessengerMessageAttachment"("status", "expiresAt");
CREATE UNIQUE INDEX "MessengerMediaJob_attachmentId_key" ON "MessengerMediaJob"("attachmentId");
CREATE INDEX "MessengerMediaJob_status_availableAt_leaseExpiresAt_idx" ON "MessengerMediaJob"("status", "availableAt", "leaseExpiresAt");
CREATE INDEX "MessengerMediaJob_workspaceId_createdAt_idx" ON "MessengerMediaJob"("workspaceId", "createdAt");

ALTER TABLE "MessengerMessageAttachment" ADD CONSTRAINT "MessengerMessageAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageAttachment" ADD CONSTRAINT "MessengerMessageAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageAttachment" ADD CONSTRAINT "MessengerMessageAttachment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageAttachment" ADD CONSTRAINT "MessengerMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MessengerMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerMediaJob" ADD CONSTRAINT "MessengerMediaJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMediaJob" ADD CONSTRAINT "MessengerMediaJob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessengerMessageAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessengerMessageAttachment"
ADD CONSTRAINT "MessengerMessageAttachment_size_check"
CHECK (
    "declaredByteSize" > 0
    AND ("verifiedByteSize" IS NULL OR "verifiedByteSize" > 0)
    AND ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0)
    AND ("durationMs" IS NULL OR "durationMs" >= 0)
    AND "fileNameKeyVersion" >= 1
);

ALTER TABLE "MessengerMessageAttachment"
ADD CONSTRAINT "MessengerMessageAttachment_scope_check"
CHECK (
    length("storageKey") BETWEEN 1 AND 512
    AND length("declaredContentType") BETWEEN 1 AND 255
    AND ("messageId" IS NULL OR "status" IN ('attached', 'deleting'))
    AND ("status" <> 'attached' OR ("messageId" IS NOT NULL AND "attachedAt" IS NOT NULL))
    AND ("status" <> 'ready' OR "readyAt" IS NOT NULL)
    AND ("status" NOT IN ('uploaded', 'scanning', 'ready', 'attached') OR "uploadedAt" IS NOT NULL)
);

ALTER TABLE "MessengerMediaJob"
ADD CONSTRAINT "MessengerMediaJob_lease_check"
CHECK (
    "attemptCount" >= 0
    AND (
        ("leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
        OR
        ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    )
);
