import { NextRequest, NextResponse } from "next/server";
import { rateLimitService } from "@/lib/server/rateLimit";

type MutationGuardOptions = {
  limit?: number;
  scope: string;
  windowMs?: number;
};

const mutatingMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export async function guardMutationRequest(request: NextRequest, options: MutationGuardOptions) {
  if (!mutatingMethods.has(request.method)) return null;

  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request origin denied" }, { status: 403 });
  }

  const allowed = await rateLimitService.check(request, {
    limit: options.limit ?? 60,
    scope: options.scope,
    windowMs: options.windowMs ?? 60_000
  });

  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  return null;
}

function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");

  if (site === "same-origin" || site === "none") {
    return true;
  }

  if (!origin) {
    return process.env.NODE_ENV !== "production";
  }

  return origin === request.nextUrl.origin;
}
