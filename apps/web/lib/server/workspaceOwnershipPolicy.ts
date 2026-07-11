import { prisma } from "./prisma";

type WorkspaceOwnershipClient = {
  workspaceMember: {
    count(input: {
      where: {
        role: "owner";
        userId: { not: string };
        workspaceId: string;
      };
    }): Promise<number>;
  };
};

export class WorkspaceOwnershipPolicy {
  constructor(private readonly client: WorkspaceOwnershipClient = prisma) {}

  assertMemberCanBeRemoved(actorUserId: string, memberUserId: string) {
    if (actorUserId === memberUserId) {
      throw new Error("You cannot remove yourself from the workspace");
    }
  }

  async requireAnotherOwner(workspaceId: string, userId: string) {
    const ownerCount = await this.client.workspaceMember.count({
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
}

export const workspaceOwnershipPolicy = new WorkspaceOwnershipPolicy();
