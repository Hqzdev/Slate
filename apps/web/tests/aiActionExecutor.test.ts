import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type AiDraftActionStatus, type AiDraftActionType, type DocumentType, type FileNodeKind, type WorkspaceRole } from "@prisma/client";
import { AiActionExecutor, type AiActionExecutorDependencies } from "../lib/server/ai/actionExecutor";
import { createUpdateDocumentDraft, hashDocumentContent } from "../lib/server/ai/documentUpdateDraft";
import { AiDomainError } from "../lib/server/ai/errors";
import type { RealtimeDocumentUpdateInput } from "../lib/server/ai/realtimeDocumentUpdateClient";

type DraftActionRecord = {
  appliedAt: Date | null;
  conversationId: string;
  createdAt: Date;
  discardedAt: Date | null;
  errorCode: string | null;
  expiresAt: Date;
  id: string;
  ownerUserId: string;
  payload: Prisma.JsonValue;
  resultDocumentId: string | null;
  status: AiDraftActionStatus;
  type: AiDraftActionType;
  workspaceId: string;
};

type DocumentRecord = {
  archivedAt: Date | null;
  canvasState: Prisma.JsonValue;
  content: string;
  id: string;
  language: string | null;
  position: number;
  title: string;
  type: DocumentType;
  updatedAt: Date;
  workspaceId: string;
};

type FileNodeRecord = {
  archivedAt: Date | null;
  documentId: string | null;
  id: string;
  kind: FileNodeKind;
  name: string;
  parentId: string | null;
  position: number;
  workspaceId: string;
};

type SnapshotRecord = {
  canvasState: Prisma.JsonValue;
  content: string;
  documentId: string;
  id: string;
  label: string | null;
};

type ActivityRecord = {
  actorUserId: string | null;
  documentId: string | null;
  metadata: Prisma.JsonValue;
  type: string;
  workspaceId: string;
};

type AuditRecord = {
  actorUserId: string | null;
  documentId: string | null;
  metadata: Prisma.JsonValue;
  targetUserId: string | null;
  type: string;
  workspaceId: string | null;
};

type InMemoryState = {
  actions: DraftActionRecord[];
  activities: ActivityRecord[];
  audits: AuditRecord[];
  documents: DocumentRecord[];
  fileNodes: FileNodeRecord[];
  nextDocumentId: number;
  nextFileNodeId: number;
  nextSnapshotId: number;
  snapshots: SnapshotRecord[];
};

type ActionWhere = {
  expiresAt?: { gt: Date };
  id?: string | { in: string[] };
  ownerUserId?: string;
  status?: AiDraftActionStatus;
  workspaceId?: string;
};

type DocumentWhere = {
  archivedAt?: null;
  id?: string | { in: string[] };
  workspaceId?: string;
};

type FileNodeWhere = {
  archivedAt?: null;
  documentId?: string | { in: string[] };
  id?: { in: string[] };
  kind?: FileNodeKind;
  name?: string;
  parentId?: string | null;
  workspaceId?: string;
};

const ownerUserId = "user-1";
const workspaceId = "workspace-1";

function cloneJson(value: unknown): Prisma.JsonValue {
  if (value === Prisma.JsonNull || value === null || value === undefined) return null;
  return structuredClone(value) as Prisma.JsonValue;
}

class FakeAccessPolicy {
  readerChecks = 0;
  writerChecks = 0;

  constructor(private readonly role: WorkspaceRole) {}

  async requireWorkspaceReader() {
    this.readerChecks += 1;
    return { role: this.role };
  }

  async requireWorkspaceWriter() {
    this.writerChecks += 1;
    if (this.role === "viewer") throw new Error("Workspace access denied");
    return { role: this.role };
  }
}

class InMemoryActionStore {
  transactionCalls = 0;
  writeAttempts = 0;
  private currentState: InMemoryState;

  constructor(seed: Partial<InMemoryState>, private readonly role: WorkspaceRole) {
    this.currentState = structuredClone({
      actions: seed.actions ?? [],
      activities: seed.activities ?? [],
      audits: seed.audits ?? [],
      documents: seed.documents ?? [],
      fileNodes: seed.fileNodes ?? [],
      nextDocumentId: seed.nextDocumentId ?? 1,
      nextFileNodeId: seed.nextFileNodeId ?? 1,
      nextSnapshotId: seed.nextSnapshotId ?? 1,
      snapshots: seed.snapshots ?? []
    });
  }

