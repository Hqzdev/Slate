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
    return NextResponse.json(await githubAppService.previewRemoteChanges(user.id, workspaceId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub refresh failed" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 10, scope: "github:refresh", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { expectedHeadSha?: unknown } | null;
  if (typeof body?.expectedHeadSha !== "string") return NextResponse.json({ error: "expectedHeadSha is required" }, { status: 400 });
  try {
    const { workspaceId } = await context.params;
    return NextResponse.json(await githubAppService.applyRemoteChanges(user.id, workspaceId, { expectedHeadSha: body.expectedHeadSha }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub refresh failed" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}
