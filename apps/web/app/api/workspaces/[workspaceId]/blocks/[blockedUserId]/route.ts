import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ blockedUserId: string; workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "members:unblock" });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { blockedUserId, workspaceId } = await context.params;

  try {
    return NextResponse.json(await workspaceRepository.unblockWorkspaceUser(user.id, workspaceId, blockedUserId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Member unblock failed" }, { status: 403 });
  }
}
