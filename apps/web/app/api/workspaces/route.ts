import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

function workspaceErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (error.message.includes("Can't reach database server")) return "Database is unavailable. Start Postgres and try again.";
  return error.message;
}

export async function GET(request: NextRequest) {
  try {
    const user = await authService.getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const payload = await workspaceRepository.getWorkspacePayload(user.id, workspaceId);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: workspaceErrorMessage(error, "Workspace failed to load") }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await guardMutationRequest(request, { limit: 20, scope: "workspaces:create", windowMs: 60_000 });
    if (denied) return denied;

    const user = await authService.getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const workspaceName = typeof body.name === "string" ? body.name.trim() : "";
    if (workspaceName && !/^[a-z0-9-]+$/.test(workspaceName)) {
      return NextResponse.json({ error: "Workspace name must use lowercase letters, numbers, and hyphens" }, { status: 400 });
    }

    const workspace = await workspaceRepository.createDefaultWorkspaceForUser(user.id, user.name, workspaceName || undefined);
    const payload = await workspaceRepository.getWorkspacePayload(user.id, workspace.id);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: workspaceErrorMessage(error, "Workspace creation failed") }, { status: 500 });
  }
}
