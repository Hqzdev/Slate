CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

CREATE TYPE "AiMessageStatus" AS ENUM ('pending', 'completed', 'failed');

CREATE TYPE "AiDraftActionType" AS ENUM ('create_document', 'create_note', 'create_table_note', 'create_canvas_diagram');

CREATE TYPE "AiDraftActionStatus" AS ENUM ('pending', 'applying', 'applied', 'discarded', 'failed');

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "status" "AiMessageStatus" NOT NULL DEFAULT 'completed',
    "content" TEXT NOT NULL,
    "errorCode" TEXT,
    "providerRequestId" TEXT,
    "clientRequestId" TEXT,
    "activeDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "inReplyToMessageId" TEXT,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDraftAction" (
    "id" TEXT NOT NULL,
    "type" "AiDraftActionType" NOT NULL,
    "status" "AiDraftActionStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "proposedByMessageId" TEXT NOT NULL,
    "resultDocumentId" TEXT,

    CONSTRAINT "AiDraftAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiConversation_workspaceId_ownerUserId_key" ON "AiConversation"("workspaceId", "ownerUserId");
CREATE INDEX "AiConversation_ownerUserId_updatedAt_idx" ON "AiConversation"("ownerUserId", "updatedAt");
CREATE UNIQUE INDEX "AiMessage_inReplyToMessageId_key" ON "AiMessage"("inReplyToMessageId");
CREATE UNIQUE INDEX "AiMessage_conversationId_clientRequestId_key" ON "AiMessage"("conversationId", "clientRequestId");
CREATE INDEX "AiMessage_conversationId_createdAt_id_idx" ON "AiMessage"("conversationId", "createdAt", "id");
CREATE INDEX "AiDraftAction_conversationId_status_createdAt_idx" ON "AiDraftAction"("conversationId", "status", "createdAt");
CREATE INDEX "AiDraftAction_workspaceId_ownerUserId_status_idx" ON "AiDraftAction"("workspaceId", "ownerUserId", "status");
CREATE INDEX "AiDraftAction_expiresAt_status_idx" ON "AiDraftAction"("expiresAt", "status");

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_inReplyToMessageId_fkey" FOREIGN KEY ("inReplyToMessageId") REFERENCES "AiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftAction" ADD CONSTRAINT "AiDraftAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftAction" ADD CONSTRAINT "AiDraftAction_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftAction" ADD CONSTRAINT "AiDraftAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftAction" ADD CONSTRAINT "AiDraftAction_proposedByMessageId_fkey" FOREIGN KEY ("proposedByMessageId") REFERENCES "AiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftAction" ADD CONSTRAINT "AiDraftAction_resultDocumentId_fkey" FOREIGN KEY ("resultDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
