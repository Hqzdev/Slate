import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { githubAppService } from "@/lib/server/githubAppService";
import { GitHubAppError } from "@/lib/server/githubAppInput";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "github:commit", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { expectedHeadSha?: unknown; message?: unknown } | null;
  if (typeof body?.expectedHeadSha !== "string" || typeof body.message !== "string") return NextResponse.json({ error: "expectedHeadSha and message are required" }, { status: 400 });
  try {
    const { workspaceId } = await context.params;
    return NextResponse.json(await githubAppService.commit(user.id, workspaceId, { expectedHeadSha: body.expectedHeadSha, message: body.message }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub commit failed" }, { status: error instanceof GitHubAppError ? error.status : 403 });
  }
}
