import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 30, scope: "profile:devices" });
  if (denied) return denied;

  const session = await authService.getCurrentSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const signedOut = session.id === sessionId;
  await authService.destroyUserSession(session.userId, sessionId);
  await auditLogService.record({
    actorUserId: session.userId,
    metadata: { current: signedOut },
    targetUserId: session.userId,
    type: "profile.device_removed"
  });

  const response = NextResponse.json({ ok: true, signedOut });
  if (signedOut) authService.clearSessionCookie(response);
  return response;
}