  get state() {
    return this.currentState;
  }

  async $transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    this.transactionCalls += 1;
    const pendingState = structuredClone(this.currentState);
    const result = await operation(this.createTransaction(pendingState));
    this.currentState = pendingState;
    return result;
  }

  private actionMatches(action: DraftActionRecord, where: ActionWhere) {
    if (typeof where.id === "string" && action.id !== where.id) return false;
    if (where.id && typeof where.id !== "string" && !where.id.in.includes(action.id)) return false;
    if (where.ownerUserId && action.ownerUserId !== where.ownerUserId) return false;
    if (where.status && action.status !== where.status) return false;
    if (where.workspaceId && action.workspaceId !== where.workspaceId) return false;
    if (where.expiresAt && action.expiresAt <= where.expiresAt.gt) return false;
    return true;
  }

  private documentMatches(document: DocumentRecord, where: DocumentWhere) {
    if (where.archivedAt === null && document.archivedAt !== null) return false;
    if (typeof where.id === "string" && document.id !== where.id) return false;
    if (where.id && typeof where.id !== "string" && !where.id.in.includes(document.id)) return false;
    if (where.workspaceId && document.workspaceId !== where.workspaceId) return false;
    return true;
  }

  private fileNodeMatches(fileNode: FileNodeRecord, where: FileNodeWhere) {
    if (where.archivedAt === null && fileNode.archivedAt !== null) return false;
    if (typeof where.documentId === "string" && fileNode.documentId !== where.documentId) return false;
    if (where.documentId && typeof where.documentId !== "string" && (!fileNode.documentId || !where.documentId.in.includes(fileNode.documentId))) return false;
    if (where.id && !where.id.in.includes(fileNode.id)) return false;
    if (where.kind && fileNode.kind !== where.kind) return false;
    if (where.name && fileNode.name !== where.name) return false;
    if ("parentId" in where && fileNode.parentId !== where.parentId) return false;
    if (where.workspaceId && fileNode.workspaceId !== where.workspaceId) return false;
    return true;
  }

  private createTransaction(state: InMemoryState) {
    const transaction = {
      activityEvent: {
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data } = input as { data: ActivityRecord };
          const activity = { ...data, metadata: cloneJson(data.metadata) };
          state.activities.push(activity);
          return activity;
        }
      },
      aiDraftAction: {
        findFirst: async (input: unknown) => {
          const { where } = input as { where: ActionWhere };
          return state.actions.find((action) => this.actionMatches(action, where)) ?? null;
        },
        findMany: async (input: unknown) => {
          const { where } = input as { where: ActionWhere };
          return state.actions
            .filter((action) => this.actionMatches(action, where))
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        },
        findUniqueOrThrow: async (input: unknown) => {
          const { where } = input as { where: { id: string } };
          const action = state.actions.find((candidate) => candidate.id === where.id);
          if (!action) throw new Error("Draft action not found");
          return action;
        },
        update: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data, where } = input as {
            data: Partial<DraftActionRecord>;
            where: { id: string };
          };
          const action = state.actions.find((candidate) => candidate.id === where.id);
          if (!action) throw new Error("Draft action not found");
          Object.assign(action, data);
          return action;
        },
        updateMany: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data, where } = input as {
            data: Partial<DraftActionRecord>;
            where: ActionWhere;
          };
          const actions = state.actions.filter((action) => this.actionMatches(action, where));
          actions.forEach((action) => Object.assign(action, data));
          return { count: actions.length };
        }
      },
      auditEvent: {
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data } = input as { data: AuditRecord };
          const audit = { ...data, metadata: cloneJson(data.metadata) };
          state.audits.push(audit);
          return audit;
        }
      },
      document: {
        aggregate: async (input: unknown) => {
          const { where } = input as { where: DocumentWhere };
          const positions = state.documents.filter((document) => this.documentMatches(document, where)).map((document) => document.position);
          return { _max: { position: positions.length === 0 ? null : Math.max(...positions) } };
        },
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data } = input as {
            data: Omit<DocumentRecord, "archivedAt" | "id" | "updatedAt"> & { canvasState: unknown };
          };
          const sequence = state.nextDocumentId;
          state.nextDocumentId += 1;
          const document: DocumentRecord = {
            ...data,
            archivedAt: null,
            canvasState: cloneJson(data.canvasState),
            id: `document-${sequence}`,
            updatedAt: new Date(Date.UTC(2026, 6, 10, 12, 0, sequence))
          };
          state.documents.push(document);
          return document;
        },
        findFirst: async (input: unknown) => {
          const { where } = input as { where: DocumentWhere };
          return state.documents.find((document) => this.documentMatches(document, where)) ?? null;
        },
        findMany: async (input: unknown) => {
          const { where } = input as { where: DocumentWhere };
          return state.documents.filter((document) => this.documentMatches(document, where));
        },
        update: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data, where } = input as { data: Partial<DocumentRecord>; where: { id: string } };
          const document = state.documents.find((candidate) => candidate.id === where.id);
          if (!document) throw new Error("Document not found");
          Object.assign(document, data, { updatedAt: new Date(document.updatedAt.getTime() + 1_000) });
          return document;
        }
      },
      documentSnapshot: {
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data } = input as { data: Omit<SnapshotRecord, "id"> & { canvasState: unknown } };
          const snapshot: SnapshotRecord = {
            ...data,
            canvasState: cloneJson(data.canvasState),
            id: `snapshot-${state.nextSnapshotId}`
          };
          state.nextSnapshotId += 1;
          state.snapshots.push(snapshot);
          return snapshot;
        }
      },
      documentRealtime: {
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          return (input as { data: unknown }).data;
        }
      },
      workspaceFileNode: {
        aggregate: async (input: unknown) => {
          const { where } = input as { where: FileNodeWhere };
          const positions = state.fileNodes.filter((fileNode) => this.fileNodeMatches(fileNode, where)).map((fileNode) => fileNode.position);
          return { _max: { position: positions.length === 0 ? null : Math.max(...positions) } };
        },
        count: async (input: unknown) => {
          const { where } = input as { where: FileNodeWhere };
          return state.fileNodes.filter((fileNode) => this.fileNodeMatches(fileNode, where)).length;
        },
        create: async (input: unknown) => {
          this.writeAttempts += 1;
          const { data } = input as { data: Omit<FileNodeRecord, "archivedAt" | "id"> };
          const fileNode: FileNodeRecord = {
            ...data,
            archivedAt: null,
            id: `file-node-${state.nextFileNodeId}`
          };
          state.nextFileNodeId += 1;
          state.fileNodes.push(fileNode);
          return fileNode;
        },
        findFirst: async (input: unknown) => {
          const { where } = input as { where: FileNodeWhere };
          return state.fileNodes.find((candidate) => this.fileNodeMatches(candidate, where)) ?? null;
        },
        findMany: async (input: unknown) => {
          const { where } = input as { where: FileNodeWhere };
          return state.fileNodes.filter((fileNode) => this.fileNodeMatches(fileNode, where));
        }
      },
      workspaceMember: {
        findUnique: async () => ({ role: this.role })
      }
    };

    return transaction as unknown as Prisma.TransactionClient;
  }
}

