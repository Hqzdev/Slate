import assert from "node:assert/strict";
import test, { after } from "node:test";
import { AiAssistantService } from "../lib/server/ai/assistantService";
import type { AiConversationRepository } from "../lib/server/ai/conversationRepository";
import { AiDomainError } from "../lib/server/ai/errors";
import type { AiOrchestrator } from "../lib/server/ai/orchestrator";
import type { AiUsageLimiter } from "../lib/server/ai/usageLimiter";
import type { WorkspaceContextBuilder } from "../lib/server/ai/workspaceContextBuilder";
import type { WorkspaceAccessPolicy } from "../lib/server/workspaceAccessPolicy";
import { redis } from "../lib/server/redis";

after(() => redis.disconnect());

function input() {
  return {
    activeDocumentId: "document-1",
    clientRequestId: "request-1",
    content: "Explain this document"
  };
}

function accessPolicy(reads: string[]) {
  return {
    async requireWorkspaceReader(userId: string, workspaceId: string) {
      reads.push(`${userId}:${workspaceId}`);
      return { role: "viewer" };
    }
  } as unknown as WorkspaceAccessPolicy;
}

function usageLimiter() {
  return {
    async run<T>(_userId: string, operation: () => Promise<T>) {
      return operation();
    }
  } as unknown as AiUsageLimiter;
}

function contextBuilder() {
  return {
    async build() {
      return { prompt: "workspace context" };
    }
  } as unknown as WorkspaceContextBuilder;
}

test("AI assistant clears the current user's workspace conversation", async () => {
  const reads: string[] = [];
  const cleared: string[] = [];
  const repository = {
    async clearConversation(userId: string, workspaceId: string) {
      cleared.push(`${userId}:${workspaceId}`);
    }
  } as unknown as AiConversationRepository;
  const service = new AiAssistantService({
    accessPolicy: accessPolicy(reads),
    conversationRepository: repository
  });

  await service.clearConversation("viewer-1", "workspace-1");

  assert.deepEqual(reads, ["viewer-1:workspace-1"]);
  assert.deepEqual(cleared, ["viewer-1:workspace-1"]);
});

test("AI assistant lets a workspace viewer ask and persists the completed turn", async () => {
  const reads: string[] = [];
  const completed: unknown[] = [];
  const requestMessage = { id: "message-1", status: "pending" };
  const responseMessage = { id: "message-2", status: "completed" };
  const repository = {
    async beginTurn() {
      return {
        conversationId: "conversation-1",
        created: true,
        processingLeaseId: "lease-1",
        request: requestMessage,
        response: null
      };
    },
    async completeTurn(value: unknown) {
      completed.push(value);
      return responseMessage;
    },
    async listProviderHistory() {
      return [];
    }
  } as unknown as AiConversationRepository;
  const orchestrator = {
    async run() {
      return { content: "Document summary", drafts: [], providerRequestId: "provider-1" };
    }
  } as unknown as AiOrchestrator;
  const service = new AiAssistantService({
    accessPolicy: accessPolicy(reads),
    contextBuilder: contextBuilder(),
    conversationRepository: repository,
    createOrchestrator: () => orchestrator,
    usageLimiter: usageLimiter()
  });

  const result = await service.sendMessage("viewer-1", "workspace-1", input());

  assert.equal(result.replayed, false);
  assert.equal(result.responseMessage, responseMessage);
  assert.deepEqual(reads, ["viewer-1:workspace-1", "viewer-1:workspace-1"]);
  assert.deepEqual(completed, [{
    content: "Document summary",
    conversationId: "conversation-1",
    drafts: [],
    mode: "ask",
    ownerUserId: "viewer-1",
    processingLeaseId: "lease-1",
    providerRequestId: "provider-1",
    requestMessageId: "message-1",
    workspaceId: "workspace-1"
  }]);
});

test("AI assistant persists a useful failed response when the provider is unavailable", async () => {
  const failures: unknown[] = [];
  const repository = {
    async beginTurn() {
      return {
        conversationId: "conversation-1",
        created: true,
        processingLeaseId: "lease-1",
        request: { id: "message-1", status: "pending" },
        response: null
      };
    },
    async failTurn(value: unknown) {
      failures.push(value);
      return null;
    },
    async listProviderHistory() {
      return [];
    }
  } as unknown as AiConversationRepository;
  const orchestrator = {
    async run() {
      throw new AiDomainError("provider_unavailable", "GigaChat is unavailable", 503, true);
    }
  } as unknown as AiOrchestrator;
  const service = new AiAssistantService({
    accessPolicy: accessPolicy([]),
    contextBuilder: contextBuilder(),
    conversationRepository: repository,
    createOrchestrator: () => orchestrator,
    usageLimiter: usageLimiter()
  });

  await assert.rejects(
    () => service.sendMessage("viewer-1", "workspace-1", input()),
    (error: unknown) => error instanceof AiDomainError && error.code === "provider_unavailable" && error.retryable
  );
  assert.deepEqual(failures, [{
    conversationId: "conversation-1",
    errorCode: "provider_unavailable",
    message: "The workspace assistant is temporarily unavailable. Retry this request when the service recovers.",
    ownerUserId: "viewer-1",
    processingLeaseId: "lease-1",
    requestMessageId: "message-1",
    workspaceId: "workspace-1"
  }]);
});
