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
    return NextResponse.json({ repositories: await githubAppService.listRepositories(user.id, workspaceId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub repositories are unavailable" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "github:repository", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { branch?: unknown; repositoryId?: unknown } | null;
  if (typeof body?.branch !== "string" || typeof body.repositoryId !== "string") return NextResponse.json({ error: "repositoryId and branch are required" }, { status: 400 });
  try {
    const { workspaceId } = await context.params;
    return NextResponse.json({ repository: await githubAppService.selectRepository(user.id, workspaceId, { branch: body.branch, repositoryId: body.repositoryId }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub repository selection failed" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}