function draftAction(id: string, type: AiDraftActionType, payload: Prisma.JsonValue, createdAtOffset = 0): DraftActionRecord {
  return {
    appliedAt: null,
    conversationId: "conversation-1",
    createdAt: new Date(Date.UTC(2026, 6, 10, 10, 0, createdAtOffset)),
    discardedAt: null,
    errorCode: null,
    expiresAt: new Date(Date.UTC(2030, 0, 1)),
    id,
    ownerUserId,
    payload,
    resultDocumentId: null,
    status: "pending",
    type,
    workspaceId
  };
}

function existingDocument(id: string, title: string, position: number): DocumentRecord {
  return {
    archivedAt: null,
    canvasState: null,
    content: "existing",
    id,
    language: null,
    position,
    title,
    type: "note",
    updatedAt: new Date(Date.UTC(2026, 6, 9)),
    workspaceId
  };
}

function existingFileNode(id: string, name: string, position: number): FileNodeRecord {
  return {
    archivedAt: null,
    documentId: `document-for-${id}`,
    id,
    kind: "document",
    name,
    parentId: null,
    position,
    workspaceId
  };
}

function linkedFileNode(document: DocumentRecord, name = document.title): FileNodeRecord {
  return {
    archivedAt: null,
    documentId: document.id,
    id: `file-${document.id}`,
    kind: "document",
    name,
    parentId: null,
    position: document.position,
    workspaceId: document.workspaceId
  };
}

