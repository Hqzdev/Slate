import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ memberUserId: string; workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "members:block" });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { memberUserId, workspaceId } = await context.params;

  try {
    return NextResponse.json({ blockedUser: await workspaceRepository.blockWorkspaceMember(user.id, workspaceId, memberUserId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Member block failed" }, { status: 403 });
  }
}
