import { workspaceAccessPolicy, type WorkspaceAccessPolicy } from "../workspaceAccessPolicy";
import { aiActionExecutor, type AiActionExecutor } from "./actionExecutor";
import { aiConversationRepository, type AiConversationRepository } from "./conversationRepository";
import { AiDomainError, toAiDomainError } from "./errors";
import { getGigaChatClient } from "./gigaChatClientProvider";
import { AiOrchestrator } from "./orchestrator";
import type { AiMessageInput } from "./input";
import { aiUsageLimiter, type AiUsageLimiter } from "./usageLimiter";
import { workspaceContextBuilder, type WorkspaceContextBuilder } from "./workspaceContextBuilder";

type AiAssistantServiceOptions = {
  actionExecutor?: AiActionExecutor;
  accessPolicy?: WorkspaceAccessPolicy;
  contextBuilder?: WorkspaceContextBuilder;
  conversationRepository?: AiConversationRepository;
  createOrchestrator?: () => AiOrchestrator;
  usageLimiter?: AiUsageLimiter;
};

export class AiAssistantService {
  private readonly actionExecutor: AiActionExecutor;
  private readonly accessPolicy: WorkspaceAccessPolicy;
  private readonly contextBuilder: WorkspaceContextBuilder;
  private readonly conversationRepository: AiConversationRepository;
  private readonly createOrchestrator: () => AiOrchestrator;
  private readonly usageLimiter: AiUsageLimiter;

  constructor(options: AiAssistantServiceOptions = {}) {
    this.actionExecutor = options.actionExecutor ?? aiActionExecutor;
    this.accessPolicy = options.accessPolicy ?? workspaceAccessPolicy;
    this.contextBuilder = options.contextBuilder ?? workspaceContextBuilder;
    this.conversationRepository = options.conversationRepository ?? aiConversationRepository;
    this.usageLimiter = options.usageLimiter ?? aiUsageLimiter;
    this.createOrchestrator = options.createOrchestrator ?? (() => new AiOrchestrator(getGigaChatClient(), this.contextBuilder));
  }

  async getConversation(ownerUserId: string, workspaceId: string, cursor: string | null, conversationId: string | null = null) {
    await this.accessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    return this.conversationRepository.getConversation(ownerUserId, workspaceId, cursor, conversationId);
  }

  async clearConversation(ownerUserId: string, workspaceId: string) {
    await this.accessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    await this.conversationRepository.clearConversation(ownerUserId, workspaceId);
  }

  async sendMessage(ownerUserId: string, workspaceId: string, input: AiMessageInput, externalSignal?: AbortSignal) {
    await this.accessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    const turn = await this.conversationRepository.beginTurn(ownerUserId, workspaceId, input.content, input.clientRequestId, input.activeDocumentId, input.mode ?? "ask", input.conversationId ?? null);
    if (!turn.created) {
      if (!turn.response) {
        throw new AiDomainError("ai_request_in_progress", "This assistant request is still being processed. Retry shortly.", 409, true);
      }
      return {
        conversationId: turn.conversationId,
        replayed: true,
        requestMessage: turn.request,
        responseMessage: turn.response
      };
    }
    const processingLeaseId = turn.processingLeaseId;
    if (!processingLeaseId) {
      throw new AiDomainError("ai_turn_conflict", "Assistant request processing lease is missing", 409, true);
    }

    let controller: AbortController | null = null;
    let requestTimedOut = false;
    try {
      return await this.usageLimiter.run(ownerUserId, async () => {
        controller = new AbortController();
        const abortFromRequest = () => controller?.abort();
        externalSignal?.addEventListener("abort", abortFromRequest, { once: true });
        if (externalSignal?.aborted) controller.abort();
        const timeout = setTimeout(() => {
          requestTimedOut = true;
          controller?.abort();
        }, 45_000);
        try {
          const [context, history] = await Promise.all([
            this.contextBuilder.build(ownerUserId, workspaceId, input.activeDocumentId),
            this.conversationRepository.listProviderHistory(turn.conversationId, turn.request.id)
          ]);
          const result = await this.createOrchestrator().run({
            context: context.prompt,
            history,
            observations: context.observations,
            ownerUserId,
            mode: input.mode,
            signal: controller.signal,
            userContent: input.content,
            workspaceId
          });
          await this.accessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
          const response = await this.conversationRepository.completeTurn({
            content: result.content,
            conversationId: turn.conversationId,
            drafts: result.drafts,
            mode: input.mode ?? "ask",
            ownerUserId,
            processingLeaseId,
            providerRequestId: result.providerRequestId,
            requestMessageId: turn.request.id,
            workspaceId
          });
          return {
            conversationId: turn.conversationId,
            replayed: false,
            requestMessage: turn.request,
            responseMessage: response
          };
        } finally {
          clearTimeout(timeout);
          externalSignal?.removeEventListener("abort", abortFromRequest);
        }
      });
    } catch (error) {
      const domainError = requestTimedOut
        ? new AiDomainError("provider_timeout", "GigaChat request timed out", 504, true)
        : toAiDomainError(error);
      await this.conversationRepository.failTurn({
        conversationId: turn.conversationId,
        errorCode: domainError.code,
        message: failureMessage(domainError),
        ownerUserId,
        processingLeaseId,
        requestMessageId: turn.request.id,
        workspaceId
      }).catch(() => null);
      throw domainError;
    }
  }

  applyAction(ownerUserId: string, workspaceId: string, actionId: string) {
    return this.actionExecutor.apply(ownerUserId, workspaceId, [actionId]);
  }

  applyActions(ownerUserId: string, workspaceId: string, actionIds: string[]) {
    return this.actionExecutor.apply(ownerUserId, workspaceId, actionIds);
  }

  discardAction(ownerUserId: string, workspaceId: string, actionId: string) {
    return this.actionExecutor.discard(ownerUserId, workspaceId, actionId);
  }
}

function failureMessage(error: AiDomainError) {
  if (error.code === "provider_not_configured") return "The workspace assistant is not configured yet.";
  if (error.code === "provider_certificate_error") return error.message;
  if (error.retryable) return "The workspace assistant is temporarily unavailable. Retry this request when the service recovers.";
  return "The workspace assistant could not complete this request.";
}

export const aiAssistantService = new AiAssistantService();