function updateAction(id: string, document: DocumentRecord, content: string) {
  const payload = createUpdateDocumentDraft({
    complete: true,
    content: document.content,
    id: document.id,
    title: document.title,
    type: document.type,
    updatedAt: document.updatedAt.toISOString()
  }, content);
  return draftAction(id, "update_document", payload);
}

class FakeRealtimeUpdater {
  afterApply: (() => void) | null = null;
  applyBeforeError = false;
  calls: RealtimeDocumentUpdateInput[] = [];
  error: Error | null = null;
  onApply: ((input: RealtimeDocumentUpdateInput) => void) | null = null;

  async applyTextReplacement(input: RealtimeDocumentUpdateInput) {
    this.calls.push(structuredClone(input));
    if (this.error) {
      if (this.applyBeforeError) this.onApply?.(input);
      throw this.error;
    }
    this.onApply?.(input);
    this.afterApply?.();
    return {
      actionId: input.actionId,
      applied: true,
      contentHash: hashDocumentContent(input.content),
      documentId: input.documentId,
      documentType: input.documentType,
      roomName: input.roomName
    };
  }
}

function createFixture(seed: Partial<InMemoryState>, role: WorkspaceRole = "editor", realtimeUpdater = new FakeRealtimeUpdater()) {
  const accessPolicy = new FakeAccessPolicy(role);
  const store = new InMemoryActionStore(seed, role);
  realtimeUpdater.onApply = (input) => {
    const document = store.state.documents.find((candidate) => candidate.id === input.documentId);
    if (!document) return;
    document.content = input.content;
    document.updatedAt = new Date(document.updatedAt.getTime() + 1_000);
  };
  const dependencies: AiActionExecutorDependencies = {
    accessPolicy,
    activityRecorder: {
      async recordWithClient(client, input) {
        return client.activityEvent.create({
          data: {
            actorUserId: input.actorUserId ?? null,
            documentId: input.documentId ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
            type: input.type,
            workspaceId: input.workspaceId
          }
        });
      }
    },
    auditRecorder: {
      async recordWithClient(client, input) {
        return client.auditEvent.create({
          data: {
            actorUserId: input.actorUserId ?? null,
            documentId: input.documentId ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
            targetUserId: input.targetUserId ?? null,
            type: input.type,
            workspaceId: input.workspaceId ?? null
          }
        });
      }
    },
    realtimeUpdater,
    transactionRunner: store
  };
  return {
    accessPolicy,
    executor: new AiActionExecutor(dependencies),
    realtimeUpdater,
    store
  };
}

function assertAiError(error: unknown, code: string, status: number) {
  return error instanceof AiDomainError && error.code === code && error.status === status;
}

test("viewer is denied before an apply transaction starts", async () => {
  const action = draftAction("action-1", "create_note", {
    content: "Denied",
    parentId: null,
    title: "denied.md"
  });
  const { accessPolicy, executor, store } = createFixture({ actions: [action] }, "viewer");

  await assert.rejects(() => executor.apply(ownerUserId, workspaceId, [action.id]), /Workspace access denied/);

  assert.equal(accessPolicy.writerChecks, 1);
  assert.equal(store.transactionCalls, 0);
  assert.equal(store.writeAttempts, 0);
  assert.equal(store.state.actions[0].status, "pending");
});

