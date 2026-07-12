type InviteLifecycle = {
  acceptedAt: Date | null;
  declinedAt: Date | null;
  email: string | null;
  expiresAt: Date;
  recipientUserId: string | null;
  revokedAt: Date | null;
};

type InviteRecipient = {
  email: string;
  id: string;
};

export class WorkspaceInvitePolicy {
  normalizeEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new Error("Email is required");
    return normalizedEmail;
  }

  assertCanAccept(invite: InviteLifecycle, recipient: InviteRecipient, now = new Date()) {
    if (invite.acceptedAt) throw new Error("Invite already accepted");
    if (invite.declinedAt) throw new Error("Invite was declined");
    if (invite.revokedAt) throw new Error("Invite was revoked");
    if (invite.expiresAt <= now) throw new Error("Invite expired");
    if (invite.recipientUserId && invite.recipientUserId !== recipient.id) throw new Error("Invite belongs to a different account");
    if (invite.email && invite.email !== recipient.email) throw new Error("Invite is for a different email");
  }

  assertCanDecline(invite: InviteLifecycle, userId: string) {
    if (invite.recipientUserId !== userId) throw new Error("Invite belongs to a different account");
    if (invite.acceptedAt) throw new Error("Invite already accepted");
    if (invite.revokedAt) throw new Error("Invite was revoked");
  }
}

export const workspaceInvitePolicy = new WorkspaceInvitePolicy();
