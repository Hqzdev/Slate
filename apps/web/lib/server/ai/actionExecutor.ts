import { materializeAiDraftAction, parseAiDraftActionPayload, summarizeAiDraftActionPayload, type AiCreateDraftActionType, type AiDraftActionType, type UpdateDocumentDraftActionPayload } from "../../ai/draftAction";
import { Prisma, type AiDraftActionStatus, type AiDraftActionType as PrismaAiDraftActionType } from "@prisma/client";
import { activityRepository } from "../activityRepository";
import { auditLogService } from "../auditLog";
import { prisma } from "../prisma";
import { workspaceAccessPolicy } from "../workspaceAccessPolicy";
import { isAiReadableDocumentName, isAiReadableFileNode } from "./documentAccessPolicy";
import { hashDocumentContent } from "./documentUpdateDraft";
import { AiDomainError } from "./errors";
import { realtimeDocumentUpdateClient, type RealtimeDocumentUpdateClient } from "./realtimeDocumentUpdateClient";
import { realtimeDocumentSeedFactory, type RealtimeDocumentSeedFactory } from "./realtimeDocumentSeed";

type ActionRecord = {
  appliedAt: Date | null;
  conversationId: string;
  discardedAt: Date | null;
  errorCode: string | null;
  expiresAt: Date;
  id: string;
  payload: Prisma.JsonValue;
  resultDocumentId: string | null;
  status: AiDraftActionStatus;
  type: PrismaAiDraftActionType;
};

const maximumApplyPayloadBytes = 1_048_576;

type AiActionTransactionRunner = {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    }
  ): Promise<T>;
};

export type AiActionExecutorDependencies = {
  accessPolicy: Pick<typeof workspaceAccessPolicy, "requireWorkspaceReader" | "requireWorkspaceWriter">;
  activityRecorder: Pick<typeof activityRepository, "recordWithClient">;
  auditRecorder: Pick<typeof auditLogService, "recordWithClient">;
  realtimeUpdater: Pick<RealtimeDocumentUpdateClient, "applyTextReplacement">;
  transactionRunner: AiActionTransactionRunner;
};

const defaultDependencies: AiActionExecutorDependencies = {
  accessPolicy: workspaceAccessPolicy,
  activityRecorder: activityRepository,
  auditRecorder: auditLogService,
  realtimeUpdater: realtimeDocumentUpdateClient,
  transactionRunner: prisma
};

export class AiActionExecutor {
  constructor(
    private readonly dependencies: AiActionExecutorDependencies = defaultDependencies,
    private readonly realtimeSeedFactory: Pick<RealtimeDocumentSeedFactory, "create"> = realtimeDocumentSeedFactory
  ) {}

