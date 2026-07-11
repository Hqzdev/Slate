import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 10, scope: "profile:password" });
  if (denied) return denied;

  const session = await authService.getCurrentSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  if (!session.user.passwordHash || !(await passwordService.verify(currentPassword, session.user.passwordHash))) {
    return NextResponse.json({ error: "Current password is invalid" }, { status: 403 });
  }

  await prisma.user.update({
    data: {
      passwordHash: await passwordService.hash(newPassword)
    },
    where: { id: session.userId }
  });

  await auditLogService.record({
    actorUserId: session.userId,
    targetUserId: session.userId,
    type: "profile.password_updated"
  });

  return NextResponse.json({ ok: true });
}
