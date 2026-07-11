CREATE TYPE "AiAgentTaskStatus" AS ENUM ('awaiting_confirmation', 'running', 'completed', 'blocked', 'stopped', 'failed');
CREATE TYPE "AiAgentStepStatus" AS ENUM ('running', 'completed', 'failed');
CREATE TYPE "AiAgentActionType" AS ENUM ('read', 'create', 'update', 'create_diagram', 'run', 'inspect_run');

CREATE TABLE "AiAgentTask" (
  "id" TEXT NOT NULL,
  "status" "AiAgentTaskStatus" NOT NULL DEFAULT 'awaiting_confirmation',
  "prompt" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "summary" TEXT,
  "errorCode" TEXT,
  "clientRequestId" TEXT NOT NULL,
  "activeDocumentId" TEXT,
  "providerMessages" JSONB,
  "observations" JSONB,
  "processingLeaseId" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "toolCallCount" INTEGER NOT NULL DEFAULT 0,
  "writeBytes" INTEGER NOT NULL DEFAULT 0,
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "planMessageId" TEXT NOT NULL,
  CONSTRAINT "AiAgentTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAgentStep" (
  "id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action" "AiAgentActionType" NOT NULL,
  "status" "AiAgentStepStatus" NOT NULL DEFAULT 'running',
  "label" TEXT NOT NULL,
  "input" JSONB,
  "output" JSONB,
  "errorCode" TEXT,
  "documentId" TEXT,
  "runId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "taskId" TEXT NOT NULL,
  CONSTRAINT "AiAgentStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAgentTask_workspaceId_ownerUserId_clientRequestId_key" ON "AiAgentTask"("workspaceId", "ownerUserId", "clientRequestId");
CREATE INDEX "AiAgentTask_workspaceId_ownerUserId_status_updatedAt_idx" ON "AiAgentTask"("workspaceId", "ownerUserId", "status", "updatedAt");
CREATE INDEX "AiAgentTask_conversationId_createdAt_idx" ON "AiAgentTask"("conversationId", "createdAt");
CREATE UNIQUE INDEX "AiAgentStep_taskId_sequence_key" ON "AiAgentStep"("taskId", "sequence");
CREATE INDEX "AiAgentStep_taskId_createdAt_idx" ON "AiAgentStep"("taskId", "createdAt");

ALTER TABLE "AiAgentTask" ADD CONSTRAINT "AiAgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAgentTask" ADD CONSTRAINT "AiAgentTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAgentTask" ADD CONSTRAINT "AiAgentTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAgentTask" ADD CONSTRAINT "AiAgentTask_planMessageId_fkey" FOREIGN KEY ("planMessageId") REFERENCES "AiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAgentStep" ADD CONSTRAINT "AiAgentStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiAgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
