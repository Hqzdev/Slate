import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { inviteRepository } from "@/lib/server/inviteRepository";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ inviteId: string; workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { inviteId, workspaceId } = await context.params;

  try {
    const invite = await inviteRepository.revokeInvite(user.id, workspaceId, inviteId);
    return NextResponse.json({ invite });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invite revoke failed" }, { status: 403 });
  }
}
