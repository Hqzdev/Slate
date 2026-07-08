import { Prisma, type DocumentType, type FileNodeKind, type JobStatus, type WorkspaceRole } from "@prisma/client";
import { normalizeCanvasState } from "@/lib/canvas/canvasDocumentSchema";
import { activityRepository } from "@/lib/server/activityRepository";
import { prisma } from "@/lib/server/prisma";

export type WorkspaceDocumentPayload = {
  id: string;
  title: string;
  type: DocumentType;
  language: string | null;
  content: string;
  canvasState: Prisma.JsonValue;
  position: number;
  updatedAt: string;
};

export type ImportedWorkspaceDocument = {
  content: string;
  language: string | null;
  title: string;
  type: DocumentType;
};

export type DocumentSnapshotSummaryPayload = {
  createdAt: string;
  id: string;
  label: string | null;
};

export type WorkspaceFileNodePayload = {
  id: string;
  name: string;
  kind: FileNodeKind;
  parentId: string | null;
  documentId: string | null;
  position: number;
};

export type WorkspaceMemberPayload = {
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
  role: WorkspaceRole;
};

export type WorkspacePayload = {
  activeUser: {
    color: string;
    email: string;
    id: string;
    initials: string;
    name: string;
  };
  workspaces: {
    id: string;
    slug: string;
    name: string;
    documentCount: number;
    members: WorkspaceMemberPayload[];
  }[];
  activeWorkspace: {
    id: string;
    slug: string;
    name: string;
    documents: WorkspaceDocumentPayload[];
    fileNodes: WorkspaceFileNodePayload[];
    members: WorkspaceMemberPayload[];
    jobRuns: {
      id: string;
      status: JobStatus;
      kind: string;
      output: string;
      error: string | null;
      createdAt: string;
      documentTitle: string | null;
    }[];
    invites: {
      id: string;
      email: string | null;
      role: WorkspaceRole;
      expiresAt: string;
      createdAt: string;
    }[];
  } | null;
};

export class WorkspaceRepository {
  private readonly automaticSnapshotThrottleMs = 3 * 60 * 1000;
  private readonly maxAutomaticSnapshotsPerDocument = 200;

  async requireWorkspaceEditor(userId: string, workspaceId: string) {
    return this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
  }

