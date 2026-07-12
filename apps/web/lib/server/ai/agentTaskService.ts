import { randomUUID } from "node:crypto";
import { Prisma, type AiAgentActionType } from "@prisma/client";
import { parseAiDraftActionPayload, summarizeAiDraftActionPayload } from "../../ai/draftAction";
import { isDatabaseSafeText, truncateDatabaseSafeText } from "../../databaseSafeText";
import { activityRepository } from "../activityRepository";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { getRunQueue } from "../runQueue";
import { workspaceAccessPolicy } from "../workspaceAccessPolicy";
import { workspaceRepository } from "../workspaceRepository";
import { aiActionExecutor } from "./actionExecutor";
import { aiAgentSystemPrompt, aiAgentTools } from "./agentTools";
import { createUpdateDocumentDraft } from "./documentUpdateDraft";
import { AiDomainError, toAiDomainError } from "./errors";
import { getGigaChatClient } from "./gigaChatClientProvider";
import { AiOrchestrator } from "./orchestrator";
import type { AiDraftActionTypeValue, AiProviderMessage, AiProviderToolCall } from "./types";
import { workspaceContextBuilder, type AiDocumentObservation } from "./workspaceContextBuilder";

const taskLifetimeMs = 10 * 60_000;
const processingLeaseMs = 60_000;
const maximumToolCalls = 16;
const maximumWriteBytes = 256 * 1_024;
const maximumRuns = 3;
const maximumProviderContextBytes = 128 * 1_024;
const executionEnvironmentIds = new Set(["dry-run", "node-container", "node-syntax-check"]);
const writeToolNames = new Set(["create_document", "create_note", "create_table_note", "create_canvas_diagram", "update_document"]);
const agentToolNames = new Set(aiAgentTools.map((tool) => tool.name));

type AgentTaskCreation = {
  activeDocumentId: string | null;
  clientRequestId: string;
  conversationId: string;
  ownerUserId: string;
  plan: string;
  planMessageId: string;
  prompt: string;
  workspaceId: string;
};

type StoredObservations = Record<string, AiDocumentObservation>;

export class AiAgentTaskService {
  async createFromPlan(input: AgentTaskCreation) {
    await workspaceAccessPolicy.requireWorkspaceWriter(input.ownerUserId, input.workspaceId);
    const existing = await prisma.aiAgentTask.findUnique({
      include: { steps: { orderBy: { sequence: "asc" } } },
      where: {
        workspaceId_ownerUserId_clientRequestId: {
          clientRequestId: input.clientRequestId,
          ownerUserId: input.ownerUserId,
          workspaceId: input.workspaceId
        }
      }
    });
    if (existing) {
      if (existing.prompt !== input.prompt || existing.planMessageId !== input.planMessageId) {
        throw new AiDomainError("agent_request_conflict", "Agent request id was already used for another task", 409);
      }
      return this.toTaskPayload(existing);
    }
    const activeTask = await prisma.aiAgentTask.findFirst({
      select: { id: true },
      where: { ownerUserId: input.ownerUserId, status: { in: ["awaiting_confirmation", "blocked", "running"] }, workspaceId: input.workspaceId }
    });
    if (activeTask) throw new AiDomainError("agent_task_active", "Finish or stop the current agent task first", 409);

    const task = await prisma.$transaction(async (transaction) => {
      const created = await transaction.aiAgentTask.create({
        data: {
          activeDocumentId: input.activeDocumentId,
          clientRequestId: input.clientRequestId,
          conversationId: input.conversationId,
          ownerUserId: input.ownerUserId,
          plan: truncateDatabaseSafeText(input.plan, 12_000),
          planMessageId: input.planMessageId,
          prompt: input.prompt,
          workspaceId: input.workspaceId
        },
        include: { steps: true }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: input.ownerUserId,
        metadata: { agentTaskId: created.id, planMessageId: input.planMessageId },
        type: "ai.agent.planned",
        workspaceId: input.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: input.ownerUserId,
        metadata: { agentTaskId: created.id, planMessageId: input.planMessageId },
        type: "ai.agent.planned",
        workspaceId: input.workspaceId
      });
      return created;
    });
    return this.toTaskPayload(task);
  }

  async get(ownerUserId: string, workspaceId: string, taskId: string) {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    return this.toTaskPayload(await this.requireTask(ownerUserId, workspaceId, taskId));
  }

