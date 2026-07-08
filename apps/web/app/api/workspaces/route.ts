import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const payload = await workspaceRepository.getWorkspacePayload(user.id, workspaceId);
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const workspace = await workspaceRepository.createDefaultWorkspaceForUser(user.id, user.name);
    const payload = await workspaceRepository.getWorkspacePayload(user.id, workspace.id);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Workspace creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
