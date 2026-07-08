import { NextRequest, NextResponse } from "next/server";
import { type WorkspaceRole } from "@prisma/client";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const roles = new Set<WorkspaceRole>(["owner", "editor", "viewer"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ memberUserId: string; workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const role = body.role;

  if (!roles.has(role)) {
    return NextResponse.json({ error: "Role must be owner, editor, or viewer" }, { status: 400 });
  }

  const { memberUserId, workspaceId } = await context.params;

  try {
    const member = await workspaceRepository.updateWorkspaceMemberRole(user.id, workspaceId, memberUserId, role);
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Member update failed" }, { status: 403 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ memberUserId: string; workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { memberUserId, workspaceId } = await context.params;

  try {
    await workspaceRepository.removeWorkspaceMember(user.id, workspaceId, memberUserId);
    return NextResponse.json({ userId: memberUserId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Member removal failed" }, { status: 403 });
  }
}
