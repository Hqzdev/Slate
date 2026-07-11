import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, type AiDraftActionStatus, type AiDraftActionType, type AiMessageMode, type AiMessageRole, type AiMessageStatus } from "@prisma/client";
import { summarizeAiDraftActionPayload, type AiDraftActionType as DomainAiDraftActionType } from "../../ai/draftAction";
import { activityRepository } from "../activityRepository";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { AiDomainError } from "./errors";
import type { AiDraftProposal, AiProviderMessage } from "./types";

const conversationPageSize = 30;
const providerHistorySize = 20;
const providerHistoryCharacterBudget = 48_000;
const draftLifetimeMs = 24 * 60 * 60 * 1_000;
const turnLeaseDurationMs = 90_000;

type ActionRow = {
  appliedAt: Date | null;
  createdAt: Date;
  discardedAt: Date | null;
  errorCode: string | null;
  expiresAt: Date;
  id: string;
  payload: Prisma.JsonValue;
  resultDocumentId: string | null;
  status: AiDraftActionStatus;
  type: AiDraftActionType;
};

type MessageRow = {
  activeDocumentId: string | null;
  clientRequestId: string | null;
  content: string;
  createdAt: Date;
  draftActions: ActionRow[];
  errorCode: string | null;
  id: string;
  inReplyToMessageId: string | null;
  mode: AiMessageMode;
  processingStartedAt: Date | null;
  providerRequestId: string | null;
  role: AiMessageRole;
  status: AiMessageStatus;
};

export type AiMessagePayload = ReturnType<AiConversationRepository["toMessagePayload"]>;

export class AiConversationRepository {
  async createConversation(ownerUserId: string, workspaceId: string) {
    const conversation = await prisma.aiConversation.create({
      data: { ownerUserId, publicId: createConversationPublicId(), workspaceId }
    });
    return this.toConversationPayload(conversation);
  }

