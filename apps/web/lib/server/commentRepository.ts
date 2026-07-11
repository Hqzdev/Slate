import { prisma } from "@/lib/server/prisma";
import { activityRepository } from "@/lib/server/activityRepository";
import { normalizeCommentLineRange } from "@/lib/comments/commentLineRange";

export type DocumentCommentPayload = {
  authorName: string;
  body: string;
  createdAt: string;
  documentId: string;
  fileNodeId: string | null;
  id: string;
  lineEnd: number | null;
  lineStart: number | null;
  resolvedAt: string | null;
  shapeId: string | null;
  updatedAt: string;
};

export class CommentRepository {
  async listDocumentComments(userId: string, documentId: string): Promise<DocumentCommentPayload[]> {
    const document = await this.requireDocumentReader(userId, documentId);
    const comments = await prisma.documentComment.findMany({
      include: { author: { select: { name: true } } },
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      where: {
        documentId: document.id,
        workspaceId: document.workspaceId
      }
    });

    return comments.map((comment) => this.toPayload(comment));
  }

  async listWorkspaceComments(userId: string, workspaceId: string, limit = 20): Promise<DocumentCommentPayload[]> {
    await this.requireWorkspaceMember(userId, workspaceId);
    const comments = await prisma.documentComment.findMany({
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
      where: {
        document: { archivedAt: null },
        workspaceId
      }
    });

    return comments.map((comment) => this.toPayload(comment));
  }

  async createDocumentComment(userId: string, documentId: string, input: { body: string; fileNodeId?: string | null; lineEnd?: unknown; lineStart?: unknown; shapeId?: string | null }) {
    const document = await this.requireDocumentEditor(userId, documentId);
    const body = input.body.trim();
    const lineRange = normalizeCommentLineRange(input.lineStart, input.lineEnd);
    const fileNodeId = input.fileNodeId?.trim() || null;
    const shapeId = input.shapeId?.trim() || null;

    if (body.length === 0) {
      throw new Error("Comment body is required");
    }

    if (body.length > 4000) {
      throw new Error("Comment body is too long");
    }

    if (lineRange && shapeId) {
      throw new Error("Comment context is ambiguous");
    }

    if (lineRange) {
      if (document.type !== "code") throw new Error("Line comments require a code document");
      if (lineRange.end > document.content.split("\n").length) throw new Error("Comment line range is outside the document");
    }

    if (shapeId) {
      if (document.type !== "canvas") throw new Error("Shape comments require a canvas document");
      if (!this.canvasHasShape(document.canvasState, shapeId)) throw new Error("Comment shape context is unavailable");
    }

    if (fileNodeId) {
      const fileNode = await prisma.workspaceFileNode.findFirst({
        select: { id: true },
        where: { archivedAt: null, documentId: document.id, id: fileNodeId, workspaceId: document.workspaceId }
      });
      if (!fileNode) throw new Error("Comment file context is unavailable");
    }

    const comment = await prisma.$transaction(async (transaction) => {
      const createdComment = await transaction.documentComment.create({
        include: { author: { select: { name: true } } },
        data: {
          authorUserId: userId,
          body,
          documentId: document.id,
          fileNodeId,
          lineEnd: lineRange?.end ?? null,
          lineStart: lineRange?.start ?? null,
          shapeId,
          workspaceId: document.workspaceId
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        documentId: document.id,
        metadata: { commentId: createdComment.id },
        type: "comment.created",
        workspaceId: document.workspaceId
      });
      return createdComment;
    });

    return this.toPayload(comment);
  }

  async updateDocumentComment(userId: string, commentId: string, input: { body?: string; resolved?: boolean }) {
    const comment = await prisma.documentComment.findUniqueOrThrow({
      include: { author: true, document: true },
      where: { id: commentId }
    });
    await this.requireDocumentReader(userId, comment.documentId);

    const canEditBody = comment.authorUserId === userId;
    const canResolve = await this.canResolveComment(userId, comment.workspaceId);
    const data: { body?: string; resolvedAt?: Date | null } = {};

    if (input.body !== undefined) {
      if (!canEditBody) {
        throw new Error("Only the author can edit this comment");
      }
      const body = input.body.trim();
      if (body.length === 0) {
        throw new Error("Comment body is required");
      }
      if (body.length > 4000) {
        throw new Error("Comment body is too long");
      }
      data.body = body;
    }

    if (input.resolved !== undefined) {
      if (!canResolve && comment.authorUserId !== userId) {
        throw new Error("Comment resolve denied");
      }
      data.resolvedAt = input.resolved ? new Date() : null;
    }

    const updatedComment = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.documentComment.update({
        include: { author: { select: { name: true } } },
        data,
        where: { id: comment.id }
      });
      if (input.resolved !== undefined) {
        await activityRepository.recordWithClient(transaction, {
          actorUserId: userId,
          documentId: comment.documentId,
          metadata: { commentId: comment.id },
          type: input.resolved ? "comment.resolved" : "comment.reopened",
          workspaceId: comment.workspaceId
        });
      }
      return updated;
    });

    return this.toPayload(updatedComment);
  }

  private async requireWorkspaceMember(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId
        }
      }
    });

    if (!member) {
      throw new Error("Workspace access denied");
    }

    return member;
  }

  private async requireDocumentReader(userId: string, documentId: string) {
    const document = await prisma.document.findFirstOrThrow({
      select: { id: true, workspaceId: true },
      where: { archivedAt: null, id: documentId }
    });
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: document.workspaceId
        }
      }
    });

    if (!member) {
      throw new Error("Workspace access denied");
    }

    return document;
  }

  private async requireDocumentEditor(userId: string, documentId: string) {
    const document = await prisma.document.findFirstOrThrow({
      select: { canvasState: true, content: true, id: true, type: true, workspaceId: true },
      where: { archivedAt: null, id: documentId }
    });
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: document.workspaceId
        }
      }
    });

    if (!member || (member.role !== "owner" && member.role !== "editor")) {
      throw new Error("Workspace access denied");
    }

    return document;
  }

  private canvasHasShape(canvasState: unknown, shapeId: string) {
    if (!canvasState || typeof canvasState !== "object") return false;
    const shapes = (canvasState as { shapes?: unknown }).shapes;
    return Array.isArray(shapes) && shapes.some((shape) => shape && typeof shape === "object" && (shape as { id?: unknown }).id === shapeId);
  }

  private async canResolveComment(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId
        }
      }
    });

    return member?.role === "owner" || member?.role === "editor";
  }

  private toPayload(comment: {
    author: { name: string };
    body: string;
    createdAt: Date;
    documentId: string;
    fileNodeId: string | null;
    id: string;
    lineEnd: number | null;
    lineStart: number | null;
    resolvedAt: Date | null;
    shapeId: string | null;
    updatedAt: Date;
  }): DocumentCommentPayload {
    return {
      authorName: comment.author.name,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      documentId: comment.documentId,
      fileNodeId: comment.fileNodeId,
      id: comment.id,
      lineEnd: comment.lineEnd,
      lineStart: comment.lineStart,
      resolvedAt: comment.resolvedAt?.toISOString() ?? null,
      shapeId: comment.shapeId,
      updatedAt: comment.updatedAt.toISOString()
    };
  }
}

export const commentRepository = new CommentRepository();
