import { Prisma, type PrismaClient, type WorkspaceRole } from "@prisma/client";
import { prisma } from "../prisma";
import { workspaceAccessPolicy } from "../workspaceAccessPolicy";
import { MessengerDomainError } from "./errors";

type ConversationMembership = Prisma.MessengerConversationMemberGetPayload<{
  include: { conversation: true };
}>;

type MessengerAccessClient = Pick<PrismaClient, "messengerConversationMember" | "workspaceBlock" | "workspaceMember">;

type WorkspaceReaderPolicy = {
  requireWorkspaceReader(userId: string, workspaceId: string): Promise<{ role: WorkspaceRole }>;
};

const writerRoles = new Set<WorkspaceRole>(["owner", "editor"]);

export class MessengerAccessPolicy {
  constructor(
    private readonly client: MessengerAccessClient = prisma,
    private readonly workspacePolicy: WorkspaceReaderPolicy = workspaceAccessPolicy
  ) {}

  async requireWorkspaceReader(userId: string, workspaceId: string) {
    try {
      return await this.workspacePolicy.requireWorkspaceReader(userId, workspaceId);
    } catch {
      throw new MessengerDomainError("resource_not_found", "Resource was not found", 404);
    }
  }

  async requireConversationReader(userId: string, workspaceId: string, conversationId: string) {
    await this.requireWorkspaceReader(userId, workspaceId);
    return this.requireVisibleMembership(this.client, userId, workspaceId, conversationId);
  }

  async requireRealtimeWorkspaceAccess(userId: string, workspaceId: string) {
    await this.requireWorkspaceReader(userId, workspaceId);
    return this.requireWorkspaceAccessWithClient(this.client, userId, workspaceId, false);
  }

  async requireConversationWriter(userId: string, workspaceId: string, conversationId: string) {
    const workspaceMember = await this.requireWorkspaceReader(userId, workspaceId);
    if (!writerRoles.has(workspaceMember.role)) {
      throw new MessengerDomainError("workspace_write_denied", "Workspace role is read-only", 403);
    }
    const membership = await this.requireVisibleMembership(this.client, userId, workspaceId, conversationId);
    await this.requireConversationWritable(this.client, membership);
    return membership;
  }

  async requireConversationReaderWithClient(
    client: MessengerAccessClient,
    userId: string,
    workspaceId: string,
    conversationId: string
  ) {
    await this.requireWorkspaceAccessWithClient(client, userId, workspaceId, false);
    const membership = await this.requireVisibleMembership(client, userId, workspaceId, conversationId);
    await this.requireConversationWritable(client, membership);
    return membership;
  }

  async requireConversationWriterWithClient(
    client: MessengerAccessClient,
    userId: string,
    workspaceId: string,
    conversationId: string
  ) {
    await this.requireWorkspaceAccessWithClient(client, userId, workspaceId, true);
    return this.requireVisibleMembership(client, userId, workspaceId, conversationId);
  }

  private async requireWorkspaceAccessWithClient(
    client: MessengerAccessClient,
    userId: string,
    workspaceId: string,
    requireWriter: boolean
  ) {
    const [member, block] = await Promise.all([
      client.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } }
      }),
      client.workspaceBlock.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } }
      })
    ]);
    if (!member || block) {
      throw new MessengerDomainError("resource_not_found", "Resource was not found", 404);
    }
    if (requireWriter && !writerRoles.has(member.role)) {
      throw new MessengerDomainError("workspace_write_denied", "Workspace role is read-only", 403);
    }
    return member;
  }

  private async requireVisibleMembership(
    client: MessengerAccessClient,
    userId: string,
    workspaceId: string,
    conversationId: string
  ): Promise<ConversationMembership> {
    const membership = await client.messengerConversationMember.findFirst({
      include: { conversation: true },
      where: {
        conversation: { workspaceId },
        conversationId,
        state: "active",
        userId
      }
    });
    if (!membership) {
      throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
    }
    if (membership.conversation.kind === "direct" && !membership.conversation.activatedAt && !membership.openedAt) {
      throw new MessengerDomainError("conversation_not_found", "Conversation was not found", 404);
    }
    return membership;
  }

  private async requireConversationWritable(client: MessengerAccessClient, membership: ConversationMembership) {
    if (membership.conversation.kind !== "direct") return;
    const activeMembers = await client.messengerConversationMember.findMany({
      select: { userId: true },
      where: { conversationId: membership.conversationId, state: "active" }
    });
    if (activeMembers.length !== 2) {
      throw new MessengerDomainError("conversation_inactive", "Direct conversation is inactive", 409);
    }
    const activeUserIds = activeMembers.map((member) => member.userId);
    const [workspaceMembers, blocks] = await Promise.all([
      client.workspaceMember.findMany({ where: { userId: { in: activeUserIds }, workspaceId: membership.conversation.workspaceId } }),
      client.workspaceBlock.findMany({ where: { userId: { in: activeUserIds }, workspaceId: membership.conversation.workspaceId } })
    ]);
    if (workspaceMembers.length !== 2 || blocks.length > 0) {
      throw new MessengerDomainError("conversation_inactive", "Direct conversation is inactive", 409);
    }
  }
}

export const messengerAccessPolicy = new MessengerAccessPolicy();
