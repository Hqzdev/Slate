import { createHash, randomBytes } from "node:crypto";
import { type WorkspaceRole } from "@prisma/client";
import { activityRepository } from "@/lib/server/activityRepository";
import { auditLogService } from "@/lib/server/auditLog";
import { prisma } from "@/lib/server/prisma";

const inviteDurationMs = 1000 * 60 * 60 * 24 * 7;
const inviteRoles: WorkspaceRole[] = ["editor", "viewer"];

export class InviteRepository {
  async createInvite(input: { createdByUserId: string; email?: string | null; role: WorkspaceRole; workspaceId: string }) {
    if (!inviteRoles.includes(input.role)) {
      throw new Error("Invite role must be editor or viewer");
    }

    await this.requireOwner(input.createdByUserId, input.workspaceId);

    const token = randomBytes(32).toString("base64url");
    const normalizedEmail = input.email?.trim().toLowerCase() || null;
    await prisma.workspaceInvite.deleteMany({
      where: {
        acceptedAt: null,
        email: normalizedEmail,
        expiresAt: { gt: new Date() },
        workspaceId: input.workspaceId
      }
    });
    const invite = await prisma.$transaction(async (transaction) => {
      const createdInvite = await transaction.workspaceInvite.create({
        data: {
          createdByUserId: input.createdByUserId,
          email: normalizedEmail,
          expiresAt: new Date(Date.now() + inviteDurationMs),
          role: input.role,
          tokenHash: this.hashToken(token),
          workspaceId: input.workspaceId
        },
        include: {
          createdBy: true,
          workspace: true
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: input.createdByUserId,
        metadata: { email: normalizedEmail, inviteId: createdInvite.id, role: input.role },
        type: "invite.created",
        workspaceId: input.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: input.createdByUserId,
        metadata: { email: normalizedEmail, inviteId: createdInvite.id, role: input.role },
        type: "invite.created",
        workspaceId: input.workspaceId
      });
      return createdInvite;
    });

    return {
      invite: this.toInvitePayload(invite),
      token
    };
  }

  async getInvite(token: string) {
    const invite = await prisma.workspaceInvite.findUnique({
      include: {
        createdBy: true,
        workspace: true
      },
      where: { tokenHash: this.hashToken(token) }
    });

    if (!invite) return null;
    return this.toInvitePayload(invite);
  }

  async getWorkspaceInvites(userId: string, workspaceId: string) {
    await this.requireOwner(userId, workspaceId);

    const invites = await prisma.workspaceInvite.findMany({
      include: {
        createdBy: true,
        workspace: true
      },
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
        workspaceId
      }
    });

    return invites.map((invite) => this.toInvitePayload(invite));
  }

  async revokeInvite(userId: string, workspaceId: string, inviteId: string) {
    await this.requireOwner(userId, workspaceId);
    const invite = await prisma.workspaceInvite.findFirst({
      where: {
        id: inviteId,
        workspaceId
      }
    });

    if (!invite) {
      throw new Error("Invite not found");
    }

    if (invite.acceptedAt) {
      throw new Error("Accepted invites cannot be revoked");
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.workspaceInvite.delete({ where: { id: invite.id } });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { email: invite.email, inviteId: invite.id, role: invite.role },
        type: "invite.revoked",
        workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { email: invite.email, inviteId: invite.id, role: invite.role },
        type: "invite.revoked",
        workspaceId
      });
    });
    return { id: invite.id };
  }

  async acceptInvite(userId: string, token: string) {
    const invite = await prisma.workspaceInvite.findUnique({
      include: {
        createdBy: true,
        workspace: true
      },
      where: { tokenHash: this.hashToken(token) }
    });

    if (!invite) {
      throw new Error("Invite not found");
    }

    if (invite.acceptedAt) {
      throw new Error("Invite already accepted");
    }

    if (invite.expiresAt <= new Date()) {
      throw new Error("Invite expired");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (invite.email && invite.email !== user.email) {
      throw new Error("Invite is for a different email");
    }

    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: invite.workspaceId
        }
      }
    });

    const nextRole = existingMember ? this.highestRole(existingMember.role, invite.role) : invite.role;

    const acceptedInvite = await prisma.$transaction(async (transaction) => {
      await transaction.workspaceMember.upsert({
        create: {
          role: nextRole,
          userId,
          workspaceId: invite.workspaceId
        },
        update: {
          role: nextRole
        },
        where: {
          userId_workspaceId: {
            userId,
            workspaceId: invite.workspaceId
          }
        }
      });

      const updatedInvite = await transaction.workspaceInvite.update({
        data: {
          acceptedAt: new Date(),
          acceptedByUserId: userId
        },
        include: {
          createdBy: true,
          workspace: true
        },
        where: { id: invite.id }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { email: invite.email, inviteId: invite.id, role: nextRole },
        type: "invite.accepted",
        workspaceId: invite.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { email: invite.email, inviteId: invite.id, role: nextRole },
        type: "invite.accepted",
        workspaceId: invite.workspaceId
      });
      return updatedInvite;
    });

    return this.toInvitePayload(acceptedInvite);
  }

  private async requireOwner(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId
        }
      }
    });

    if (member?.role !== "owner") {
      throw new Error("Only workspace owners can manage invites");
    }
  }

  private highestRole(currentRole: WorkspaceRole, invitedRole: WorkspaceRole) {
    const ranks: Record<WorkspaceRole, number> = {
      editor: 2,
      owner: 3,
      viewer: 1
    };

    return ranks[currentRole] >= ranks[invitedRole] ? currentRole : invitedRole;
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("base64url");
  }

  private toInvitePayload(invite: {
    acceptedAt: Date | null;
    createdAt: Date;
    createdBy: { name: string };
    email: string | null;
    expiresAt: Date;
    id: string;
    role: WorkspaceRole;
    workspace: { id: string; name: string; slug: string };
  }) {
    return {
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
      createdByName: invite.createdBy.name,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      id: invite.id,
      role: invite.role,
      workspace: {
        id: invite.workspace.id,
        name: invite.workspace.name,
        slug: invite.workspace.slug
      }
    };
  }
}

export const inviteRepository = new InviteRepository();