  async apply(ownerUserId: string, workspaceId: string, actionIds: string[]) {
    await this.dependencies.accessPolicy.requireWorkspaceWriter(ownerUserId, workspaceId);
    const actionTypes = await this.dependencies.transactionRunner.$transaction(async (transaction) => transaction.aiDraftAction.findMany({
      select: { id: true, type: true },
      where: { id: { in: actionIds }, ownerUserId, workspaceId }
    }));
    if (actionTypes.length !== actionIds.length) {
      throw new AiDomainError("draft_action_not_found", "One or more draft actions were not found", 404);
    }
    if (actionTypes.some((action) => action.type === "update_document")) {
      if (actionIds.length !== 1 || actionTypes.some((action) => action.type !== "update_document")) {
        throw new AiDomainError("draft_update_batch_unsupported", "Document updates must be applied individually", 422);
      }
      try {
        return await this.applyDocumentUpdate(ownerUserId, workspaceId, actionIds[0]);
      } catch (error) {
        if (error instanceof AiDomainError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
          throw new AiDomainError("draft_action_conflict", "The document update conflicted with another workspace change", 409, true);
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
          throw new AiDomainError("draft_action_timeout", "Applying the document update timed out", 503, true);
        }
        throw error;
      }
    }
    try {
      return await this.dependencies.transactionRunner.$transaction(async (transaction) => {
        await this.requireWorkspaceRole(transaction, ownerUserId, workspaceId, ["owner", "editor"]);
        const actions = await transaction.aiDraftAction.findMany({
          orderBy: { createdAt: "asc" },
          where: { id: { in: actionIds }, ownerUserId, workspaceId }
        });
        if (actions.length !== actionIds.length) {
          throw new AiDomainError("draft_action_not_found", "One or more draft actions were not found", 404);
        }
        const actionsById = new Map(actions.map((action) => [action.id, action]));
        const orderedActions = actionIds.map((actionId) => actionsById.get(actionId)!);
        if (orderedActions.every((action) => action.status === "applied" && action.resultDocumentId)) {
          return this.appliedResult(transaction, orderedActions);
        }
        if (orderedActions.some((action) => action.status !== "pending")) {
          throw new AiDomainError("draft_action_conflict", "A draft action is no longer pending", 409);
        }
        const now = new Date();
        if (orderedActions.some((action) => action.expiresAt <= now)) {
          throw new AiDomainError("draft_action_expired", "A draft action has expired", 409);
        }

        const materializedActions = orderedActions.map((action) => {
          try {
            const type = action.type as AiCreateDraftActionType;
            const payload = parseAiDraftActionPayload(type, action.payload);
            return { action, materialized: materializeAiDraftAction(type, payload) };
          } catch {
            throw new AiDomainError("draft_action_invalid", "A draft action payload is invalid", 422);
          }
        });
        const serializedPayloads = JSON.stringify(orderedActions.map((action) => action.payload));
        if (Buffer.byteLength(serializedPayloads, "utf8") > maximumApplyPayloadBytes) {
          throw new AiDomainError("draft_action_payload_too_large", "Draft actions are too large to apply together. Apply fewer actions.", 413);
        }
        const resolvedMaterializedActions = await this.resolveTargetParents(transaction, workspaceId, materializedActions);
        await this.validateTargets(transaction, workspaceId, resolvedMaterializedActions.map(({ materialized }) => ({ parentId: materialized.parentId, title: materialized.title })));
        const claimed = await transaction.aiDraftAction.updateMany({
          data: { status: "applying" },
          where: {
            expiresAt: { gt: now },
            id: { in: actionIds },
            ownerUserId,
            status: "pending",
            workspaceId
          }
        });
        if (claimed.count !== actionIds.length) {
          throw new AiDomainError("draft_action_conflict", "A draft action changed while it was being applied", 409);
        }

        const documentPositions = await transaction.document.aggregate({
          _max: { position: true },
          where: { archivedAt: null, workspaceId }
        });
        let documentPosition = (documentPositions._max.position ?? -1) + 1;
        const nextFilePositions = new Map<string, number>();
        const results = [];

        for (const { action, materialized } of resolvedMaterializedActions) {
          const parentKey = materialized.parentId ?? "root";
          let filePosition = nextFilePositions.get(parentKey);
          if (filePosition === undefined) {
            const filePositions = await transaction.workspaceFileNode.aggregate({
              _max: { position: true },
              where: { archivedAt: null, parentId: materialized.parentId, workspaceId }
            });
            filePosition = (filePositions._max.position ?? -1) + 1;
          }
          nextFilePositions.set(parentKey, filePosition + 1);

          const document = await transaction.document.create({
            data: {
              canvasState: materialized.canvasState === null ? Prisma.JsonNull : materialized.canvasState as Prisma.InputJsonValue,
              content: materialized.content,
              language: materialized.language,
              position: documentPosition,
              title: materialized.title,
              type: materialized.type,
              workspaceId
            }
          });
          documentPosition += 1;
          const realtimeSeed = this.realtimeSeedFactory.create({
            canvasState: document.canvasState,
            content: document.content,
            documentId: document.id,
            documentType: document.type,
            workspaceId
          });
          await transaction.documentRealtime.create({
            data: {
              documentId: document.id,
              roomName: realtimeSeed.roomName,
              state: realtimeSeed.state
            }
          });
          const fileNode = await transaction.workspaceFileNode.create({
            data: {
              documentId: document.id,
              kind: "document",
              name: materialized.title,
              parentId: materialized.parentId,
              position: filePosition,
              workspaceId
            }
          });
          await transaction.documentSnapshot.create({
            data: {
              canvasState: document.canvasState ?? Prisma.JsonNull,
              content: document.content,
              documentId: document.id,
              label: "AI draft applied"
            }
          });
          const metadata = {
            actionId: action.id,
            actionType: action.type,
            conversationId: action.conversationId,
            title: document.title
          };
          await this.dependencies.activityRecorder.recordWithClient(transaction, {
            actorUserId: ownerUserId,
            documentId: document.id,
            metadata,
            type: "ai.action.applied",
            workspaceId
          });
          await this.dependencies.auditRecorder.recordWithClient(transaction, {
            actorUserId: ownerUserId,
            documentId: document.id,
            metadata,
            type: "ai.action.applied",
            workspaceId
          });
          const updatedAction = await transaction.aiDraftAction.update({
            data: {
              appliedAt: now,
              errorCode: null,
              resultDocumentId: document.id,
              status: "applied"
            },
            where: { id: action.id }
          });
          results.push({ action: updatedAction, document, fileNode });
        }

        return this.toApplyPayload(results);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000
      });
    } catch (error) {
      if (error instanceof AiDomainError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new AiDomainError("draft_action_conflict", "Draft actions conflicted with another workspace change", 409, true);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AiDomainError("draft_name_conflict", "A draft target name is no longer available", 409, true);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
        throw new AiDomainError("draft_action_timeout", "Applying draft actions timed out", 503, true);
      }
      throw error;
    }
  }