  async getWorkspacePayload(userId: string, workspaceId?: string | null): Promise<WorkspacePayload> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const workspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: { userId }
        }
      },
      include: {
        documents: { select: { id: true }, where: { archivedAt: null } },
        members: { include: { user: true }, orderBy: { createdAt: "asc" } }
      },
      orderBy: { createdAt: "asc" }
    });
    const requestedWorkspace = workspaceId ? workspaces.find((workspace) => workspace.id === workspaceId) : null;
    const activeWorkspaceId = requestedWorkspace?.id ?? workspaces[0]?.id ?? null;
    if (activeWorkspaceId) {
      await this.ensureWorkspaceFileNodes(activeWorkspaceId);
    }
    const activeWorkspace = activeWorkspaceId
      ? await prisma.workspace.findUnique({
          where: { id: activeWorkspaceId },
          include: {
            documents: { orderBy: { position: "asc" }, where: { archivedAt: null } },
            fileNodes: { orderBy: [{ parentId: "asc" }, { position: "asc" }], where: { archivedAt: null } },
            jobRuns: {
              include: { document: true },
              orderBy: { createdAt: "desc" },
              take: 20
            },
            members: { include: { user: true }, orderBy: { createdAt: "asc" } }
          }
        })
      : null;
    const activeMember = activeWorkspace?.members.find((member) => member.userId === userId) ?? null;
    const invites = activeWorkspace && activeMember?.role === "owner"
      ? await prisma.workspaceInvite.findMany({
          orderBy: { createdAt: "desc" },
          take: 30,
          where: {
            OR: [
              {
                acceptedAt: null,
                expiresAt: { gt: new Date() }
              },
              {
                acceptedAt: { not: null }
              }
            ],
            workspaceId: activeWorkspace.id
          }
        })
      : [];

    return {
      activeUser: {
        color: user.color,
        email: user.email,
        id: user.id,
        initials: user.initials,
        name: user.name
      },
      activeWorkspace: activeWorkspace
        ? {
            documents: activeWorkspace.documents.map((document) => this.toDocumentPayload(document)),
            fileNodes: activeWorkspace.fileNodes.map((fileNode) => this.toFileNodePayload(fileNode)),
            id: activeWorkspace.id,
            jobRuns: activeWorkspace.jobRuns.map((jobRun) => ({
              createdAt: jobRun.createdAt.toISOString(),
              documentTitle: jobRun.document?.title ?? null,
              error: jobRun.error,
              id: jobRun.id,
              kind: jobRun.kind,
              output: jobRun.output,
              status: jobRun.status
            })),
            invites: invites.map((invite) => ({
              acceptedAt: invite.acceptedAt?.toISOString() ?? null,
              createdAt: invite.createdAt.toISOString(),
              email: invite.email,
              expiresAt: invite.expiresAt.toISOString(),
              id: invite.id,
              role: invite.role
            })),
            members: activeWorkspace.members.map((member) => this.toMemberPayload(member)),
            name: activeWorkspace.name,
            slug: activeWorkspace.slug
          }
        : null,
      workspaces: workspaces.map((workspace) => ({
        documentCount: workspace.documents.length,
        id: workspace.id,
        members: workspace.members.map((member) => this.toMemberPayload(member)),
        name: workspace.name,
        slug: workspace.slug
      }))
    };
  }

  async createDocument(userId: string, workspaceId: string, type: DocumentType): Promise<WorkspaceDocumentPayload> {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const count = await prisma.document.count({ where: { archivedAt: null, workspaceId, type } });
    const total = await prisma.document.count({ where: { archivedAt: null, workspaceId } });
    const title = this.defaultTitle(type, count + 1);
    await this.requireUniqueFileNodeName(workspaceId, null, title);
    const document = await prisma.$transaction(async (transaction) => {
      const createdDocument = await transaction.document.create({
        data: {
          content: this.defaultContent(type, count + 1),
          language: type === "code" ? "typescript" : null,
          position: total,
          title,
          type,
          workspaceId
        }
      });

      await transaction.documentSnapshot.create({
        data: {
          canvasState: createdDocument.canvasState ?? Prisma.JsonNull,
          content: createdDocument.content,
          documentId: createdDocument.id
        }
      });

      await transaction.workspaceFileNode.create({
        data: {
          documentId: createdDocument.id,
          kind: "document",
          name: title,
          parentId: null,
          position: await transaction.workspaceFileNode.count({ where: { archivedAt: null, parentId: null, workspaceId } }),
          workspaceId
        }
      });

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: createdDocument.id,
        metadata: { title, type },
        type: "document.created",
        workspaceId
      });

      return createdDocument;
    });

    return this.toDocumentPayload(document);
  }

  async createFileNode(userId: string, workspaceId: string, input: { extension?: string; kind: FileNodeKind; name: string; parentId?: string | null }) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const parentId = await this.resolveParentId(workspaceId, input.parentId ?? null);
    const position = await prisma.workspaceFileNode.count({ where: { archivedAt: null, parentId, workspaceId } });

    if (input.kind === "folder") {
      const name = this.normalizeFileNodeName(input.name);
      await this.requireUniqueFileNodeName(workspaceId, parentId, name);
      const fileNode = await prisma.workspaceFileNode.create({
        data: {
          kind: "folder",
          name,
          parentId,
          position,
          workspaceId
        }
      });
      await activityRepository.record({
        actorUserId: userId,
        metadata: { name, parentId },
        type: "file.folder_created",
        workspaceId
      });

      return {
        document: null,
        fileNode: this.toFileNodePayload(fileNode)
      };
    }

    const fileName = this.normalizeFileName(input.name, input.extension);
    await this.requireUniqueFileNodeName(workspaceId, parentId, fileName);
    const documentShape = this.documentShapeForFileName(fileName);
    const documentPosition = await prisma.document.count({ where: { archivedAt: null, workspaceId } });
    const result = await prisma.$transaction(async (transaction) => {
      const document = await transaction.document.create({
        data: {
          content: this.defaultFileContent(fileName, documentShape.type),
          language: documentShape.language,
          position: documentPosition,
          title: fileName,
          type: documentShape.type,
          workspaceId
        }
      });

      await transaction.documentSnapshot.create({
        data: {
          canvasState: Prisma.JsonNull,
          content: document.content,
          documentId: document.id
        }
      });

      const fileNode = await transaction.workspaceFileNode.create({
        data: {
          documentId: document.id,
          kind: "document",
          name: fileName,
          parentId,
          position,
          workspaceId
        }
      });

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: document.id,
        metadata: { name: fileName, parentId, type: documentShape.type },
        type: "document.created",
        workspaceId
      });

      return { document, fileNode };
    });

    return {
      document: this.toDocumentPayload(result.document),
      fileNode: this.toFileNodePayload(result.fileNode)
    };
  }

  async importDocuments(userId: string, workspaceId: string, documents: ImportedWorkspaceDocument[]): Promise<WorkspaceDocumentPayload[]> {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);

    if (documents.length === 0) {
      throw new Error("Import must contain at least one document");
    }

    const createdDocuments = await prisma.$transaction(async (transaction) => {
      const importedDocuments = [];
      let documentPosition = await transaction.document.count({ where: { archivedAt: null, workspaceId } });

      for (const document of documents) {
        const normalizedPath = this.normalizeImportPath(document.title);
        const parentId = await this.ensureFolderPath(transaction, workspaceId, normalizedPath.folderPath);
        const name = this.uniqueImportedFileName(await this.existingSiblingNames(transaction, workspaceId, parentId), normalizedPath.name);
        const createdDocument = await transaction.document.create({
          data: {
            content: document.content,
            language: document.language,
            position: documentPosition,
            title: name,
            type: document.type,
            workspaceId
          }
        });
        documentPosition += 1;

        await transaction.documentSnapshot.create({
          data: {
            canvasState: Prisma.JsonNull,
            content: createdDocument.content,
            documentId: createdDocument.id
          }
        });

        await transaction.workspaceFileNode.create({
          data: {
            documentId: createdDocument.id,
            kind: "document",
            name,
            parentId,
            position: await transaction.workspaceFileNode.count({ where: { archivedAt: null, parentId, workspaceId } }),
            workspaceId
          }
        });

        importedDocuments.push(createdDocument);
      }

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { count: importedDocuments.length },
        type: "git_import.completed",
        workspaceId
      });

      return importedDocuments;
    });

    return createdDocuments.map((document) => this.toDocumentPayload(document));
  }

  async renameFileNode(userId: string, fileNodeId: string, name: string) {
    const fileNode = await prisma.workspaceFileNode.findFirstOrThrow({
      include: { document: true },
      where: { archivedAt: null, id: fileNodeId }
    });
    await this.requireWorkspaceRole(userId, fileNode.workspaceId, ["owner", "editor"]);
    const normalizedName = fileNode.kind === "folder" ? this.normalizeFileNodeName(name) : this.normalizeFileName(name);

    if (normalizedName !== fileNode.name) {
      await this.requireUniqueFileNodeName(fileNode.workspaceId, fileNode.parentId, normalizedName, fileNode.id);
    }

    const updatedFileNode = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspaceFileNode.update({
        data: { name: normalizedName },
        where: { id: fileNode.id }
      });

      if (fileNode.documentId) {
        const documentShape = this.documentShapeForFileName(normalizedName);
        await transaction.document.update({
          data: {
            language: documentShape.language,
            title: normalizedName,
            type: documentShape.type
          },
          where: { id: fileNode.documentId }
        });
      }

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: fileNode.documentId,
        metadata: { from: fileNode.name, kind: fileNode.kind, to: normalizedName },
        type: "file.renamed",
        workspaceId: fileNode.workspaceId
      });

      return updated;
    });

    const document = fileNode.documentId
      ? await prisma.document.findUniqueOrThrow({ where: { id: fileNode.documentId } })
      : null;

    return {
      document: document ? this.toDocumentPayload(document) : null,
      fileNode: this.toFileNodePayload(updatedFileNode)
    };
  }

  async moveFileNode(userId: string, fileNodeId: string, parentId: string | null, position?: number | null) {
    const fileNode = await prisma.workspaceFileNode.findFirstOrThrow({
      where: { archivedAt: null, id: fileNodeId }
    });
    await this.requireWorkspaceRole(userId, fileNode.workspaceId, ["owner", "editor"]);
    const nextParentId = await this.resolveParentId(fileNode.workspaceId, parentId);

    if (nextParentId === fileNode.id) {
      throw new Error("Folder cannot be moved into itself");
    }

    if (nextParentId && fileNode.kind === "folder") {
      await this.requireNotDescendant(fileNode.id, nextParentId);
    }

    await this.requireUniqueFileNodeName(fileNode.workspaceId, nextParentId, fileNode.name, fileNode.id);
    const normalizedPosition = Number.isFinite(position) ? Math.max(0, Math.round(Number(position))) : null;
    const updatedFileNodes = await prisma.$transaction(async (transaction) => {
      const siblings = await transaction.workspaceFileNode.findMany({
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        where: {
          archivedAt: null,
          id: { not: fileNode.id },
          parentId: nextParentId,
          workspaceId: fileNode.workspaceId
        }
      });
      const nextPosition = Math.min(normalizedPosition ?? siblings.length, siblings.length);
      const orderedNodes = [...siblings.slice(0, nextPosition), fileNode, ...siblings.slice(nextPosition)];
      const updates = [];

      for (let index = 0; index < orderedNodes.length; index += 1) {
        updates.push(transaction.workspaceFileNode.update({
          data: {
            parentId: nextParentId,
            position: index
          },
          where: { id: orderedNodes[index].id }
        }));
      }

      const updatedNodes = await Promise.all(updates);
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: fileNode.documentId,
        metadata: { kind: fileNode.kind, name: fileNode.name, parentId: nextParentId, position: nextPosition },
        type: "file.moved",
        workspaceId: fileNode.workspaceId
      });

      return updatedNodes;
    });

    return { fileNodes: updatedFileNodes.map((node) => this.toFileNodePayload(node)) };
  }

  async archiveFileNode(userId: string, fileNodeId: string) {
    const fileNode = await prisma.workspaceFileNode.findFirstOrThrow({
      where: { archivedAt: null, id: fileNodeId }
    });
    await this.requireWorkspaceRole(userId, fileNode.workspaceId, ["owner", "editor"]);
    const archivedAt = new Date();
    const descendants = await this.collectDescendantFileNodes(fileNode.id);
    const nodeIds = [fileNode.id, ...descendants.map((node) => node.id)];
    const documentIds = [fileNode, ...descendants].flatMap((node) => node.documentId ? [node.documentId] : []);

    await prisma.$transaction(async (transaction) => {
      await transaction.workspaceFileNode.updateMany({
        data: { archivedAt },
        where: { id: { in: nodeIds } }
      });

      if (documentIds.length > 0) {
        await transaction.document.updateMany({
          data: { archivedAt },
          where: { id: { in: documentIds } }
        });
      }

      const siblings = await transaction.workspaceFileNode.findMany({
        orderBy: { position: "asc" },
        select: { id: true },
        where: {
          archivedAt: null,
          parentId: fileNode.parentId,
          workspaceId: fileNode.workspaceId
        }
      });

      await Promise.all(siblings.map((sibling, index) => (
        transaction.workspaceFileNode.update({
          data: { position: index },
          where: { id: sibling.id }
        })
      )));

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: fileNode.documentId,
        metadata: { documentCount: documentIds.length, kind: fileNode.kind, name: fileNode.name, nodeCount: nodeIds.length },
        type: "file.deleted",
        workspaceId: fileNode.workspaceId
      });
    });

    return { documentIds, fileNodeIds: nodeIds };
  }

  async updateDocument(userId: string, documentId: string, input: { canvasState?: Prisma.InputJsonValue | null; content?: string; title?: string }) {
    const existingDocument = await prisma.document.findFirstOrThrow({
      include: { fileNode: true },
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, existingDocument.workspaceId, ["owner", "editor"]);

    const title = input.title === undefined ? undefined : this.normalizeDocumentTitle(input.title);
    if (title && existingDocument.fileNode) {
      await this.requireUniqueFileNodeName(existingDocument.workspaceId, existingDocument.fileNode.parentId, title, existingDocument.fileNode.id);
    }

    const document = await prisma.$transaction(async (transaction) => {
      const documentShape = title ? this.documentShapeForFileName(title) : null;
      const updatedDocument = await transaction.document.update({
        where: { id: documentId },
        data: {
          canvasState: input.canvasState === undefined ? undefined : input.canvasState === null ? Prisma.JsonNull : normalizeCanvasState(input.canvasState),
          content: input.content,
          language: documentShape?.language,
          type: documentShape?.type,
          title
        }
      });

      if (title && existingDocument.fileNode) {
        await transaction.workspaceFileNode.update({
          data: { name: title },
          where: { id: existingDocument.fileNode.id }
        });
        await activityRepository.recordWithClient(transaction, {
          actorUserId: userId,
          documentId: updatedDocument.id,
          metadata: { from: existingDocument.title, to: title },
          type: "document.renamed",
          workspaceId: existingDocument.workspaceId
        });
      }

      const latestSnapshot = await transaction.documentSnapshot.findFirst({
        orderBy: { createdAt: "desc" },
        where: { documentId: updatedDocument.id }
      });

      if (!latestSnapshot || Date.now() - latestSnapshot.createdAt.getTime() > this.automaticSnapshotThrottleMs) {
        await transaction.documentSnapshot.create({
          data: {
            canvasState: updatedDocument.canvasState ?? Prisma.JsonNull,
            content: updatedDocument.content,
            documentId: updatedDocument.id
          }
        });
        await this.pruneAutomaticDocumentSnapshots(transaction, updatedDocument.id);
      }

      return updatedDocument;
    });

    return this.toDocumentPayload(document);
  }

  async createDocumentSnapshot(userId: string, documentId: string, label?: string) {
    const document = await prisma.document.findFirstOrThrow({
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, document.workspaceId, ["owner", "editor"]);

    const snapshot = await prisma.documentSnapshot.create({
      data: {
        canvasState: document.canvasState ?? Prisma.JsonNull,
        content: document.content,
        documentId: document.id,
        label: label?.trim() || null
      }
    });

    return this.toSnapshotSummaryPayload(snapshot);
  }

  async listDocumentSnapshots(userId: string, documentId: string): Promise<DocumentSnapshotSummaryPayload[]> {
    const document = await prisma.document.findFirstOrThrow({
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, document.workspaceId, ["editor", "owner", "viewer"]);

    const snapshots = await prisma.documentSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, id: true, label: true },
      take: 100,
      where: { documentId }
    });

    return snapshots.map((snapshot) => this.toSnapshotSummaryPayload(snapshot));
  }

  async restoreDocumentSnapshot(userId: string, documentId: string, snapshotId: string) {
    const document = await prisma.document.findFirstOrThrow({
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, document.workspaceId, ["owner", "editor"]);

    const snapshot = await prisma.documentSnapshot.findFirstOrThrow({
      where: { documentId, id: snapshotId }
    });

    const restoredDocument = await prisma.$transaction(async (transaction) => {
      const updatedDocument = await transaction.document.update({
        data: {
          canvasState: snapshot.canvasState ?? Prisma.JsonNull,
          content: snapshot.content
        },
        where: { id: documentId }
      });

      await transaction.documentSnapshot.create({
        data: {
          canvasState: updatedDocument.canvasState ?? Prisma.JsonNull,
          content: updatedDocument.content,
          documentId: updatedDocument.id,
          label: `Restored from ${snapshot.createdAt.toISOString()}`
        }
      });

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: updatedDocument.id,
        metadata: { snapshotId },
        type: "document.restored",
        workspaceId: document.workspaceId
      });

      return updatedDocument;
    });

    return this.toDocumentPayload(restoredDocument);
  }

  async archiveDocument(userId: string, documentId: string) {
    const existingDocument = await prisma.document.findFirstOrThrow({
      include: { fileNode: true },
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, existingDocument.workspaceId, ["owner", "editor"]);

    await prisma.$transaction(async (transaction) => {
      await transaction.document.update({
        data: { archivedAt: new Date() },
        where: { id: documentId }
      });

      if (existingDocument.fileNode) {
        await transaction.workspaceFileNode.update({
          data: { archivedAt: new Date() },
          where: { id: existingDocument.fileNode.id }
        });
      }

      const remainingDocuments = await transaction.document.findMany({
        orderBy: { position: "asc" },
        select: { id: true },
        where: {
          archivedAt: null,
          workspaceId: existingDocument.workspaceId
        }
      });

      await Promise.all(remainingDocuments.map((document, index) => (
        transaction.document.update({
          data: { position: index },
          where: { id: document.id }
        })
      )));

      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId,
        metadata: { title: existingDocument.title },
        type: "document.deleted",
        workspaceId: existingDocument.workspaceId
      });
    });
  }

  async reorderDocuments(userId: string, workspaceId: string, documentIds: string[]) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);

    const uniqueDocumentIds = new Set(documentIds);
    if (uniqueDocumentIds.size !== documentIds.length || documentIds.length === 0) {
      throw new Error("Document order must contain unique document ids");
    }

    const documents = await prisma.document.findMany({
      select: { id: true },
      where: {
        archivedAt: null,
        id: { in: documentIds },
        workspaceId
      }
    });

    if (documents.length !== documentIds.length) {
      throw new Error("Document order contains invalid documents");
    }

    const activeDocumentCount = await prisma.document.count({
      where: {
        archivedAt: null,
        workspaceId
      }
    });

    if (activeDocumentCount !== documentIds.length) {
      throw new Error("Document order must include every active document");
    }

    await prisma.$transaction(documentIds.map((documentId, index) => (
      prisma.document.update({
        data: { position: index },
        where: { id: documentId }
      })
    )));

    const orderedDocuments = await prisma.document.findMany({
      orderBy: { position: "asc" },
      where: {
        archivedAt: null,
        workspaceId
      }
    });

    return orderedDocuments.map((document) => this.toDocumentPayload(document));
  }

  async createRun(userId: string, documentId: string, environmentId: string) {
    const document = await prisma.document.findFirstOrThrow({
      include: { workspace: true },
      where: { archivedAt: null, id: documentId }
    });
    await this.requireWorkspaceRole(userId, document.workspaceId, ["owner", "editor"]);

    const run = await prisma.$transaction(async (transaction) => {
      const createdRun = await transaction.jobRun.create({
        data: {
          documentId: document.id,
          kind: environmentId,
          output: `Queued for ${environmentId}.`,
          status: "pending",
          userId,
          workspaceId: document.workspaceId
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: document.id,
        metadata: { environmentId, runId: createdRun.id },
        type: "run.queued",
        workspaceId: document.workspaceId
      });
      return createdRun;
    });

    return {
      document: {
        content: document.content,
        language: document.language,
        title: document.title,
        type: document.type
      },
      run: {
        createdAt: run.createdAt.toISOString(),
        documentTitle: document.title,
        error: run.error,
        id: run.id,
        kind: run.kind,
        output: run.output,
        status: run.status
      }
    };
  }

  async listRuns(userId: string, workspaceId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const runs = await prisma.jobRun.findMany({
      include: { document: true },
      orderBy: { createdAt: "desc" },
      take: 50,
      where: { workspaceId }
    });

    return runs.map((run) => ({
      createdAt: run.createdAt.toISOString(),
      documentTitle: run.document?.title ?? null,
      error: run.error,
      id: run.id,
      kind: run.kind,
      output: run.output,
      status: run.status
    }));
  }

  async updateWorkspaceMemberRole(userId: string, workspaceId: string, memberUserId: string, role: WorkspaceRole) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner"]);
    const member = await prisma.workspaceMember.findUniqueOrThrow({
      include: { user: true },
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId
        }
      }
    });

    if (member.role === "owner" && role !== "owner") {
      await this.requireAnotherWorkspaceOwner(workspaceId, member.userId);
    }

    const updatedMember = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspaceMember.update({
        include: { user: true },
        data: { role },
        where: {
          userId_workspaceId: {
            userId: memberUserId,
            workspaceId
          }
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { from: member.role, memberName: member.user.name, to: role },
        type: "member.role_changed",
        workspaceId
      });
      return updated;
    });

    return this.toMemberPayload(updatedMember);
  }

  async removeWorkspaceMember(userId: string, workspaceId: string, memberUserId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner"]);

    if (userId === memberUserId) {
      throw new Error("You cannot remove yourself from the workspace");
    }

    const member = await prisma.workspaceMember.findUniqueOrThrow({
      include: { user: true },
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId
        }
      }
    });

    if (member.role === "owner") {
      await this.requireAnotherWorkspaceOwner(workspaceId, member.userId);
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.workspaceMember.delete({
        where: {
          userId_workspaceId: {
            userId: memberUserId,
            workspaceId
          }
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { memberName: member.user.name, role: member.role },
        type: "member.removed",
        workspaceId
      });
    });

    return { userId: memberUserId };
  }

  async createDefaultWorkspaceForUser(userId: string, name: string) {
    const slugBase = this.slugify(name);
    const slug = await this.uniqueWorkspaceSlug(`${slugBase}-workspace`);
    const workspace = await prisma.workspace.create({
      data: {
        members: {
          create: {
            role: "owner",
            userId
          }
        },
        name: `${name}'s Workspace`,
        slug
      }
    });

    await prisma.document.createMany({
      data: [
        {
          content: "export function start() {\n  return \"ship together\"\n}",
          language: "typescript",
          position: 0,
          title: "start.ts",
          type: "code",
          workspaceId: workspace.id
        },
        {
          content: "# First note\n\nWrite decisions, TODOs, and shared context here.",
          language: null,
          position: 1,
          title: "First note",
          type: "note",
          workspaceId: workspace.id
        }
      ]
    });

    return workspace;
  }

  async canAccessRealtimeRoom(userId: string, roomName: string) {
    return Boolean(await this.authorizeRealtimeRoom(userId, roomName));
  }

  async authorizeRealtimeRoom(userId: string, roomName: string) {
    const parsedRoom = this.parseRoomName(roomName);
    if (!parsedRoom) return null;

    const member = await prisma.workspaceMember.findUnique({
      include: { user: true },
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: parsedRoom.workspaceId
        }
      }
    });

    if (!member) return null;

    const document = await prisma.document.findFirst({
      select: { id: true },
      where: {
        archivedAt: null,
        id: parsedRoom.documentId,
        type: parsedRoom.documentType,
        workspaceId: parsedRoom.workspaceId
      }
    });

    if (!document) return null;

    return {
      color: member.user.color,
      email: member.user.email,
      id: member.user.id,
      initials: member.user.initials,
      name: member.user.name,
      role: member.role,
      canWrite: member.role === "owner" || member.role === "editor"
    };
  }

  private defaultContent(type: DocumentType, index: number) {
    if (type === "code") return `export function scratch${index}() {\n  return true\n}`;
    if (type === "note") return `# Note ${index}\n\nWrite decisions, TODOs, or debugging notes here.`;
    return "";
  }

  private defaultFileContent(fileName: string, type: DocumentType) {
    if (type === "note") return `# ${fileName.replace(/\.(md|mdx)$/i, "")}\n`;
    if (type === "canvas") return "";
    return "";
  }

  private defaultTitle(type: DocumentType, index: number) {
    if (type === "code") return `scratch-${index}.ts`;
    if (type === "note") return `Note ${index}`;
    return `Canvas ${index}`;
  }

  private async requireWorkspaceRole(userId: string, workspaceId: string, roles: WorkspaceRole[]) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId
        }
      }
    });

    if (!member || !roles.includes(member.role)) {
      throw new Error("Workspace access denied");
    }

    return member;
  }

  private async requireAnotherWorkspaceOwner(workspaceId: string, userId: string) {
    const ownerCount = await prisma.workspaceMember.count({
      where: {
        role: "owner",
        workspaceId,
        userId: { not: userId }
      }
    });

    if (ownerCount === 0) {
      throw new Error("Workspace must keep at least one owner");
    }
  }

  private async resolveParentId(workspaceId: string, parentId: string | null) {
    if (!parentId) return null;

    const parent = await prisma.workspaceFileNode.findFirst({
      where: {
        archivedAt: null,
        id: parentId,
        kind: "folder",
        workspaceId
      }
    });

    if (!parent) {
      throw new Error("Parent folder not found");
    }

    return parent.id;
  }

  private async requireUniqueFileNodeName(workspaceId: string, parentId: string | null, name: string, ignoredFileNodeId?: string) {
    const existing = await prisma.workspaceFileNode.findFirst({
      where: {
        archivedAt: null,
        id: ignoredFileNodeId ? { not: ignoredFileNodeId } : undefined,
        name,
        parentId,
        workspaceId
      }
    });

    if (existing) {
      throw new Error("A file or folder with this name already exists here");
    }
  }

  private async requireNotDescendant(fileNodeId: string, parentId: string) {
    let currentParentId: string | null = parentId;

    while (currentParentId) {
      if (currentParentId === fileNodeId) {
        throw new Error("Folder cannot be moved into its own child");
      }

      const parent: { parentId: string | null } | null = await prisma.workspaceFileNode.findFirst({
        select: { parentId: true },
        where: {
          archivedAt: null,
          id: currentParentId
        }
      });
      currentParentId = parent?.parentId ?? null;
    }
  }

  private normalizeFileNodeName(name: string) {
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      throw new Error("Name is required");
    }

    if (normalizedName.length > 120) {
      throw new Error("Name must be 120 characters or less");
    }

    if (normalizedName.includes("/") || normalizedName.includes("\\")) {
      throw new Error("Name cannot contain path separators");
    }

    if (normalizedName === "." || normalizedName === "..") {
      throw new Error("Name is reserved");
    }

    return normalizedName;
  }

  private normalizeFileName(name: string, extension?: string) {
    const normalizedName = this.normalizeFileNodeName(name);
    if (!extension) return normalizedName;
    const normalizedExtension = extension.trim().replace(/^\./, "").toLowerCase();

    if (!/^[a-z0-9]+$/.test(normalizedExtension)) {
      throw new Error("Extension must contain only letters and numbers");
    }

    const suffix = `.${normalizedExtension}`;
    return normalizedName.toLowerCase().endsWith(suffix) ? normalizedName : `${normalizedName}${suffix}`;
  }

  private documentShapeForFileName(fileName: string): { language: string | null; type: DocumentType } {
    const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    const languageByExtension: Record<string, string> = {
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      css: "css",
      go: "go",
      html: "html",
      java: "java",
      js: "javascript",
      json: "json",
      jsx: "javascript",
      kt: "kotlin",
      php: "php",
      py: "python",
      rb: "ruby",
      rs: "rust",
      scss: "scss",
      sh: "shell",
      sql: "sql",
      swift: "swift",
      toml: "toml",
      ts: "typescript",
      tsx: "typescript",
      vue: "vue",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml"
    };

    if (extension === "md" || extension === "mdx") {
      return { language: null, type: "note" };
    }

    if (extension === "canvas") {
      return { language: null, type: "canvas" };
    }

    return { language: languageByExtension[extension] ?? "plaintext", type: "code" };
  }

  private async ensureWorkspaceFileNodes(workspaceId: string) {
    const documents = await prisma.document.findMany({
      include: { fileNode: true },
      orderBy: { position: "asc" },
      where: {
        archivedAt: null,
        workspaceId
      }
    });

    const missingDocuments = documents.filter((document) => !document.fileNode);
    if (missingDocuments.length === 0) return;

    await prisma.$transaction(async (transaction) => {
      let position = await transaction.workspaceFileNode.count({
        where: {
          archivedAt: null,
          parentId: null,
          workspaceId
        }
      });

      for (const document of missingDocuments) {
        const name = this.uniqueImportedFileName(await this.existingSiblingNames(transaction, workspaceId, null), document.title);
        await transaction.workspaceFileNode.create({
          data: {
            documentId: document.id,
            kind: "document",
            name,
            parentId: null,
            position,
            workspaceId
          }
        });
        position += 1;
      }
    });
  }

  private async ensureFolderPath(transaction: Prisma.TransactionClient, workspaceId: string, folderPath: string[]) {
    let parentId: string | null = null;

    for (const folderName of folderPath) {
      const normalizedName = this.normalizeFileNodeName(folderName);
      const existingFolder: { id: string } | null = await transaction.workspaceFileNode.findFirst({
        select: { id: true },
        where: {
          archivedAt: null,
          kind: "folder",
          name: normalizedName,
          parentId,
          workspaceId
        }
      });

      if (existingFolder) {
        parentId = existingFolder.id;
        continue;
      }

      const name = this.uniqueImportedFileName(await this.existingSiblingNames(transaction, workspaceId, parentId), normalizedName);
      const folder: { id: string } = await transaction.workspaceFileNode.create({
        data: {
          kind: "folder",
          name,
          parentId,
          position: await transaction.workspaceFileNode.count({ where: { archivedAt: null, parentId, workspaceId } }),
          workspaceId
        },
        select: { id: true }
      });
      parentId = folder.id;
    }

    return parentId;
  }

  private normalizeImportPath(title: string) {
    const segments = title.split("/").map((segment) => segment.trim()).filter(Boolean);
    const name = this.normalizeFileName(segments.at(-1) ?? title);
    return {
      folderPath: segments.slice(0, -1),
      name
    };
  }

  private async existingSiblingNames(transaction: Prisma.TransactionClient, workspaceId: string, parentId: string | null) {
    const siblings = await transaction.workspaceFileNode.findMany({
      select: { name: true },
      where: {
        archivedAt: null,
        parentId,
        workspaceId
      }
    });

    return new Set(siblings.map((sibling) => sibling.name));
  }

  private uniqueImportedFileName(existingNames: Set<string>, name: string) {
    if (!existingNames.has(name)) return name;

    const extensionIndex = name.lastIndexOf(".");
    const base = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    const extension = extensionIndex > 0 ? name.slice(extensionIndex) : "";
    let index = 2;
    let nextName = `${base}-${index}${extension}`;

    while (existingNames.has(nextName)) {
      index += 1;
      nextName = `${base}-${index}${extension}`;
    }

    return nextName;
  }

  private async collectDescendantFileNodes(fileNodeId: string) {
    const descendants: { documentId: string | null; id: string }[] = [];
    const children = await prisma.workspaceFileNode.findMany({
      select: { documentId: true, id: true },
      where: {
        archivedAt: null,
        parentId: fileNodeId
      }
    });

    for (const child of children) {
      descendants.push(child);
      descendants.push(...await this.collectDescendantFileNodes(child.id));
    }

    return descendants;
  }

  private parseRoomName(roomName: string) {
    const match = roomName.match(/^slate:room:([^:]+):(file|note|canvas):([^:]+)$/);
    if (!match) return null;
    const documentTypeByRoomType: Record<string, DocumentType> = {
      canvas: "canvas",
      file: "code",
      note: "note"
    };

    return {
      documentId: match[3],
      documentType: documentTypeByRoomType[match[2]],
      workspaceId: match[1]
    };
  }

  private normalizeDocumentTitle(title: string) {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length === 0) {
      throw new Error("Document title is required");
    }

    if (normalizedTitle.length > 120) {
      throw new Error("Document title must be 120 characters or less");
    }

    return normalizedTitle;
  }

  private slugify(value: string) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return slug || "slate";
  }

  private async uniqueWorkspaceSlug(baseSlug: string) {
    let slug = baseSlug;
    let index = 2;

    while (await prisma.workspace.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${index}`;
      index += 1;
    }

    return slug;
  }

  private async pruneAutomaticDocumentSnapshots(transaction: Prisma.TransactionClient, documentId: string) {
    const excessSnapshots = await transaction.documentSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true },
      skip: this.maxAutomaticSnapshotsPerDocument,
      where: { documentId, label: null }
    });
    if (excessSnapshots.length === 0) return;

    await transaction.documentSnapshot.deleteMany({
      where: { id: { in: excessSnapshots.map((snapshot) => snapshot.id) } }
    });
  }

  private toSnapshotSummaryPayload(snapshot: { createdAt: Date; id: string; label: string | null }): DocumentSnapshotSummaryPayload {
    return {
      createdAt: snapshot.createdAt.toISOString(),
      id: snapshot.id,
      label: snapshot.label
    };
  }

  private toDocumentPayload(document: {
    canvasState: Prisma.JsonValue;
    content: string;
    id: string;
    language: string | null;
    position: number;
    title: string;
    type: DocumentType;
    updatedAt: Date;
  }): WorkspaceDocumentPayload {
    return {
      canvasState: document.canvasState,
      content: document.content,
      id: document.id,
      language: document.language,
      position: document.position,
      title: document.title,
      type: document.type,
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private toFileNodePayload(fileNode: {
    documentId: string | null;
    id: string;
    kind: FileNodeKind;
    name: string;
    parentId: string | null;
    position: number;
  }): WorkspaceFileNodePayload {
    return {
      documentId: fileNode.documentId,
      id: fileNode.id,
      kind: fileNode.kind,
      name: fileNode.name,
      parentId: fileNode.parentId,
      position: fileNode.position
    };
  }

  private toMemberPayload(member: {
    role: WorkspaceRole;
    user: {
      color: string;
      email: string;
      id: string;
      initials: string;
      name: string;
    };
  }): WorkspaceMemberPayload {
    return {
      color: member.user.color,
      email: member.user.email,
      id: member.user.id,
      initials: member.user.initials,
      name: member.user.name,
      role: member.role
    };
  }
}

export const workspaceRepository = new WorkspaceRepository();
