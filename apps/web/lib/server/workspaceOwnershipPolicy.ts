export class WorkspaceOwnershipPolicy {
  assertMemberCanBeRemoved(actorUserId: string, memberUserId: string) {
    if (actorUserId === memberUserId) {
      throw new Error("You cannot remove yourself from the workspace");
    }
  }

  assertTransferConfirmation(workspaceName: string, confirmationName: string) {
    if (confirmationName !== workspaceName) {
      throw new Error("Workspace name confirmation does not match");
    }
  }
}

export const workspaceOwnershipPolicy = new WorkspaceOwnershipPolicy();
