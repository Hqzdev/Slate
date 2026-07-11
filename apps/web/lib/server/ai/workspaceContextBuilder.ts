import { prisma } from "../prisma";
import { workspaceAccessPolicy } from "../workspaceAccessPolicy";
import { truncateDatabaseSafeText } from "../../databaseSafeText";
import { isAiReadableDocumentName, isAiReadableFileNode } from "./documentAccessPolicy";
import { AiDomainError } from "./errors";

type WorkspaceContextDocument = {
  canvasState: unknown;
  content: string;
  id: string;
  language: string | null;
  title: string;
  type: "canvas" | "code" | "note";
  updatedAt: Date;
};

type WorkspaceContextFileNode = {
  documentId: string | null;
  id: string;
  kind: "document" | "folder";
  name: string;
  parentId: string | null;
  position: number;
};

export type AiWorkspaceContext = {
  observations: AiDocumentObservation[];
  prompt: string;
};

export type AiDocumentObservation = {
  complete: boolean;
  content: string;
  id: string;
  title: string;
  type: "canvas" | "code" | "note";
  updatedAt: string;
};

const maxListedFiles = 200;
const maxInitialDocuments = 3;
const maxInitialDocumentChars = 6_000;
const maxReadDocumentChars = 12_000;
const maxPolicyFileNodes = 5_000;
const maxListWorkspaceResultChars = 32_000;

export class WorkspaceContextBuilder {
  async build(ownerUserId: string, workspaceId: string, activeDocumentId: string | null): Promise<AiWorkspaceContext> {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    const [workspace, documents, activeDocument, fileNodePolicy] = await Promise.all([
      prisma.workspace.findUnique({
        select: { id: true, name: true },
        where: { id: workspaceId }
      }),
      prisma.document.findMany({
        orderBy: { updatedAt: "desc" },
        select: { id: true, language: true, title: true, type: true, updatedAt: true },
        take: 80,
        where: { archivedAt: null, workspaceId }
      }),
      activeDocumentId
        ? prisma.document.findFirst({
            select: { canvasState: true, content: true, id: true, language: true, title: true, type: true, updatedAt: true },
            where: { archivedAt: null, id: activeDocumentId, workspaceId }
          })
        : Promise.resolve(null),
      this.loadFileNodePolicy(workspaceId)
    ]);
    if (!workspace) {
      throw new AiDomainError("workspace_not_found", "Workspace not found", 404);
    }
    const fileNodesById = new Map(fileNodePolicy.fileNodes.map((node) => [node.id, node]));
    const fileNodesByDocumentId = new Map(fileNodePolicy.fileNodes.flatMap((node) => node.documentId ? [[node.documentId, node] as const] : []));
    const isReadableDocument = (document: { id: string; title: string }) => {
      const fileNode = fileNodesByDocumentId.get(document.id);
      return Boolean(fileNode && isAiReadableDocumentName(document.title) && isAiReadableFileNode(fileNode, fileNodesById));
    };
    const readableDocuments = documents.filter(isReadableDocument);
    const contextActiveDocument = activeDocument && isReadableDocument(activeDocument) ? activeDocument : null;
    const contextActiveDocumentId = contextActiveDocument?.id ?? null;

    const selectedIds = [
      ...(contextActiveDocumentId ? [contextActiveDocumentId] : []),
      ...readableDocuments.filter((document) => document.id !== contextActiveDocumentId).slice(0, maxInitialDocuments - (contextActiveDocumentId ? 1 : 0)).map((document) => document.id)
    ];
    const recentSelectedIds = selectedIds.filter((id) => id !== contextActiveDocumentId);
    const selectedDocuments = recentSelectedIds.length > 0
      ? await prisma.document.findMany({
          select: { canvasState: true, content: true, id: true, language: true, title: true, type: true, updatedAt: true },
          where: { archivedAt: null, id: { in: recentSelectedIds }, workspaceId }
        })
      : [];
    const selectedById = new Map([...(contextActiveDocument ? [contextActiveDocument] : []), ...selectedDocuments].map((document) => [document.id, document]));
    const orderedSelectedDocuments = selectedIds.flatMap((id) => selectedById.get(id) ?? []);

    const fileSummary = readableDocuments.map((document) => ({
      id: document.id,
      language: document.language,
      title: document.title,
      type: document.type,
      updatedAt: document.updatedAt.toISOString()
    }));
    const excerpts = orderedSelectedDocuments.map((document) => this.documentExcerpt(document, maxInitialDocumentChars));
    const prompt = JSON.stringify({
      activeDocumentId: contextActiveDocumentId,
      documentExcerpts: excerpts,
      documents: fileSummary,
      workspace: { id: workspace.id, name: workspace.name }
    });

    return {
      observations: orderedSelectedDocuments.map((document) => this.documentObservation(document, maxInitialDocumentChars)),
      prompt
    };
  }

