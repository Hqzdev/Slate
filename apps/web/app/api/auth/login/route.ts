import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";
import { emailVerificationPolicy } from "@/lib/server/emailVerificationPolicy";
import { normalizeEmail, normalizeUsername } from "@/lib/server/identityPolicy";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const denied = await guardMutationRequest(request, { limit: 10, scope: "auth:login", windowMs: 60_000 });
    if (denied) return denied;

    const body = await request.json();
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      return NextResponse.json({ error: "Email or username and password are required" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({ where: { OR: [{ email: normalizeEmail(identifier) }, { username: normalizeUsername(identifier) }] } });
    if (!user?.passwordHash || !(await passwordService.verify(password, user.passwordHash))) {
      await auditLogService.record({
        metadata: { identifier },
        type: "auth.login_failed"
      }).catch((auditError) => console.error(auditError));
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    if (emailVerificationPolicy.isRequired() && !user.emailVerifiedAt) return NextResponse.json({ code: "email_verification_required", error: "Verify your email before signing in" }, { status: 403 });

    const session = await authService.createSession(user.id, request);
    await auditLogService.record({
      actorUserId: user.id,
      metadata: { email: user.email },
      type: "auth.login_succeeded"
    }).catch((auditError) => console.error(auditError));
    const response = NextResponse.json({
      user: {
        color: user.color,
        email: user.email,
        id: user.id,
        initials: user.initials,
        name: user.name
      }
    });
    authService.setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
}