test("editor applies note, table, and canvas drafts with snapshots and gap-safe positions", async () => {
  const actions = [
    draftAction("action-note", "create_note", {
      content: "# Release plan",
      parentId: null,
      title: "release-plan.md"
    }, 1),
    draftAction("action-table", "create_table_note", {
      columns: ["Task", "Owner"],
      parentId: null,
      rows: [["Ship", "Team"]],
      title: "tasks.md"
    }, 2),
    draftAction("action-canvas", "create_canvas_diagram", {
      edges: [{ from: "web", label: "calls", to: "api" }],
      nodes: [
        { key: "web", kind: "process", label: "Web" },
        { key: "api", kind: "decision", label: "API" }
      ],
      parentId: null,
      title: "architecture.canvas"
    }, 3)
  ];
  const { executor, store } = createFixture({
    actions,
    documents: [existingDocument("existing-document-1", "First", 2), existingDocument("existing-document-2", "Last", 8)],
    fileNodes: [existingFileNode("existing-file-1", "first.md", 1), existingFileNode("existing-file-2", "last.md", 7)]
  });

  const result = await executor.apply(ownerUserId, workspaceId, actions.map((action) => action.id));
  const createdDocuments = store.state.documents.filter((document) => document.id.startsWith("document-"));
  const createdFileNodes = store.state.fileNodes.filter((fileNode) => fileNode.id.startsWith("file-node-"));

  assert.deepEqual(createdDocuments.map((document) => document.position), [9, 10, 11]);
  assert.deepEqual(createdFileNodes.map((fileNode) => fileNode.position), [8, 9, 10]);
  assert.deepEqual(createdDocuments.map((document) => document.type), ["note", "note", "canvas"]);
  assert.equal(createdDocuments[0].content, "# Release plan");
  assert.equal(createdDocuments[1].content, "| Task | Owner |\n| --- | --- |\n| Ship | Team |");
  assert.equal(createdDocuments[2].content, "");
  assert.notEqual(createdDocuments[2].canvasState, null);
  assert.deepEqual(store.state.actions.map((action) => action.status), ["applied", "applied", "applied"]);
  assert.deepEqual(store.state.actions.map((action) => action.resultDocumentId), createdDocuments.map((document) => document.id));
  assert.equal(store.state.snapshots.length, 3);
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.label), ["AI draft applied", "AI draft applied", "AI draft applied"]);
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.content), createdDocuments.map((document) => document.content));
  assert.deepEqual(store.state.snapshots.map((snapshot) => snapshot.canvasState), createdDocuments.map((document) => document.canvasState));
  assert.equal(store.state.activities.length, 3);
  assert.equal(store.state.audits.length, 3);
  assert.deepEqual(store.state.activities.map((event) => event.type), ["ai.action.applied", "ai.action.applied", "ai.action.applied"]);
  assert.deepEqual(result.documents.map((document) => document.id), createdDocuments.map((document) => document.id));
  assert.equal(result.openDocumentId, createdDocuments[0].id);
  assert.deepEqual(result.actions.map((action) => action.status), ["applied", "applied", "applied"]);
});

test("invalid persisted payload is rejected before any write", async () => {
  const action = draftAction("action-invalid", "create_note", {
    content: "Unsafe persisted shape",
    parentId: null,
    title: "invalid.md",
    unexpected: true
  });
  const { executor, store } = createFixture({ actions: [action] });

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, [action.id]),
    (error) => assertAiError(error, "draft_action_invalid", 422)
  );

  assert.equal(store.writeAttempts, 0);
  assert.equal(store.state.actions[0].status, "pending");
  assert.equal(store.state.documents.length, 0);
  assert.equal(store.state.fileNodes.length, 0);
  assert.equal(store.state.snapshots.length, 0);
});

test("aggregate persisted payload limit rejects a large batch before writes", async () => {
  const actions = [
    draftAction("action-large-1", "create_note", {
      content: "界".repeat(180_000),
      parentId: null,
      title: "large-1.md"
    }),
    draftAction("action-large-2", "create_note", {
      content: "界".repeat(180_000),
      parentId: null,
      title: "large-2.md"
    }, 1)
  ];
  const { executor, store } = createFixture({ actions });

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, actions.map((action) => action.id)),
    (error) => assertAiError(error, "draft_action_payload_too_large", 413)
  );

  assert.equal(store.writeAttempts, 0);
  assert.deepEqual(store.state.actions.map((action) => action.status), ["pending", "pending"]);
  assert.equal(store.state.documents.length, 0);
});

