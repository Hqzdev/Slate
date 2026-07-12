import { createHash, randomBytes } from "node:crypto";
import { Prisma, type WorkspaceRole } from "@prisma/client";
import { activityRepository } from "./activityRepository";
import { auditLogService } from "./auditLog";
import { messengerProvisioningService } from "./messenger/provisioningService";
import { prisma } from "./prisma";
import { workspaceInvitePolicy } from "./workspaceInvitePolicy";

const inviteDurationMs = 1000 * 60 * 60 * 24 * 7;
const inviteRoles: WorkspaceRole[] = ["editor", "viewer"];

export class InviteRepository {
  async createInvite(input: { createdByUserId: string; email: string; role: WorkspaceRole; workspaceId: string }) {
    if (!inviteRoles.includes(input.role)) {
      throw new Error("Invite role must be editor or viewer");
    }

    const normalizedEmail = workspaceInvitePolicy.normalizeEmail(input.email);
    const token = randomBytes(32).toString("base64url");
    const invite = await this.runSerializable(async (transaction) => {
      await this.requireOwnerWithClient(transaction, input.createdByUserId, input.workspaceId);
      const recipient = await transaction.user.findUnique({ where: { email: normalizedEmail } });
      if (!recipient) throw new Error("No Slate account exists for this email");
      if (recipient.id === input.createdByUserId) throw new Error("You are already the workspace owner");
      const [existingMember, block] = await Promise.all([
        transaction.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: recipient.id, workspaceId: input.workspaceId } }
        }),
        transaction.workspaceBlock.findUnique({
          where: { userId_workspaceId: { userId: recipient.id, workspaceId: input.workspaceId } }
        })
      ]);
      if (existingMember) throw new Error("This user is already a workspace member");
      if (block) throw new Error("Unblock this user before inviting them again");
      const now = new Date();
      const replacedInvites = await transaction.workspaceInvite.findMany({
        select: { id: true },
        where: {
          acceptedAt: null,
          declinedAt: null,
          recipientUserId: recipient.id,
          revokedAt: null,
          workspaceId: input.workspaceId
        }
      });
      await transaction.workspaceInvite.updateMany({
        data: { revokedAt: now },
        where: {
          acceptedAt: null,
          declinedAt: null,
          recipientUserId: recipient.id,
          revokedAt: null,
          workspaceId: input.workspaceId
        }
      });
      if (replacedInvites.length > 0) {
        await transaction.userNotification.updateMany({
          data: { readAt: now },
          where: { inviteId: { in: replacedInvites.map((invite) => invite.id) }, readAt: null }
        });
      }
      const createdInvite = await transaction.workspaceInvite.create({
        data: {
          createdByUserId: input.createdByUserId,
          email: normalizedEmail,
          expiresAt: new Date(now.getTime() + inviteDurationMs),
          recipientUserId: recipient.id,
          role: input.role,
          tokenHash: this.hashToken(token),
          workspaceId: input.workspaceId
        },
        include: {
          createdBy: true,
          workspace: true
        }
      });
      await transaction.userNotification.create({
        data: {
          inviteId: createdInvite.id,
          recipientId: recipient.id,
          type: "workspace_invite",
          workspaceId: input.workspaceId
        }
      });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: input.createdByUserId,
        metadata: { email: normalizedEmail, inviteId: createdInvite.id, recipientUserId: recipient.id, role: input.role },
        type: "invite.created",
        workspaceId: input.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: input.createdByUserId,
        metadata: { email: normalizedEmail, inviteId: createdInvite.id, recipientUserId: recipient.id, role: input.role },
        targetUserId: recipient.id,
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
        workspaceId
      }
    });

    return invites.map((invite) => this.toInvitePayload(invite));
  }

  async revokeInvite(userId: string, workspaceId: string, inviteId: string) {
    await this.requireOwner(userId, workspaceId);
    return this.runSerializable(async (transaction) => {
      await this.requireOwnerWithClient(transaction, userId, workspaceId);
      const invite = await transaction.workspaceInvite.findFirst({ where: { id: inviteId, workspaceId } });
      if (!invite) throw new Error("Invite not found");
      if (invite.acceptedAt) throw new Error("Accepted invites cannot be revoked");
      if (invite.declinedAt) throw new Error("Declined invites cannot be revoked");
      if (invite.revokedAt) throw new Error("Invite already revoked");
      const now = new Date();
      const claimed = await transaction.workspaceInvite.updateMany({
        data: { revokedAt: now },
        where: { acceptedAt: null, declinedAt: null, id: invite.id, revokedAt: null }
      });
      if (claimed.count !== 1) throw new Error("Invite is no longer active");
      await transaction.userNotification.updateMany({ data: { readAt: now }, where: { inviteId: invite.id } });
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
      return { id: invite.id };
    });
  }

  async acceptInvite(userId: string, token: string) {
    const invite = await prisma.workspaceInvite.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!invite) throw new Error("Invite not found");
    return this.acceptInviteById(userId, invite.id);
  }

  async acceptInviteById(userId: string, inviteId: string) {
    const acceptedInvite = await this.runSerializable(async (transaction) => {
      const [invite, user] = await Promise.all([
        transaction.workspaceInvite.findUnique({
          include: { createdBy: true, workspace: true },
          where: { id: inviteId }
        }),
        transaction.user.findUnique({ where: { id: userId } })
      ]);
      if (!invite) throw new Error("Invite not found");
      if (!user) throw new Error("User not found");
      workspaceInvitePolicy.assertCanAccept(invite, user);
      const [block, existingMember] = await Promise.all([
        transaction.workspaceBlock.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } }
        }),
        transaction.workspaceMember.findUnique({
          where: {
            userId_workspaceId: {
              userId,
              workspaceId: invite.workspaceId
            }
          }
        })
      ]);
      if (block) throw new Error("Workspace access is blocked");
      const nextRole = existingMember ? this.highestRole(existingMember.role, invite.role) : invite.role;
      const roleChanged = Boolean(existingMember && existingMember.role !== nextRole);
      const member = await transaction.workspaceMember.upsert({
        create: { role: nextRole, userId, workspaceId: invite.workspaceId },
        update: {
          messengerAccessVersion: roleChanged ? { increment: 1 } : undefined,
          role: nextRole
        },
        where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } }
      });
      const now = new Date();
      const claimed = await transaction.workspaceInvite.updateMany({
        data: { acceptedAt: now, acceptedByUserId: userId },
        where: {
          acceptedAt: null,
          declinedAt: null,
          id: invite.id,
          revokedAt: null
        }
      });
      if (claimed.count !== 1) throw new Error("Invite is no longer active");
      await messengerProvisioningService.activateGeneralMember(transaction, {
        member,
        now,
        reason: "invite_accepted"
      });
      if (existingMember && roleChanged) {
        await messengerProvisioningService.appendCapabilitiesChanged(transaction, {
          actorUserId: userId,
          member,
          previousRole: existingMember.role
        });
      }
      await transaction.userNotification.updateMany({
        data: { readAt: now },
        where: { inviteId: invite.id }
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
      return transaction.workspaceInvite.findUniqueOrThrow({
        include: { createdBy: true, workspace: true },
        where: { id: invite.id }
      });
    });

    return this.toInvitePayload(acceptedInvite);
  }

  async declineInvite(userId: string, inviteId: string) {
    return this.runSerializable(async (transaction) => {
      const invite = await transaction.workspaceInvite.findUnique({ where: { id: inviteId } });
      if (!invite) throw new Error("Invite not found");
      workspaceInvitePolicy.assertCanDecline(invite, userId);
      if (invite.declinedAt) return { id: invite.id };
      const declinedAt = new Date();
      const claimed = await transaction.workspaceInvite.updateMany({
        data: { declinedAt },
        where: { acceptedAt: null, declinedAt: null, id: invite.id, revokedAt: null }
      });
      if (claimed.count !== 1) throw new Error("Invite is no longer active");
      await transaction.userNotification.updateMany({ data: { readAt: declinedAt }, where: { inviteId: invite.id } });
      await activityRepository.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { email: invite.email, inviteId: invite.id, role: invite.role },
        type: "invite.declined",
        workspaceId: invite.workspaceId
      });
      await auditLogService.recordWithClient(transaction, {
        actorUserId: userId,
        metadata: { inviteId: invite.id },
        targetUserId: userId,
        type: "invite.declined",
        workspaceId: invite.workspaceId
      });
      return { id: invite.id };
    });
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

  private async requireOwnerWithClient(transaction: Prisma.TransactionClient, userId: string, workspaceId: string) {
    const [member, block] = await Promise.all([
      transaction.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } }
      }),
      transaction.workspaceBlock.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } }
      })
    ]);
    if (block || member?.role !== "owner") {
      throw new Error("Only workspace owners can manage invites");
    }
    return member;
  }

  private async runSerializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Invite transaction failed");
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
    declinedAt: Date | null;
    revokedAt: Date | null;
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
      declinedAt: invite.declinedAt?.toISOString() ?? null,
      revokedAt: invite.revokedAt?.toISOString() ?? null,
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
