CREATE TYPE "MessengerAiInvocationStatus" AS ENUM ('skipped', 'queued', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE "MessengerAiProviderDispatchState" AS ENUM ('not_dispatched', 'dispatching', 'dispatched', 'outcome_unknown');
CREATE TYPE "MessengerAiAttachmentExtractionStatus" AS ENUM ('pending', 'completed', 'failed');

ALTER TABLE "MessengerMessage" ADD COLUMN "inReplyToMessageId" TEXT;
CREATE INDEX "MessengerMessage_conversationId_inReplyToMessageId_idx" ON "MessengerMessage"("conversationId", "inReplyToMessageId");

CREATE TABLE "MessengerAiInvocation" (
    "id" TEXT NOT NULL,
    "status" "MessengerAiInvocationStatus" NOT NULL DEFAULT 'queued',
    "contextThroughSequence" BIGINT NOT NULL,
    "contextMessageIds" JSONB NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "processingLeaseId" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerRequestId" TEXT,
    "providerDispatchState" "MessengerAiProviderDispatchState" NOT NULL DEFAULT 'not_dispatched',
    "draftSuggestionCiphertext" BYTEA,
    "draftSuggestionNonce" BYTEA,
    "draftSuggestionKeyVersion" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "responseMessageId" TEXT,
    CONSTRAINT "MessengerAiInvocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerAiInvocationAttachment" (
    "id" TEXT NOT NULL,
    "extractionStatus" "MessengerAiAttachmentExtractionStatus" NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "verifiedContentHash" TEXT,
    "characterCount" INTEGER,
    "extractCiphertext" BYTEA,
    "extractNonce" BYTEA,
    "extractKeyVersion" INTEGER,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invocationId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "consentedByUserId" TEXT NOT NULL,
    CONSTRAINT "MessengerAiInvocationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerAiHandoff" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invocationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "targetAiConversationId" TEXT,
    CONSTRAINT "MessengerAiHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessengerAiInvocation_sourceMessageId_key" ON "MessengerAiInvocation"("sourceMessageId");
CREATE UNIQUE INDEX "MessengerAiInvocation_responseMessageId_key" ON "MessengerAiInvocation"("responseMessageId");
CREATE INDEX "MessengerAiInvocation_status_createdAt_idx" ON "MessengerAiInvocation"("status", "createdAt");
CREATE INDEX "MessengerAiInvocation_workspaceId_requestedByUserId_status_idx" ON "MessengerAiInvocation"("workspaceId", "requestedByUserId", "status");
CREATE INDEX "MessengerAiInvocation_conversationId_createdAt_idx" ON "MessengerAiInvocation"("conversationId", "createdAt");
CREATE UNIQUE INDEX "MessengerAiInvocationAttachment_invocationId_attachmentId_key" ON "MessengerAiInvocationAttachment"("invocationId", "attachmentId");
CREATE INDEX "MessengerAiInvocationAttachment_attachmentId_idx" ON "MessengerAiInvocationAttachment"("attachmentId");
CREATE INDEX "MessengerAiInvocationAttachment_expiresAt_idx" ON "MessengerAiInvocationAttachment"("expiresAt");
CREATE UNIQUE INDEX "MessengerAiHandoff_targetAiConversationId_key" ON "MessengerAiHandoff"("targetAiConversationId");
CREATE UNIQUE INDEX "MessengerAiHandoff_invocationId_requestedByUserId_key" ON "MessengerAiHandoff"("invocationId", "requestedByUserId");
CREATE INDEX "MessengerAiHandoff_requestedByUserId_createdAt_idx" ON "MessengerAiHandoff"("requestedByUserId", "createdAt");

ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "MessengerMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_responseMessageId_fkey" FOREIGN KEY ("responseMessageId") REFERENCES "MessengerMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocationAttachment" ADD CONSTRAINT "MessengerAiInvocationAttachment_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "MessengerAiInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAiInvocationAttachment" ADD CONSTRAINT "MessengerAiInvocationAttachment_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessengerMessageAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerAiHandoff" ADD CONSTRAINT "MessengerAiHandoff_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "MessengerAiInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAiHandoff" ADD CONSTRAINT "MessengerAiHandoff_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerAiHandoff" ADD CONSTRAINT "MessengerAiHandoff_targetAiConversationId_fkey" FOREIGN KEY ("targetAiConversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_lease_check" CHECK (
    "attemptCount" >= 0
    AND (("processingLeaseId" IS NULL AND "processingStartedAt" IS NULL) OR ("processingLeaseId" IS NOT NULL AND "processingStartedAt" IS NOT NULL))
);

ALTER TABLE "MessengerAiInvocation" ADD CONSTRAINT "MessengerAiInvocation_envelope_check" CHECK (
    ("draftSuggestionCiphertext" IS NULL AND "draftSuggestionNonce" IS NULL AND "draftSuggestionKeyVersion" IS NULL)
    OR ("draftSuggestionCiphertext" IS NOT NULL AND "draftSuggestionNonce" IS NOT NULL AND "draftSuggestionKeyVersion" >= 1)
);

ALTER TABLE "MessengerAiInvocationAttachment" ADD CONSTRAINT "MessengerAiInvocationAttachment_extract_check" CHECK (
    ("extractCiphertext" IS NULL AND "extractNonce" IS NULL AND "extractKeyVersion" IS NULL)
    OR ("extractCiphertext" IS NOT NULL AND "extractNonce" IS NOT NULL AND "extractKeyVersion" >= 1)
    AND ("characterCount" IS NULL OR "characterCount" >= 0)
);