test("name conflict leaves every action pending and creates no documents", async () => {
  const actions = [
    draftAction("action-conflict", "create_note", {
      content: "Conflict",
      parentId: null,
      title: "occupied.md"
    }),
    draftAction("action-free", "create_note", {
      content: "Free",
      parentId: null,
      title: "free.md"
    }, 1)
  ];
  const { executor, store } = createFixture({
    actions,
    fileNodes: [existingFileNode("occupied-file", "occupied.md", 4)]
  });

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, actions.map((action) => action.id)),
    (error) => assertAiError(error, "draft_name_conflict", 409)
  );

  assert.equal(store.writeAttempts, 0);
  assert.deepEqual(store.state.actions.map((action) => action.status), ["pending", "pending"]);
  assert.equal(store.state.documents.length, 0);
  assert.equal(store.state.snapshots.length, 0);
});

test("replaying applied actions returns the original result without duplicate writes", async () => {
  const action = draftAction("action-replay", "create_note", {
    content: "Idempotent",
    parentId: null,
    title: "idempotent.md"
  });
  const { executor, store } = createFixture({ actions: [action] });

  const firstResult = await executor.apply(ownerUserId, workspaceId, [action.id]);
  const writesAfterFirstApply = store.writeAttempts;
  const secondResult = await executor.apply(ownerUserId, workspaceId, [action.id]);

  assert.deepEqual(secondResult, firstResult);
  assert.equal(store.writeAttempts, writesAfterFirstApply);
  assert.equal(store.state.documents.length, 1);
  assert.equal(store.state.fileNodes.length, 1);
  assert.equal(store.state.snapshots.length, 1);
  assert.equal(store.state.activities.length, 1);
  assert.equal(store.state.audits.length, 1);
  assert.equal(store.state.actions[0].status, "applied");
});

test("editor applies a realtime note update with one durable finalization", async () => {
  const document = existingDocument("document-update", "plan.md", 3);
  const action = updateAction("action-update", document, "# Updated plan");
  const { executor, realtimeUpdater, store } = createFixture({
    actions: [action],
    documents: [document],
    fileNodes: [linkedFileNode(document)]
  });

  const firstResult = await executor.apply(ownerUserId, workspaceId, [action.id]);
  const writesAfterApply = store.writeAttempts;
  const secondResult = await executor.apply(ownerUserId, workspaceId, [action.id]);

  assert.equal(realtimeUpdater.calls.length, 1);
  assert.deepEqual(realtimeUpdater.calls[0], {
    actionId: action.id,
    content: "# Updated plan",
    documentId: document.id,
    documentType: "note",
    expectedContentHash: hashDocumentContent("existing"),
    roomName: `slate:room:${workspaceId}:note:${document.id}`,
    workspaceId
  });
  assert.equal(store.state.documents[0].content, "# Updated plan");
  assert.equal(store.state.actions[0].status, "applied");
  assert.equal(store.state.actions[0].resultDocumentId, document.id);
  assert.equal(store.state.snapshots.length, 1);
  assert.equal(store.state.snapshots[0].content, "# Updated plan");
  assert.equal(store.state.activities.length, 1);
  assert.equal(store.state.audits.length, 1);
  assert.equal(firstResult.documents[0].id, document.id);
  assert.equal(firstResult.openDocumentId, null);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(store.writeAttempts, writesAfterApply);
});

test("retry resumes an applying update after an uncertain realtime failure", async () => {
  const document = existingDocument("document-retry", "retry.md", 1);
  const action = updateAction("action-retry", document, "retried");
  const realtimeUpdater = new FakeRealtimeUpdater();
  realtimeUpdater.applyBeforeError = true;
  realtimeUpdater.error = new AiDomainError("realtime_update_timeout", "timeout", 504, true);
  const { executor, store } = createFixture({
    actions: [action],
    documents: [document],
    fileNodes: [linkedFileNode(document)]
  }, "editor", realtimeUpdater);

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, [action.id]),
    (error) => error instanceof AiDomainError && error.code === "realtime_update_timeout" && error.retryable
  );
  assert.equal(store.state.actions[0].status, "applying");
  assert.equal(store.state.snapshots.length, 0);

  realtimeUpdater.error = null;
  const result = await executor.apply(ownerUserId, workspaceId, [action.id]);

  assert.equal(realtimeUpdater.calls.length, 2);
  assert.equal(store.state.actions[0].status, "applied");
  assert.equal(store.state.snapshots.length, 1);
  assert.equal(store.state.activities.length, 1);
  assert.equal(store.state.audits.length, 1);
  assert.equal(result.documents[0].content, "retried");
});