  async getLatest(ownerUserId: string, workspaceId: string, conversationId: string | null = null) {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    const task = await prisma.aiAgentTask.findFirst({
      include: { steps: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "desc" },
      where: { conversation: conversationId ? { publicId: conversationId } : undefined, ownerUserId, workspaceId }
    });
    return task ? this.toTaskPayload(task) : null;
  }

  async confirm(ownerUserId: string, workspaceId: string, taskId: string) {
    await workspaceAccessPolicy.requireWorkspaceWriter(ownerUserId, workspaceId);
    const task = await prisma.$transaction(async (transaction) => {
      const current = await transaction.aiAgentTask.findFirst({ where: { id: taskId, ownerUserId, workspaceId } });
      if (!current) throw new AiDomainError("agent_task_not_found", "Agent task not found", 404);
      if (current.status !== "running" && current.status !== "awaiting_confirmation" && current.status !== "blocked") {
        throw new AiDomainError("agent_task_conflict", "Agent task cannot be confirmed", 409);
      }
      if (current.status !== "running") await transaction.aiAgentTask.update({
        data: {
          confirmedAt: new Date(),
          errorCode: null,
          observations: current.status === "blocked" ? Prisma.DbNull : undefined,
          processingLeaseId: null,
          processingStartedAt: null,
          providerMessages: current.status === "blocked" ? Prisma.DbNull : undefined,
          status: "running"
        },
        where: { id: taskId }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { agentTaskId: taskId },
        type: "ai.agent.confirmed",
        workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { agentTaskId: taskId },
        type: "ai.agent.confirmed",
        workspaceId
      });
      return transaction.aiAgentTask.findFirstOrThrow({
        include: { steps: { orderBy: { sequence: "asc" } } },
        where: { id: taskId, ownerUserId, workspaceId }
      });
    });
    return this.toTaskPayload(task);
  }