  private async applyDocumentUpdate(ownerUserId: string, workspaceId: string, actionId: string) {
    const claimed = await this.dependencies.transactionRunner.$transaction(async (transaction) => {
      await this.requireWorkspaceRole(transaction, ownerUserId, workspaceId, ["owner", "editor"]);
      const action = await transaction.aiDraftAction.findFirst({
        where: { id: actionId, ownerUserId, workspaceId }
      });
      if (!action) throw new AiDomainError("draft_action_not_found", "Draft action not found", 404);
      if (action.type !== "update_document") {
        throw new AiDomainError("draft_action_invalid", "Draft action is not a document update", 422);
      }
      if (action.status === "applied" && action.resultDocumentId) {
        return { result: await this.appliedResult(transaction, [action], false), state: "applied" as const };
      }
      if (action.status !== "pending" && action.status !== "applying") {
        throw new AiDomainError("draft_action_conflict", "Draft action is no longer applicable", 409);
      }
      if (action.status === "pending" && action.expiresAt <= new Date()) {
        throw new AiDomainError("draft_action_expired", "Draft action has expired", 409);
      }
      let payload: UpdateDocumentDraftActionPayload;
      try {
        payload = parseAiDraftActionPayload("update_document", action.payload);
      } catch {
        throw new AiDomainError("draft_action_invalid", "Draft action payload is invalid", 422);
      }
      if (hashDocumentContent(payload.content) !== payload.resultContentHash) {
        throw new AiDomainError("draft_action_invalid", "Draft action content hash is invalid", 422);
      }
      const document = await transaction.document.findFirst({
        where: {
          archivedAt: null,
          id: payload.documentId,
          workspaceId
        }
      });
      if (!document || document.type !== payload.documentType) {
        throw new AiDomainError("draft_document_not_found", "The draft document is no longer available", 409);
      }
      if (action.status === "pending") {
        await this.requireReadableUpdateTarget(transaction, workspaceId, document.id, document.title);
        const changed = await transaction.aiDraftAction.updateMany({
          data: { errorCode: null, status: "applying" },
          where: { id: actionId, ownerUserId, status: "pending", workspaceId }
        });
        if (changed.count !== 1) {
          throw new AiDomainError("draft_action_conflict", "Draft action changed while it was being applied", 409);
        }
      }
      return {
        action,
        payload,
        roomName: this.roomName(workspaceId, document.id, payload.documentType),
        state: "execute" as const
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000
    });
    if (claimed.state === "applied") return claimed.result;

    try {
      await this.dependencies.realtimeUpdater.applyTextReplacement({
        actionId,
        content: claimed.payload.content,
        documentId: claimed.payload.documentId,
        documentType: claimed.payload.documentType,
        expectedContentHash: claimed.payload.expectedContentHash,
        roomName: claimed.roomName,
        workspaceId
      });
    } catch (error) {
      if (error instanceof AiDomainError && !error.retryable) {
        await this.dependencies.transactionRunner.$transaction((transaction) => transaction.aiDraftAction.updateMany({
          data: { errorCode: error.code, status: "failed" },
          where: { id: actionId, ownerUserId, status: "applying", workspaceId }
        })).catch(() => null);
      }
      throw error;
    }

    return this.dependencies.transactionRunner.$transaction(async (transaction) => {
      const action = await transaction.aiDraftAction.findFirst({
        where: { id: actionId, ownerUserId, workspaceId }
      });
      if (!action) throw new AiDomainError("draft_action_not_found", "Draft action not found", 404);
      if (action.status === "applied" && action.resultDocumentId) {
        return this.appliedResult(transaction, [action], false);
      }
      if (action.status !== "applying") {
        throw new AiDomainError("draft_action_conflict", "Draft action is no longer being applied", 409);
      }
      const payload = parseAiDraftActionPayload("update_document", action.payload);
      const existingDocument = await transaction.document.findFirst({
        where: { archivedAt: null, id: payload.documentId, workspaceId }
      });
      if (!existingDocument || existingDocument.type !== payload.documentType) {
        throw new AiDomainError("draft_document_not_found", "The updated document is no longer available", 409);
      }
      const fileNode = await transaction.workspaceFileNode.findFirst({
        where: { archivedAt: null, documentId: payload.documentId, workspaceId }
      });
      if (!fileNode) {
        throw new AiDomainError("draft_document_not_found", "The updated document file is no longer available", 409);
      }
      const document = existingDocument;
      await transaction.documentSnapshot.create({
        data: {
          canvasState: document.canvasState ?? Prisma.JsonNull,
          content: payload.content,
          documentId: document.id,
          label: "AI draft applied"
        }
      });
      const metadata = {
        actionId,
        actionType: action.type,
        conversationId: action.conversationId,
        expectedContentHash: payload.expectedContentHash,
        expectedUpdatedAt: payload.expectedUpdatedAt,
        operation: "update",
        resultContentHash: payload.resultContentHash,
        title: document.title
      };
      await this.dependencies.activityRecorder.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        documentId: document.id,
        metadata,
        type: "ai.action.applied",
        workspaceId
      });
      await this.dependencies.auditRecorder.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        documentId: document.id,
        metadata,
        type: "ai.action.applied",
        workspaceId
      });
      const updatedAction = await transaction.aiDraftAction.update({
        data: {
          appliedAt: new Date(),
          errorCode: null,
          resultDocumentId: document.id,
          status: "applied"
        },
        where: { id: action.id }
      });
      return this.toApplyPayload([{ action: updatedAction, document, fileNode }], false);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000
    });
  }

  async discard(ownerUserId: string, workspaceId: string, actionId: string) {
    await this.dependencies.accessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    return this.dependencies.transactionRunner.$transaction(async (transaction) => {
      await this.requireWorkspaceRole(transaction, ownerUserId, workspaceId, ["owner", "editor", "viewer"]);
      const action = await transaction.aiDraftAction.findFirst({
        where: { id: actionId, ownerUserId, workspaceId }
      });
      if (!action) throw new AiDomainError("draft_action_not_found", "Draft action not found", 404);
      if (action.status === "discarded") return { action: this.toActionPayload(action) };
      if (action.status !== "pending") {
        throw new AiDomainError("draft_action_conflict", "Draft action is no longer pending", 409);
      }
      const discardedAt = new Date();
      const changed = await transaction.aiDraftAction.updateMany({
        data: { discardedAt, status: "discarded" },
        where: { id: actionId, ownerUserId, status: "pending", workspaceId }
      });
      if (changed.count !== 1) {
        throw new AiDomainError("draft_action_conflict", "Draft action changed while it was being discarded", 409);
      }
      const updatedAction = await transaction.aiDraftAction.findUniqueOrThrow({ where: { id: actionId } });
      await this.dependencies.activityRecorder.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { actionId, actionType: action.type, conversationId: action.conversationId },
        type: "ai.action.discarded",
        workspaceId
      });
      await this.dependencies.auditRecorder.recordWithClient(transaction, {
        actorUserId: ownerUserId,
        metadata: { actionId, actionType: action.type, conversationId: action.conversationId },
        type: "ai.action.discarded",
        workspaceId
      });
      return { action: this.toActionPayload(updatedAction) };
    });
  }

  private async requireReadableUpdateTarget(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    documentId: string,
    documentTitle: string
  ) {
    const fileNodes = await transaction.workspaceFileNode.findMany({
      orderBy: [{ parentId: "asc" }, { position: "asc" }, { id: "asc" }],
      select: { documentId: true, id: true, name: true, parentId: true },
      take: 5_001,
      where: { archivedAt: null, workspaceId }
    });
    if (fileNodes.length > 5_000) {
      throw new AiDomainError("document_restricted", "The document cannot be safely resolved for an AI update", 422);
    }
    const nodesById = new Map(fileNodes.map((fileNode) => [fileNode.id, fileNode]));
    const fileNode = fileNodes.find((candidate) => candidate.documentId === documentId);
    if (!fileNode || !isAiReadableDocumentName(documentTitle) || !isAiReadableFileNode(fileNode, nodesById)) {
      throw new AiDomainError("document_restricted", "This document is excluded from AI updates", 422);
    }
  }

  private roomName(workspaceId: string, documentId: string, documentType: "code" | "note") {
    const roomType = documentType === "code" ? "file" : "note";
    return `slate:room:${workspaceId}:${roomType}:${documentId}`;
  }

  private async validateTargets(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    targets: { parentId: string | null; title: string }[]
  ) {
    const duplicateTargets = targets.some((target, index) => targets.slice(0, index).some((candidate) => candidate.parentId === target.parentId && candidate.title === target.title));
    if (duplicateTargets) {
      throw new AiDomainError("draft_name_conflict", "Draft actions contain duplicate file names", 409);
    }
    for (const target of targets) {
      const existing = await transaction.workspaceFileNode.findFirst({
        select: { id: true },
        where: { archivedAt: null, name: target.title, parentId: target.parentId, workspaceId }
      });
      if (existing) {
        throw new AiDomainError("draft_name_conflict", `A file named ${target.title} already exists in the target folder`, 409);
      }
    }
  }

  private async resolveTargetParents(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    actions: { action: ActionRecord; materialized: ReturnType<typeof materializeAiDraftAction> }[]
  ) {
    const parentIds = Array.from(new Set(actions.flatMap(({ materialized }) => materialized.parentId ? [materialized.parentId] : [])));
    if (parentIds.length === 0) return actions;
    const folders = await transaction.workspaceFileNode.findMany({
      select: { id: true },
      where: { archivedAt: null, id: { in: parentIds }, kind: "folder", workspaceId }
    });
    const existingFolderIds = new Set(folders.map((folder) => folder.id));
    return actions.map(({ action, materialized }) => ({
      action,
      materialized: {
        ...materialized,
        parentId: materialized.parentId && existingFolderIds.has(materialized.parentId) ? materialized.parentId : null
      }
    }));
  }

  private async requireWorkspaceRole(
    transaction: Prisma.TransactionClient,
    ownerUserId: string,
    workspaceId: string,
    roles: ("owner" | "editor" | "viewer")[]
  ) {
    const member = await transaction.workspaceMember.findUnique({
      select: { role: true },
      where: { userId_workspaceId: { userId: ownerUserId, workspaceId } }
    });
    if (!member || !roles.includes(member.role)) {
      throw new AiDomainError("workspace_access_denied", "Workspace access denied", 403);
    }
  }

  private async appliedResult(transaction: Prisma.TransactionClient, actions: ActionRecord[], openDocument = true) {
    const documentIds = actions.flatMap((action) => action.resultDocumentId ? [action.resultDocumentId] : []);
    const [documents, fileNodes] = await Promise.all([
      transaction.document.findMany({ where: { archivedAt: null, id: { in: documentIds } } }),
      transaction.workspaceFileNode.findMany({ where: { archivedAt: null, documentId: { in: documentIds } } })
    ]);
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const fileNodesByDocumentId = new Map(fileNodes.flatMap((fileNode) => fileNode.documentId ? [[fileNode.documentId, fileNode] as const] : []));
    const results = actions.map((action) => {
      const document = documentsById.get(action.resultDocumentId!);
      const fileNode = fileNodesByDocumentId.get(action.resultDocumentId!);
      if (!document || !fileNode) throw new AiDomainError("applied_document_missing", "Applied document is no longer available", 409);
      return { action, document, fileNode };
    });
    return this.toApplyPayload(results, openDocument);
  }

  private toApplyPayload(results: Parameters<AiActionExecutor["toAppliedActionPayload"]>[0][], openDocument = true) {
    const payloads = results.map((result) => this.toAppliedActionPayload(result));
    return {
      actions: payloads.map((payload) => payload.action),
      documents: payloads.map((payload) => payload.document),
      fileNodes: payloads.map((payload) => payload.fileNode),
      openDocumentId: openDocument ? payloads[0]?.document.id ?? null : null
    };
  }

  private toAppliedActionPayload(result: {
    action: ActionRecord;
    document: {
      canvasState: Prisma.JsonValue;
      content: string;
      id: string;
      language: string | null;
      position: number;
      title: string;
      type: "canvas" | "code" | "note";
      updatedAt: Date;
    };
    fileNode: {
      documentId: string | null;
      id: string;
      kind: "document" | "folder";
      name: string;
      parentId: string | null;
      position: number;
    };
  }) {
    return {
      action: this.toActionPayload(result.action),
      document: {
        canvasState: result.document.canvasState,
        content: result.document.content,
        id: result.document.id,
        language: result.document.language,
        position: result.document.position,
        title: result.document.title,
        type: result.document.type,
        updatedAt: result.document.updatedAt.toISOString()
      },
      fileNode: {
        documentId: result.fileNode.documentId,
        id: result.fileNode.id,
        kind: result.fileNode.kind,
        name: result.fileNode.name,
        parentId: result.fileNode.parentId,
        position: result.fileNode.position
      }
    };
  }

  private toActionPayload(action: ActionRecord) {
    return {
      appliedAt: action.appliedAt?.toISOString() ?? null,
      discardedAt: action.discardedAt?.toISOString() ?? null,
      errorCode: action.errorCode,
      expiresAt: action.expiresAt.toISOString(),
      id: action.id,
      payload: summarizeAiDraftActionPayload(action.type as AiDraftActionType, action.payload),
      resultDocumentId: action.resultDocumentId,
      status: action.status,
      type: action.type
    };
  }
}

export const aiActionExecutor = new AiActionExecutor();
