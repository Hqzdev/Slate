import { NextRequest, NextResponse } from "next/server";
import { type WorkspaceRole } from "@prisma/client";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { inviteRepository } from "@/lib/server/inviteRepository";

export const runtime = "nodejs";

const roles = new Set<WorkspaceRole>(["editor", "viewer"]);

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { workspaceId } = await context.params;

  try {
    const invites = await inviteRepository.getWorkspaceInvites(user.id, workspaceId);
    return NextResponse.json({ invites });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invites failed to load" }, { status: 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "invites:create", windowMs: 60_000 });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const role = body.role;

  if (!roles.has(role)) {
    return NextResponse.json({ error: "Role must be viewer or editor" }, { status: 400 });
  }

  const { workspaceId } = await context.params;

  try {
    const result = await inviteRepository.createInvite({
      createdByUserId: user.id,
      email: typeof body.email === "string" ? body.email : null,
      role,
      workspaceId
    });

    return NextResponse.json({
      invite: result.invite,
      url: `${request.nextUrl.origin}/invite/${result.token}`
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invite creation failed" }, { status: 403 });
  }
}