  async stop(ownerUserId: string, workspaceId: string, taskId: string) {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.aiAgentTask.updateMany({
        data: { processingLeaseId: null, processingStartedAt: null, status: "stopped", stoppedAt: new Date() },
        where: { id: taskId, ownerUserId, status: { in: ["awaiting_confirmation", "blocked", "running"] }, workspaceId }
      });
      if (changed.count === 0) return;
      await activityRepository.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { agentTaskId: taskId },
        type: "ai.agent.stopped",
        workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { agentTaskId: taskId },
        type: "ai.agent.stopped",
        workspaceId
      });
    });
    return this.get(ownerUserId, workspaceId, taskId);
  }

  async prepareDrafts(ownerUserId: string, workspaceId: string, taskId: string) {
    await workspaceAccessPolicy.requireWorkspaceWriter(ownerUserId, workspaceId);
    const task = await this.requireTask(ownerUserId, workspaceId, taskId);
    if (!["awaiting_confirmation", "blocked"].includes(task.status)) {
      throw new AiDomainError("agent_task_conflict", "Drafts can only be prepared before agent execution", 409);
    }
    const context = await workspaceContextBuilder.build(ownerUserId, workspaceId, task.activeDocumentId);
    const result = await new AiOrchestrator(getGigaChatClient(), workspaceContextBuilder).run({
      context: context.prompt,
      history: [],
      mode: "draft",
      observations: context.observations,
      ownerUserId,
      userContent: task.prompt,
      workspaceId
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    const actions = await prisma.$transaction(async (transaction) => {
      const created = await Promise.all(result.drafts.map((draft) => transaction.aiDraftAction.create({
        data: {
          conversationId: task.conversationId,
          expiresAt,
          ownerUserId,
          payload: draft.payload as Prisma.InputJsonValue,
          proposedByMessageId: task.planMessageId,
          type: draft.type,
          workspaceId
        }
      })));
      await transaction.aiAgentTask.update({
        data: {
          processingLeaseId: null,
          processingStartedAt: null,
          status: "stopped",
          stoppedAt: new Date(),
          summary: `Prepared ${created.length} manual draft${created.length === 1 ? "" : "s"}.`
        },
        where: { id: taskId }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { actionCount: created.length, agentTaskId: taskId },
        type: "ai.agent.drafts.prepared",
        workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { actionCount: created.length, agentTaskId: taskId },
        type: "ai.agent.drafts.prepared",
        workspaceId
      });
      return created;
    });
    return {
      actions: actions.map((action) => ({
        createdAt: action.createdAt.toISOString(),
        errorCode: action.errorCode,
        expiresAt: action.expiresAt.toISOString(),
        id: action.id,
        payload: summarizeAiDraftActionPayload(action.type as AiDraftActionTypeValue, action.payload),
        resultDocumentId: action.resultDocumentId,
        status: action.status,
        type: action.type
      })),
      agentTask: await this.get(ownerUserId, workspaceId, taskId)
    };
  }

  async executeNext(ownerUserId: string, workspaceId: string, taskId: string) {
    await workspaceAccessPolicy.requireWorkspaceWriter(ownerUserId, workspaceId);
    const leaseId = randomUUID();
    const staleBefore = new Date(Date.now() - processingLeaseMs);
    const claimed = await prisma.aiAgentTask.updateMany({
      data: { processingLeaseId: leaseId, processingStartedAt: new Date() },
      where: {
        id: taskId,
        ownerUserId,
        OR: [{ processingLeaseId: null }, { processingStartedAt: { lte: staleBefore } }],
        status: "running",
        workspaceId
      }
    });
    if (claimed.count !== 1) return this.get(ownerUserId, workspaceId, taskId);

    let action: AiAgentActionType = "read";
    let label = "Reading workspace";
    let safeInput: Prisma.InputJsonValue | undefined;
    try {
      const task = await this.requireTask(ownerUserId, workspaceId, taskId);
      this.requireWithinLimits(task);
      const state = await this.providerState(task);
      const response = await getGigaChatClient().complete({ messages: state.messages, tools: aiAgentTools });
      await this.requireActiveLease(taskId, leaseId);

      if (response.toolCalls.length === 0) {
        const summary = truncateDatabaseSafeText(response.content.trim(), 12_000) || "Agent task completed.";
        await prisma.$transaction(async (transaction) => {
          await transaction.aiAgentTask.update({
            data: {
              completedAt: new Date(),
              errorCode: null,
              processingLeaseId: null,
              processingStartedAt: null,
              providerMessages: state.messages as unknown as Prisma.InputJsonValue,
              status: "completed",
              summary
            },
            where: { id: taskId }
          });
          await activityRepository.recordWithClient(transaction, {
            actorUserId: ownerUserId,
            metadata: { agentTaskId: taskId, toolCallCount: task.toolCallCount },
            type: "ai.agent.completed",
            workspaceId
          });
          await auditLogService.recordWithClient(transaction, {
            actorUserId: ownerUserId,
            metadata: { agentTaskId: taskId, toolCallCount: task.toolCallCount },
            type: "ai.agent.completed",
            workspaceId
          });
        });
        return this.get(ownerUserId, workspaceId, taskId);
      }
      if (response.toolCalls.length !== 1) {
        throw new AiDomainError("provider_multiple_tool_calls", "Agent returned multiple tool calls in one step", 502, true);
      }

      const toolCall = response.toolCalls[0];
      if (!agentToolNames.has(toolCall.name)) {
        throw new AiDomainError("unsupported_tool", `Unsupported agent tool ${toolCall.name}`, 502);
      }
      const descriptor = this.describeTool(toolCall);
      action = descriptor.action;
      label = descriptor.label;
      safeInput = this.safeToolInput(toolCall) as Prisma.InputJsonValue;
      const assistantMessage: AiProviderMessage = {
        content: response.content,
        functionCall: toolCall,
        functionsStateId: response.functionsStateId,
        role: "assistant"
      };
      const execution = await this.executeTool(ownerUserId, workspaceId, task, toolCall, state.observations);
      const messages = [
        ...state.messages,
        assistantMessage,
        { content: execution.providerResult, name: toolCall.name, toolCallId: toolCall.id, role: "tool" as const }
      ];
      if (Buffer.byteLength(JSON.stringify(messages), "utf8") > maximumProviderContextBytes) {
        throw new AiDomainError("agent_context_limit", "Agent context limit exceeded", 422);
      }
      await this.requireActiveLease(taskId, leaseId);
      const nextSequence = task.steps.length + 1;
      await prisma.$transaction(async (transaction) => {
        await transaction.aiAgentStep.create({
          data: {
            action,
            documentId: execution.documentId,
            input: safeInput,
            label,
            output: execution.stepOutput as Prisma.InputJsonValue,
            runId: execution.runId,
            sequence: nextSequence,
            status: "completed",
            taskId
          }
        });
        await transaction.aiAgentTask.update({
          data: {
            observations: state.observations as unknown as Prisma.InputJsonValue,
            processingLeaseId: null,
            processingStartedAt: null,
            providerMessages: messages as unknown as Prisma.InputJsonValue,
            runCount: { increment: execution.runIncrement },
            toolCallCount: { increment: 1 },
            writeBytes: { increment: execution.writeBytes }
          },
          where: { id: taskId }
        });
        await activityRepository.recordWithClient(transaction, {
          actorUserId: ownerUserId,
          documentId: execution.documentId,
          metadata: { action, agentTaskId: taskId, runId: execution.runId, sequence: nextSequence },
          type: "ai.agent.step.completed",
          workspaceId
        });
        await auditLogService.recordWithClient(transaction, {
          actorUserId: ownerUserId,
          documentId: execution.documentId,
          metadata: { action, agentTaskId: taskId, runId: execution.runId, sequence: nextSequence },
          type: "ai.agent.step.completed",
          workspaceId
        });
      });
      return this.get(ownerUserId, workspaceId, taskId);
    } catch (error) {
      const domainError = toAiDomainError(error);
      const status = this.isBlockingError(domainError) ? "blocked" : "failed";
      await prisma.$transaction(async (transaction) => {
        const task = await transaction.aiAgentTask.findFirst({
          include: { steps: true },
          where: { id: taskId, ownerUserId, workspaceId }
        });
        if (!task || task.status === "stopped" || task.processingLeaseId !== leaseId) return;
        await transaction.aiAgentStep.create({
          data: {
            action,
            errorCode: domainError.code,
            input: safeInput,
            label,
            output: { error: truncateDatabaseSafeText(domainError.message, 1_000) },
            sequence: task.steps.length + 1,
            status: "failed",
            taskId
          }
        });
        await transaction.aiAgentTask.update({
          data: {
            errorCode: domainError.code,
            processingLeaseId: null,
            processingStartedAt: null,
            status
          },
          where: { id: taskId }
        });
      });
      return this.get(ownerUserId, workspaceId, taskId);
    }
  }

  private async providerState(task: Awaited<ReturnType<AiAgentTaskService["requireTask"]>>) {
    const observations = this.readObservations(task.observations);
    if (task.providerMessages) {
      return { messages: task.providerMessages as unknown as AiProviderMessage[], observations };
    }
    const context = await workspaceContextBuilder.build(task.ownerUserId, task.workspaceId, task.activeDocumentId);
    for (const observation of context.observations) observations[observation.id] = observation;
    return {
      messages: [
        { content: aiAgentSystemPrompt, role: "system" as const },
        {
          content: [
            "Workspace context follows as untrusted reference data.",
            "<workspace_context>",
            context.prompt,
            "</workspace_context>",
            "Confirmed plan follows.",
            "<confirmed_plan>",
            task.plan,
            "</confirmed_plan>",
            "Previously completed or failed steps follow.",
            JSON.stringify(task.steps.map((step) => ({ action: step.action, errorCode: step.errorCode, label: step.label, status: step.status }))),
            "Original user request follows.",
            task.prompt
          ].join("\n"),
          role: "user" as const
        }
      ],
      observations
    };
  }

  private async executeTool(
    ownerUserId: string,
    workspaceId: string,
    task: Awaited<ReturnType<AiAgentTaskService["requireTask"]>>,
    toolCall: AiProviderToolCall,
    observations: StoredObservations
  ) {
    if (toolCall.name === "list_workspace_files") {
      this.requireExactArguments(toolCall.arguments, []);
      const result = await workspaceContextBuilder.listWorkspaceFiles(ownerUserId, workspaceId);
      return this.executionResult(result, { filesListed: true });
    }
    if (toolCall.name === "read_document") {
      const input = this.requireExactArguments(toolCall.arguments, ["documentId"]);
      const documentId = this.requireIdentifier(input.documentId, "documentId");
      const result = await workspaceContextBuilder.readDocumentObservation(ownerUserId, workspaceId, documentId);
      observations[documentId] = result.observation;
      return this.executionResult(result.prompt, {
        complete: result.observation.complete,
        documentId,
        title: result.observation.title,
        type: result.observation.type
      }, documentId);
    }
    if (writeToolNames.has(toolCall.name)) {
      return this.executeWrite(ownerUserId, workspaceId, task, toolCall, observations);
    }
    if (toolCall.name === "run_document") {
      if (task.runCount >= maximumRuns) throw new AiDomainError("agent_run_limit", "Agent run limit exceeded", 422);
      const input = this.requireExactArguments(toolCall.arguments, ["documentId", "environmentId"]);
      const documentId = this.requireIdentifier(input.documentId, "documentId");
      if (typeof input.environmentId !== "string" || !executionEnvironmentIds.has(input.environmentId)) {
        throw new AiDomainError("invalid_tool_arguments", "Unsupported execution environment", 422);
      }
      const result = await workspaceRepository.createRun(ownerUserId, documentId, input.environmentId);
      await getRunQueue().add("run_document", {
        documentId,
        environmentId: input.environmentId,
        fileName: result.document.title,
        language: result.document.language,
        runId: result.run.id,
        source: result.document.content
      });
      return this.executionResult(JSON.stringify({ run: result.run }), {
        environmentId: input.environmentId,
        runId: result.run.id,
        status: result.run.status
      }, documentId, result.run.id, 0, 1);
    }
    if (toolCall.name === "inspect_run") {
      const input = this.requireExactArguments(toolCall.arguments, ["runId"]);
      const runId = this.requireIdentifier(input.runId, "runId");
      const run = await prisma.jobRun.findFirst({
        include: { document: { select: { title: true } } },
        where: { id: runId, workspaceId }
      });
      if (!run) throw new AiDomainError("run_not_found", "Run not found", 404);
      const output = truncateDatabaseSafeText(run.output, 16_000);
      const result = {
        documentId: run.documentId,
        documentTitle: run.document?.title ?? null,
        error: run.error,
        output,
        runId,
        status: run.status
      };
      return this.executionResult(JSON.stringify(result), result, run.documentId, runId);
    }
    throw new AiDomainError("unsupported_tool", `Unsupported agent tool ${toolCall.name}`, 422);
  }

  private async executeWrite(
    ownerUserId: string,
    workspaceId: string,
    task: Awaited<ReturnType<AiAgentTaskService["requireTask"]>>,
    toolCall: AiProviderToolCall,
    observations: StoredObservations
  ) {
    let type: AiDraftActionTypeValue;
    let payload: unknown;
    if (toolCall.name === "update_document") {
      const input = this.requireExactArguments(toolCall.arguments, ["documentId", "content"]);
      const documentId = this.requireIdentifier(input.documentId, "documentId");
      if (typeof input.content !== "string") throw new AiDomainError("invalid_tool_arguments", "update_document requires content", 422);
      const observation = observations[documentId];
      if (!observation?.complete) {
        throw new AiDomainError("agent_document_not_observed", "Document must be read completely before update", 409);
      }
      type = "update_document";
      payload = createUpdateDocumentDraft(observation, input.content);
    } else {
      type = toolCall.name as AiDraftActionTypeValue;
      payload = parseAiDraftActionPayload(type, toolCall.arguments);
    }
    const writeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (task.writeBytes + writeBytes > maximumWriteBytes) {
      throw new AiDomainError("agent_write_limit", "Agent write limit exceeded", 422);
    }
    const action = await prisma.aiDraftAction.create({
      data: {
        conversationId: task.conversationId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        ownerUserId,
        payload: payload as Prisma.InputJsonValue,
        proposedByMessageId: task.planMessageId,
        type,
        workspaceId
      }
    });
    const applied = await aiActionExecutor.apply(ownerUserId, workspaceId, [action.id]);
    const document = applied.documents[0];
    return this.executionResult(JSON.stringify({ applied: true, document, type }), {
      actionId: action.id,
      documentId: document?.id ?? null,
      target: document?.title ?? null,
      type,
      summary: summarizeAiDraftActionPayload(type, payload as Prisma.JsonValue)
    }, document?.id ?? null, null, writeBytes);
  }

  private executionResult(
    providerResult: string,
    stepOutput: unknown,
    documentId: string | null = null,
    runId: string | null = null,
    writeBytes = 0,
    runIncrement = 0
  ) {
    return { documentId, providerResult, runId, runIncrement, stepOutput, writeBytes };
  }

  private describeTool(toolCall: AiProviderToolCall): { action: AiAgentActionType; label: string } {
    if (toolCall.name === "create_canvas_diagram") return { action: "create_diagram", label: "Creating canvas diagram" };
    if (["create_document", "create_note", "create_table_note"].includes(toolCall.name)) return { action: "create", label: "Creating document" };
    if (toolCall.name === "update_document") return { action: "update", label: "Updating document" };
    if (toolCall.name === "run_document") return { action: "run", label: "Running document" };
    if (toolCall.name === "inspect_run") return { action: "inspect_run", label: "Inspecting run" };
    return { action: "read", label: toolCall.name === "read_document" ? "Reading document" : "Reading workspace" };
  }

  private safeToolInput(toolCall: AiProviderToolCall) {
    if (!toolCall.arguments || typeof toolCall.arguments !== "object" || Array.isArray(toolCall.arguments)) return {};
    const input = toolCall.arguments as Record<string, unknown>;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [
      key,
      key === "content" ? { bytes: typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0 } : value
    ]));
  }

  private requireWithinLimits(task: Awaited<ReturnType<AiAgentTaskService["requireTask"]>>) {
    if (!task.confirmedAt || Date.now() - task.confirmedAt.getTime() > taskLifetimeMs) {
      throw new AiDomainError("agent_timeout", "Agent task exceeded its time limit", 422);
    }
    if (task.toolCallCount >= maximumToolCalls) throw new AiDomainError("agent_tool_limit", "Agent tool limit exceeded", 422);
    if (task.writeBytes > maximumWriteBytes) throw new AiDomainError("agent_write_limit", "Agent write limit exceeded", 422);
    if (task.runCount > maximumRuns) throw new AiDomainError("agent_run_limit", "Agent run limit exceeded", 422);
  }

  private async requireActiveLease(taskId: string, leaseId: string) {
    const task = await prisma.aiAgentTask.findUnique({ select: { processingLeaseId: true, status: true }, where: { id: taskId } });
    if (!task || task.status !== "running" || task.processingLeaseId !== leaseId) {
      throw new AiDomainError("agent_stopped", "Agent task is no longer running", 409);
    }
  }

  private requireTask(ownerUserId: string, workspaceId: string, taskId: string) {
    return prisma.aiAgentTask.findFirstOrThrow({
      include: { steps: { orderBy: { sequence: "asc" } } },
      where: { id: taskId, ownerUserId, workspaceId }
    }).catch(() => {
      throw new AiDomainError("agent_task_not_found", "Agent task not found", 404);
    });
  }

  private requireExactArguments(value: unknown, keys: string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AiDomainError("invalid_tool_arguments", "Tool arguments must be an object", 422);
    }
    const record = value as Record<string, unknown>;
    const expected = new Set(keys);
    if (Object.keys(record).some((key) => !expected.has(key)) || keys.some((key) => !(key in record))) {
      throw new AiDomainError("invalid_tool_arguments", "Tool arguments do not match the schema", 422);
    }
    return record;
  }

  private requireIdentifier(value: unknown, field: string) {
    if (typeof value !== "string" || value.length === 0 || value.length > 160 || !isDatabaseSafeText(value)) {
      throw new AiDomainError("invalid_tool_arguments", `${field} is invalid`, 422);
    }
    return value;
  }

  private readObservations(value: Prisma.JsonValue | null): StoredObservations {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as unknown as StoredObservations;
  }

  private isBlockingError(error: AiDomainError) {
    return [
      "agent_context_limit",
      "agent_document_not_observed",
      "agent_run_limit",
      "agent_timeout",
      "agent_tool_limit",
      "agent_write_limit",
      "document_version_conflict",
      "draft_action_conflict",
      "workspace_access_denied"
    ].includes(error.code);
  }

  private toTaskPayload(task: Awaited<ReturnType<AiAgentTaskService["requireTask"]>>) {
    return {
      activeDocumentId: task.activeDocumentId,
      clientRequestId: task.clientRequestId,
      completedAt: task.completedAt?.toISOString() ?? null,
      confirmedAt: task.confirmedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      errorCode: task.errorCode,
      id: task.id,
      plan: task.plan,
      prompt: task.prompt,
      runCount: task.runCount,
      status: task.status,
      steps: task.steps.map((step) => ({
        action: step.action,
        createdAt: step.createdAt.toISOString(),
        documentId: step.documentId,
        errorCode: step.errorCode,
        id: step.id,
        input: step.input,
        label: step.label,
        output: step.output,
        runId: step.runId,
        sequence: step.sequence,
        status: step.status,
        updatedAt: step.updatedAt.toISOString()
      })),
      stoppedAt: task.stoppedAt?.toISOString() ?? null,
      summary: task.summary,
      toolCallCount: task.toolCallCount,
      updatedAt: task.updatedAt.toISOString(),
      workspaceId: task.workspaceId,
      writeBytes: task.writeBytes
    };
  }
}

export const aiAgentTaskService = new AiAgentTaskService();
