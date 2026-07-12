import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";
import { emailVerificationService } from "@/lib/server/emailVerificationService";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const user = /^\d{6}$/.test(code) ? await emailVerificationService.consumeToken(code) : null;
  if (!user) return NextResponse.json({ error: "This verification code is invalid or expired" }, { status: 400 });
  const session = await authService.createSession(user.id, request);
  const response = NextResponse.json({ redirectTo: user.onboardingCompletedAt ? "/workspace" : "/onboarding" });
  authService.setSessionCookie(response, session.token, session.expiresAt);
  await auditLogService.record({ actorUserId: user.id, targetUserId: user.id, type: "auth.email_verified" });
  return response;
}
