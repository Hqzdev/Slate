import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const denied = await guardMutationRequest(request, { limit: 10, scope: "auth:login", windowMs: 60_000 });
    if (denied) return denied;

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await passwordService.verify(password, user.passwordHash))) {
      await auditLogService.record({
        metadata: { email },
        type: "auth.login_failed"
      }).catch((auditError) => console.error(auditError));
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

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
