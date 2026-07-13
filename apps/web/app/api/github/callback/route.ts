import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { githubAppService } from "@/lib/server/githubAppService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  const fallback = new URL("/workspace?view=dashboard&github=failed", request.nextUrl.origin);
  if (!user) return NextResponse.redirect(fallback);
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  try {
    const result = await githubAppService.completeConnection({ code, installationId, state, userId: user.id });
    const target = new URL("/workspace", request.nextUrl.origin);
    target.searchParams.set("github", "connected");
    target.searchParams.set("view", "dashboard");
    target.searchParams.set("workspace", result.workspaceId);
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(fallback);
  }
}
