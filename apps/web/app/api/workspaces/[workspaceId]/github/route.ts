import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { githubAppService } from "@/lib/server/githubAppService";
import { GitHubAppError } from "@/lib/server/githubAppInput";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId } = await context.params;
    return NextResponse.json(await githubAppService.getStatus(user.id, workspaceId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub status is unavailable" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 10, scope: "github:disconnect", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId } = await context.params;
    await githubAppService.disconnect(user.id, workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub disconnect failed" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}
