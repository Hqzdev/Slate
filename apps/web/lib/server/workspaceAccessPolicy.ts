import type { DocumentType, WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";

const writerRoles = new Set<WorkspaceRole>(["owner", "editor"]);

export type RealtimeRoomGrant = {
  canWrite: boolean;
  color: string;
  documentId: string;
  documentType: DocumentType;
  email: string;
  id: string;
  initials: string;
  name: string;
  role: WorkspaceRole;
  roomName: string;
  workspaceId: string;
};

type WorkspaceAccessClient = {
  document: {
    findFirst(input: {
      select: { id: true };
      where: {
        archivedAt: null;
        id: string;
        type: DocumentType;
        workspaceId: string;
      };
    }): Promise<{ id: string } | null>;
  };
  workspaceMember: {
    findUnique(input: {
      include?: { user: true };
      where: {
        userId_workspaceId: {
          userId: string;
          workspaceId: string;
        };
      };
    }): Promise<{
      role: WorkspaceRole;
      user?: {
        color: string;
        email: string;
        id: string;
        initials: string;
        name: string;
      };
    } | null>;
  };
};

export class WorkspaceAccessPolicy {
  constructor(private readonly client: WorkspaceAccessClient = prisma) {}

  async requireWorkspaceRole(userId: string, workspaceId: string, roles: WorkspaceRole[]) {
    const member = await this.client.workspaceMember.findUnique({
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

  async requireWorkspaceReader(userId: string, workspaceId: string) {
    return this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
  }

  async requireWorkspaceWriter(userId: string, workspaceId: string) {
    return this.requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
  }

  async requireWorkspaceOwner(userId: string, workspaceId: string) {
    return this.requireWorkspaceRole(userId, workspaceId, ["owner"]);
  }

  async authorizeRealtimeRoom(userId: string, roomName: string): Promise<RealtimeRoomGrant | null> {
    const parsedRoom = this.parseRoomName(roomName);
    if (!parsedRoom) return null;

    const member = await this.client.workspaceMember.findUnique({
      include: { user: true },
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: parsedRoom.workspaceId
        }
      }
    });

    if (!member) return null;
    if (!member.user) return null;

    const document = await this.client.document.findFirst({
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
      canWrite: writerRoles.has(member.role),
      color: member.user.color,
      documentId: parsedRoom.documentId,
      documentType: parsedRoom.documentType,
      email: member.user.email,
      id: member.user.id,
      initials: member.user.initials,
      name: member.user.name,
      role: member.role,
      roomName,
      workspaceId: parsedRoom.workspaceId
    };
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
}

export const workspaceAccessPolicy = new WorkspaceAccessPolicy();