  async listConversations(ownerUserId: string, workspaceId: string) {
    const conversations = await prisma.aiConversation.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        _count: { select: { messages: true } },
        archivedAt: true,
        id: true,
        publicId: true,
        title: true,
        updatedAt: true
      },
      where: { archivedAt: null, ownerUserId, workspaceId }
    });
    return conversations.map((conversation) => ({
      archivedAt: conversation.archivedAt?.toISOString() ?? null,
      id: conversation.publicId,
      messageCount: conversation._count.messages,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString()
    }));
  }

  async archiveConversation(ownerUserId: string, workspaceId: string, publicId: string) {
    await prisma.aiConversation.updateMany({
      data: { archivedAt: new Date() },
      where: { archivedAt: null, ownerUserId, publicId, workspaceId }
    });
  }

  async updateConversation(ownerUserId: string, workspaceId: string, publicId: string, title: string) {
    const conversation = await prisma.aiConversation.updateMany({
      data: { title },
      where: { archivedAt: null, ownerUserId, publicId, workspaceId }
    });
    if (conversation.count !== 1) throw new AiDomainError("conversation_not_found", "Conversation was not found", 404);
  }

  async clearConversation(ownerUserId: string, workspaceId: string) {
    await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.aiConversation.findFirst({
        orderBy: { updatedAt: "desc" },
        select: {
          agentTasks: { select: { id: true }, where: { status: { in: ["awaiting_confirmation", "blocked", "running"] } } },
          id: true
        },
        where: { archivedAt: null, ownerUserId, workspaceId }
      });
      if (!conversation) return;
      if (conversation.agentTasks.length > 0) {
        throw new AiDomainError("agent_task_active", "Stop the current agent task before starting a new chat", 409);
      }
      await transaction.aiConversation.delete({ where: { id: conversation.id } });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { conversationId: conversation.id },
        type: "ai.conversation.cleared",
        workspaceId
      });
    });
  }

  async beginTurn(ownerUserId: string, workspaceId: string, content: string, clientRequestId: string, activeDocumentId: string | null, mode: AiMessageMode = "ask", publicId: string | null = null) {
    const conversation = publicId
      ? await prisma.aiConversation.findFirstOrThrow({ where: { archivedAt: null, ownerUserId, publicId, workspaceId } })
      : await prisma.aiConversation.create({ data: { ownerUserId, publicId: createConversationPublicId(), title: createConversationTitle(content), workspaceId } });
    const existing = await prisma.aiMessage.findUnique({
      include: {
        response: { include: { draftActions: { orderBy: { createdAt: "asc" } } } }
      },
      where: {
        conversationId_clientRequestId: {
          clientRequestId,
          conversationId: conversation.id
        }
      }
    });
    if (existing) {
      this.requireMatchingRequest(existing, content, activeDocumentId, mode);
      const staleBefore = new Date(Date.now() - turnLeaseDurationMs);
      const stalePending = existing.status === "pending"
        && (!existing.processingStartedAt || existing.processingStartedAt <= staleBefore);
      if (existing.status === "failed" || stalePending) {
        const processingLeaseId = randomUUID();
        const auditType = existing.status === "failed" ? "ai.request.retried" : "ai.request.reclaimed";
        const retried = await prisma.$transaction(async (transaction) => {
          const claimed = await transaction.aiMessage.updateMany({
            data: {
              errorCode: null,
              processingLeaseId,
              processingStartedAt: new Date(),
              status: "pending"
            },
            where: {
              id: existing.id,
              OR: [
                { status: "failed" },
                {
                  OR: [
                    { processingStartedAt: null },
                    { processingStartedAt: { lte: staleBefore } }
                  ],
                  status: "pending"
                }
              ]
            }
          });
          if (claimed.count !== 1) return null;
          if (existing.response) await transaction.aiMessage.delete({ where: { id: existing.response.id } });
          await auditLogService.recordWithClient(transaction, {
            actorUserId: ownerUserId,
            metadata: { clientRequestId, conversationId: conversation.id, messageId: existing.id },
            type: auditType,
            workspaceId
          });
          return transaction.aiMessage.findUniqueOrThrow({
            include: { draftActions: true },
            where: { id: existing.id }
          });
        });
        if (retried) {
          return {
            conversationId: conversation.id,
            created: true,
            processingLeaseId,
            request: this.toMessagePayload(retried),
            response: null
          };
        }
        const current = await prisma.aiMessage.findUniqueOrThrow({
          include: {
            draftActions: true,
            response: { include: { draftActions: { orderBy: { createdAt: "asc" } } } }
          },
          where: { id: existing.id }
        });
        return {
          conversationId: conversation.id,
          created: false,
          processingLeaseId: null,
          request: this.toMessagePayload(current),
          response: current.response ? this.toMessagePayload(current.response) : null
        };
      }
      const request = await this.getMessage(existing.id);
      return {
        conversationId: conversation.id,
        created: false,
        processingLeaseId: null,
        request: this.toMessagePayload(request),
        response: existing.response ? this.toMessagePayload(existing.response) : null
      };
    }

    try {
      const processingLeaseId = randomUUID();
      const request = await prisma.$transaction(async (transaction) => {
        if (conversation.title === "Workspace chat") {
          await transaction.aiConversation.update({
            data: { title: createConversationTitle(content) },
            where: { id: conversation.id }
          });
        }
        const createdMessage = await transaction.aiMessage.create({
          data: {
            activeDocumentId,
            clientRequestId,
            content,
            conversationId: conversation.id,
            mode,
            processingLeaseId,
            processingStartedAt: new Date(),
            role: "user",
            status: "pending"
          },
          include: { draftActions: true }
        });
        await auditLogService.recordWithClient(transaction, {
          actorUserId: ownerUserId,
          metadata: { clientRequestId, conversationId: conversation.id, messageId: createdMessage.id },
          type: "ai.request.created",
          workspaceId
        });
        return createdMessage;
      });
      return {
        conversationId: conversation.id,
        created: true,
        processingLeaseId,
        request: this.toMessagePayload(request),
        response: null
      };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const duplicate = await prisma.aiMessage.findUniqueOrThrow({
        include: {
          draftActions: true,
          response: { include: { draftActions: { orderBy: { createdAt: "asc" } } } }
        },
        where: { conversationId_clientRequestId: { clientRequestId, conversationId: conversation.id } }
      });
      this.requireMatchingRequest(duplicate, content, activeDocumentId, mode);
      return {
        conversationId: conversation.id,
        created: false,
        processingLeaseId: null,
        request: this.toMessagePayload(duplicate),
        response: duplicate.response ? this.toMessagePayload(duplicate.response) : null
      };
    }
  }

  async completeTurn(input: {
    conversationId: string;
    content: string;
    drafts: AiDraftProposal[];
    mode: AiMessageMode;
    ownerUserId: string;
    processingLeaseId: string;
    providerRequestId: string | null;
    requestMessageId: string;
    workspaceId: string;
  }) {
    const expiresAt = new Date(Date.now() + draftLifetimeMs);
    return prisma.$transaction(async (transaction) => {
      const claimed = await transaction.aiMessage.updateMany({
        data: { processingLeaseId: null, processingStartedAt: null, status: "completed" },
        where: { id: input.requestMessageId, processingLeaseId: input.processingLeaseId, status: "pending" }
      });
      if (claimed.count !== 1) {
        const existing = await transaction.aiMessage.findUnique({
          include: { response: { include: { draftActions: { orderBy: { createdAt: "asc" } } } } },
          where: { id: input.requestMessageId }
        });
        if (existing?.status === "completed" && existing.response) return this.toMessagePayload(existing.response);
        throw new AiDomainError("ai_turn_conflict", "AI request is no longer pending", 409);
      }

      const response = await transaction.aiMessage.create({
        data: {
          content: input.content,
          conversationId: input.conversationId,
          draftActions: {
            create: input.drafts.map((draft) => ({
              conversationId: input.conversationId,
              expiresAt,
              ownerUserId: input.ownerUserId,
              payload: draft.payload as Prisma.InputJsonValue,
              type: draft.type,
              workspaceId: input.workspaceId
            }))
          },
          inReplyToMessageId: input.requestMessageId,
          mode: input.mode,
          providerRequestId: input.providerRequestId,
          role: "assistant",
          status: "completed"
        },
        include: { draftActions: { orderBy: { createdAt: "asc" } } }
      });
      await transaction.aiConversation.update({
        data: { updatedAt: new Date() },
        where: { id: input.conversationId }
      });

      if (input.drafts.length > 0) {
        const metadata = {
          actionCount: input.drafts.length,
          actionTypes: input.drafts.map((draft) => draft.type),
          conversationId: input.conversationId,
          messageId: response.id
        };
        await activityRepository.recordWithClient(transaction, {
          actorUserId: input.ownerUserId,
          metadata,
          type: "ai.draft.created",
          workspaceId: input.workspaceId
        });
        await auditLogService.recordWithClient(transaction, {
          actorUserId: input.ownerUserId,
          metadata,
          type: "ai.draft.created",
          workspaceId: input.workspaceId
        });
      }

      return this.toMessagePayload(response);
    });
  }

  async failTurn(input: {
    conversationId: string;
    errorCode: string;
    message: string;
    ownerUserId: string;
    processingLeaseId: string;
    requestMessageId: string;
    workspaceId: string;
  }) {
    return prisma.$transaction(async (transaction) => {
      const claimed = await transaction.aiMessage.updateMany({
        data: {
          errorCode: input.errorCode,
          processingLeaseId: null,
          processingStartedAt: null,
          status: "failed"
        },
        where: { id: input.requestMessageId, processingLeaseId: input.processingLeaseId, status: "pending" }
      });
      if (claimed.count !== 1) return null;
      const response = await transaction.aiMessage.create({
        data: {
          content: input.message,
          conversationId: input.conversationId,
          errorCode: input.errorCode,
          inReplyToMessageId: input.requestMessageId,
          role: "assistant",
          status: "failed"
        }
      });
      await transaction.aiConversation.update({ data: { updatedAt: new Date() }, where: { id: input.conversationId } });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: input.ownerUserId,
        metadata: { conversationId: input.conversationId, errorCode: input.errorCode, messageId: response.id },
        type: "ai.request.failed",
        workspaceId: input.workspaceId
      });
      return response;
    });
  }

  async listProviderHistory(conversationId: string, excludedMessageId: string): Promise<AiProviderMessage[]> {
    const responses = await prisma.aiMessage.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        content: true,
        inReplyTo: { select: { content: true, id: true, role: true, status: true } },
        role: true
      },
      take: Math.floor(providerHistorySize / 2),
      where: {
        conversationId,
        inReplyToMessageId: { not: null },
        role: "assistant",
        status: "completed"
      }
    });
    const selectedTurns: AiProviderMessage[][] = [];
    let selectedCharacters = 0;
    for (const response of responses) {
      if (!response.inReplyTo || response.inReplyTo.id === excludedMessageId || response.inReplyTo.status !== "completed") continue;
      const turn: AiProviderMessage[] = [
        { content: response.inReplyTo.content, role: response.inReplyTo.role },
        { content: response.content, role: response.role }
      ];
      const turnCharacters = turn.reduce((total, message) => total + message.content.length, 0);
      if (selectedTurns.length > 0 && selectedCharacters + turnCharacters > providerHistoryCharacterBudget) break;
      selectedCharacters += turnCharacters;
      selectedTurns.push(turn);
    }
    return selectedTurns.reverse().flat();
  }

  async getConversation(ownerUserId: string, workspaceId: string, cursor: string | null, publicId: string | null = null) {
    const conversation = publicId
      ? await prisma.aiConversation.findFirst({ where: { archivedAt: null, ownerUserId, publicId, workspaceId } })
      : await prisma.aiConversation.findFirst({ orderBy: { updatedAt: "desc" }, where: { archivedAt: null, ownerUserId, workspaceId } });
    if (!conversation) {
      return { conversation: null, messages: [], nextCursor: null };
    }
    if (cursor) {
      const cursorExists = await prisma.aiMessage.count({ where: { conversationId: conversation.id, id: cursor } });
      if (cursorExists === 0) throw new AiDomainError("invalid_cursor", "Conversation cursor is invalid", 400);
    }
    const rows = await prisma.aiMessage.findMany({
      cursor: cursor ? { id: cursor } : undefined,
      include: { draftActions: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: cursor ? 1 : 0,
      take: conversationPageSize + 1,
      where: { conversationId: conversation.id }
    });
    const hasMore = rows.length > conversationPageSize;
    const page = rows.slice(0, conversationPageSize);
    const nextCursor = hasMore ? page.at(-1)?.id ?? null : null;
    return {
      conversation: {
        createdAt: conversation.createdAt.toISOString(),
        id: conversation.publicId,
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
        workspaceId: conversation.workspaceId
      },
      messages: page.reverse().map((message) => this.toMessagePayload(message)),
      nextCursor
    };
  }

  private toConversationPayload(conversation: { publicId: string; title: string; updatedAt: Date }) {
    return { id: conversation.publicId, title: conversation.title, updatedAt: conversation.updatedAt.toISOString() };
  }

  toMessagePayload(message: Omit<MessageRow, "draftActions"> & { draftActions?: ActionRow[] }) {
    return {
      activeDocumentId: message.activeDocumentId,
      clientRequestId: message.clientRequestId,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      draftActions: (message.draftActions ?? []).map((action) => ({
        appliedAt: action.appliedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        discardedAt: action.discardedAt?.toISOString() ?? null,
        errorCode: action.errorCode,
        expiresAt: action.expiresAt.toISOString(),
        id: action.id,
        payload: summarizeAiDraftActionPayload(action.type as DomainAiDraftActionType, action.payload),
        resultDocumentId: action.resultDocumentId,
        status: action.status,
        type: action.type
      })),
      errorCode: message.errorCode,
      id: message.id,
      inReplyToMessageId: message.inReplyToMessageId,
      mode: message.mode,
      providerRequestId: message.providerRequestId,
      processingStartedAt: message.processingStartedAt?.toISOString() ?? null,
      role: message.role,
      status: message.status
    };
  }

  private requireMatchingRequest(message: { activeDocumentId: string | null; content: string; mode: AiMessageMode }, content: string, activeDocumentId: string | null, mode: AiMessageMode) {
    if (message.content !== content || message.activeDocumentId !== activeDocumentId || message.mode !== mode) {
      throw new AiDomainError("client_request_conflict", "clientRequestId was already used for a different request", 409);
    }
  }

  private getMessage(messageId: string) {
    return prisma.aiMessage.findUniqueOrThrow({
      include: { draftActions: { orderBy: { createdAt: "asc" } } },
      where: { id: messageId }
    });
  }
}

function createConversationPublicId() {
  const value = randomBytes(5).toString("hex");
  return `sltx-${value.slice(0, 4)}-${value.slice(4, 8)}`;
}

function createConversationTitle(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 44) || "Workspace chat";
}

export const aiConversationRepository = new AiConversationRepository();
