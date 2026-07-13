import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

function readConfiguration() {
  const baseUrl = process.env.SLATE_GIT_BRIDGE_URL?.replace(/\/$/, "");
  const token = process.env.SLATE_GIT_BRIDGE_TOKEN;
  const repositoryId = process.env.SLATE_GIT_BRIDGE_REPOSITORY_ID ?? "slate";
  const administrators = new Set((process.env.SLATE_GIT_SYNC_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (!baseUrl || !token || administrators.size === 0) return null;
  if (!/^[a-z0-9_-]+$/i.test(repositoryId)) return null;
  return { administrators, baseUrl, repositoryId, token };
}

async function requestBridge(configuration: NonNullable<ReturnType<typeof readConfiguration>>, path: string, method: "GET" | "POST") {
  const response = await fetch(`${configuration.baseUrl}/v1/repositories/${configuration.repositoryId}${path}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${configuration.token}` },
    method,
    signal: AbortSignal.timeout(5_000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Git Bridge request failed");
  return body;
}

async function requireAdministrator(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const configuration = readConfiguration();
  if (!configuration) return { response: NextResponse.json({ error: "Git Sync is not configured" }, { status: 503 }) };
  if (!configuration.administrators.has(user.email.toLowerCase())) return { response: NextResponse.json({ error: "Git Sync is restricted to configured administrators" }, { status: 403 }) };
  return { configuration };
}

export async function GET(request: NextRequest) {
  const access = await requireAdministrator(request);
  if ("response" in access) return access.response;

  try {
    return NextResponse.json(await requestBridge(access.configuration, "", "GET"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Git Bridge request failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { scope: "git_sync:write" });
  if (denied) return denied;
  const access = await requireAdministrator(request);
  if ("response" in access) return access.response;

  try {
    return NextResponse.json(await requestBridge(access.configuration, "/sync", "POST"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Git sync failed" }, { status: 409 });
  }
}
