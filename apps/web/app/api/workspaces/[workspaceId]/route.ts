import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

function workspaceError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (error.message === "Workspace access denied") return error.message;
  if (error.message.includes("Can't reach database server")) return "Database is unavailable. Start Postgres and try again.";
  return error.message;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "workspaces:update" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  const { workspaceId } = await context.params;

  try {
    const workspace = await workspaceRepository.updateWorkspaceIdentity(user.id, workspaceId, { name });
    return NextResponse.json({ workspace });
  } catch (error) {
    const status = error instanceof Error && error.message === "Workspace access denied" ? 403 : 400;
    return NextResponse.json({ error: workspaceError(error, "Workspace update failed") }, { status });
  }
}
