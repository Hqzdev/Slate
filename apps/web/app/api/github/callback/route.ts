import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { githubAppService } from "@/lib/server/githubAppService";

export const runtime = "nodejs";

function applicationOrigin(request: NextRequest) {
  const configuredUrl = process.env.APP_URL?.trim();
  if (!configuredUrl) return request.nextUrl.origin;
  try {
    const url = new URL(configuredUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : request.nextUrl.origin;
  } catch {
    return request.nextUrl.origin;
  }
}

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  const origin = applicationOrigin(request);
  const fallback = new URL("/workspace?view=dashboard&github=failed", origin);
  if (!user) return NextResponse.redirect(fallback);
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  try {
    const result = await githubAppService.completeConnection({ code, installationId, state, userId: user.id });
    const target = new URL("/workspace", origin);
    target.searchParams.set("github", "connected");
    target.searchParams.set("view", "dashboard");
    target.searchParams.set("workspaceId", result.workspaceId);
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(fallback);
  }
}
