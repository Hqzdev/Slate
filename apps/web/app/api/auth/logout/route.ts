import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "auth:logout", windowMs: 60_000 });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  await authService.destroyCurrentSession();
  if (user) {
    await auditLogService.record({
      actorUserId: user.id,
      type: "auth.logout"
    });
  }
  const response = NextResponse.json({ ok: true });
  authService.clearSessionCookie(response);
  return response;
}