  async listWorkspaceFiles(ownerUserId: string, workspaceId: string) {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    const fileNodePolicy = await this.loadFileNodePolicy(workspaceId);
    const fileNodes = fileNodePolicy.fileNodes;
    const nodesById = new Map(fileNodes.map((node) => [node.id, node]));
    const readableFileNodes = fileNodes.filter((fileNode) => isAiReadableFileNode(fileNode, nodesById));
    const documentIds = readableFileNodes.flatMap((fileNode) => fileNode.documentId ? [fileNode.documentId] : []);
    const documents = documentIds.length > 0
      ? await prisma.document.findMany({
          select: { id: true, language: true, type: true, updatedAt: true },
          where: { archivedAt: null, id: { in: documentIds }, workspaceId }
        })
      : [];
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const readableNodesById = new Map(readableFileNodes.map((node) => [node.id, node]));
    const files = [];
    let sizeTruncated = false;
    for (const node of readableFileNodes.slice(0, maxListedFiles)) {
      const document = node.documentId ? documentsById.get(node.documentId) : null;
      const file = {
        documentId: node.documentId,
        id: node.id,
        kind: node.kind,
        language: document?.language ?? null,
        path: this.filePath(node, readableNodesById),
        type: document?.type ?? null,
        updatedAt: document?.updatedAt.toISOString() ?? null
      };
      const candidate = JSON.stringify({ files: [...files, file], restrictedFileCount: fileNodes.length - readableFileNodes.length, truncated: true });
      if (candidate.length > maxListWorkspaceResultChars) {
        sizeTruncated = true;
        break;
      }
      files.push(file);
    }
    return JSON.stringify({
      files,
      restrictedFileCount: fileNodes.length - readableFileNodes.length + (fileNodePolicy.truncated ? 1 : 0),
      truncated: fileNodePolicy.truncated || readableFileNodes.length > files.length || sizeTruncated
    });
  }

  async readDocument(ownerUserId: string, workspaceId: string, documentId: string) {
    return (await this.readDocumentObservation(ownerUserId, workspaceId, documentId)).prompt;
  }

  async readDocumentObservation(ownerUserId: string, workspaceId: string, documentId: string) {
    await workspaceAccessPolicy.requireWorkspaceReader(ownerUserId, workspaceId);
    const [document, fileNodePolicy] = await Promise.all([
      prisma.document.findFirst({
        select: { canvasState: true, content: true, id: true, language: true, title: true, type: true, updatedAt: true },
        where: { archivedAt: null, id: documentId, workspaceId }
      }),
      this.loadFileNodePolicy(workspaceId)
    ]);
    if (!document) {
      throw new AiDomainError("document_not_found", "Document not found in this workspace", 404);
    }
    const nodesById = new Map(fileNodePolicy.fileNodes.map((node) => [node.id, node]));
    const fileNode = fileNodePolicy.fileNodes.find((node) => node.documentId === document.id);
    if (!fileNode || !isAiReadableDocumentName(document.title) || !isAiReadableFileNode(fileNode, nodesById)) {
      throw new AiDomainError("document_restricted", "This document is excluded from AI context", 422);
    }
    return {
      observation: this.documentObservation(document, maxReadDocumentChars),
      prompt: JSON.stringify(this.documentExcerpt(document, maxReadDocumentChars))
    };
  }

  private documentExcerpt(document: WorkspaceContextDocument, limit: number) {
    const source = document.type === "canvas" ? JSON.stringify(document.canvasState ?? null) : document.content;
    return {
      content: truncateDatabaseSafeText(source, limit),
      id: document.id,
      language: document.language,
      title: document.title,
      truncated: source.length > limit,
      type: document.type,
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private documentObservation(document: WorkspaceContextDocument, limit: number): AiDocumentObservation {
    const content = document.type === "canvas" ? JSON.stringify(document.canvasState ?? null) : document.content;
    return {
      complete: content.length <= limit,
      content,
      id: document.id,
      title: document.title,
      type: document.type,
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private filePath(node: WorkspaceContextFileNode, nodesById: Map<string, WorkspaceContextFileNode>) {
    const names = [node.name];
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && names.length < 32) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = nodesById.get(parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return names.join("/");
  }

  private async loadFileNodePolicy(workspaceId: string) {
    const rows = await prisma.workspaceFileNode.findMany({
      orderBy: [{ parentId: "asc" }, { position: "asc" }, { id: "asc" }],
      select: { documentId: true, id: true, kind: true, name: true, parentId: true, position: true },
      take: maxPolicyFileNodes + 1,
      where: { archivedAt: null, workspaceId }
    });
    return {
      fileNodes: rows.slice(0, maxPolicyFileNodes),
      truncated: rows.length > maxPolicyFileNodes
    };
  }
}

export const workspaceContextBuilder = new WorkspaceContextBuilder();