test("finalization preserves collaborator edits made after the realtime replacement", async () => {
  const document = existingDocument("document-collaborator", "shared.md", 1);
  const action = updateAction("action-collaborator", document, "AI replacement");
  const realtimeUpdater = new FakeRealtimeUpdater();
  const { executor, store } = createFixture({
    actions: [action],
    documents: [document],
    fileNodes: [linkedFileNode(document)]
  }, "editor", realtimeUpdater);
  realtimeUpdater.afterApply = () => {
    store.state.documents[0].content = "Collaborator edit";
    store.state.documents[0].updatedAt = new Date(store.state.documents[0].updatedAt.getTime() + 1_000);
  };

  const result = await executor.apply(ownerUserId, workspaceId, [action.id]);

  assert.equal(store.state.documents[0].content, "Collaborator edit");
  assert.equal(result.documents[0].content, "Collaborator edit");
  assert.equal(store.state.snapshots[0].content, "AI replacement");
  assert.equal(store.state.actions[0].status, "applied");
});

test("live realtime conflict fails the update without changing the document", async () => {
  const document = existingDocument("document-conflict", "conflict.md", 1);
  const action = updateAction("action-conflict-update", document, "replacement");
  const realtimeUpdater = new FakeRealtimeUpdater();
  realtimeUpdater.error = new AiDomainError("document_version_conflict", "changed", 409);
  const { executor, store } = createFixture({
    actions: [action],
    documents: [document],
    fileNodes: [linkedFileNode(document)]
  }, "editor", realtimeUpdater);

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, [action.id]),
    (error) => assertAiError(error, "document_version_conflict", 409)
  );

  assert.equal(store.state.actions[0].status, "failed");
  assert.equal(store.state.actions[0].errorCode, "document_version_conflict");
  assert.equal(store.state.documents[0].content, "existing");
  assert.equal(store.state.snapshots.length, 0);
  assert.equal(store.state.activities.length, 0);
  assert.equal(store.state.audits.length, 0);
});

test("database timestamp drift defers conflict authority to realtime content CAS", async () => {
  const document = existingDocument("document-stale", "stale.md", 1);
  const action = updateAction("action-stale", document, "replacement");
  document.updatedAt = new Date(document.updatedAt.getTime() + 1_000);
  const { executor, realtimeUpdater, store } = createFixture({
    actions: [action],
    documents: [document],
    fileNodes: [linkedFileNode(document)]
  });

  await executor.apply(ownerUserId, workspaceId, [action.id]);

  assert.equal(realtimeUpdater.calls.length, 1);
  assert.equal(store.state.actions[0].status, "applied");
  assert.equal(store.state.documents[0].content, "replacement");
});

test("restricted targets and mixed update batches are rejected before mutation", async () => {
  const restrictedDocument = existingDocument("document-secret", ".env", 1);
  const update = updateAction("action-secret", restrictedDocument, "SECRET=replaced");
  const create = draftAction("action-create", "create_note", {
    content: "note",
    parentId: null,
    title: "note.md"
  });
  const { executor, realtimeUpdater, store } = createFixture({
    actions: [update, create],
    documents: [restrictedDocument],
    fileNodes: [linkedFileNode(restrictedDocument)]
  });

  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, [update.id, create.id]),
    (error) => assertAiError(error, "draft_update_batch_unsupported", 422)
  );
  await assert.rejects(
    () => executor.apply(ownerUserId, workspaceId, [update.id]),
    (error) => assertAiError(error, "document_restricted", 422)
  );

  assert.equal(realtimeUpdater.calls.length, 0);
  assert.deepEqual(store.state.actions.map((candidate) => candidate.status), ["pending", "pending"]);
  assert.equal(store.state.documents[0].content, "existing");
  assert.equal(store.state.snapshots.length, 0);
});
