import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { auditLogService } from "@/lib/server/auditLog";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const profileColors = new Set(["blue", "violet", "teal", "green", "pink", "orange", "gray"]);

export async function GET(request: NextRequest) {
  const session = await authService.getCurrentSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const devices = await authService.listUserSessions(session.userId, session.id);
  return NextResponse.json({
    devices,
    user: publicUser(session.user)
  });
}

export async function PATCH(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "profile:update" });
  if (denied) return denied;

  const session = await authService.getCurrentSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : session.user.name;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : session.user.email;
  const color = typeof body.color === "string" ? body.color : session.user.color;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (name.length < 2 || !email.includes("@")) {
    return NextResponse.json({ error: "Valid name and email are required" }, { status: 400 });
  }

  if (!profileColors.has(color)) {
    return NextResponse.json({ error: "Profile color is invalid" }, { status: 400 });
  }

  if (email !== session.user.email) {
    if (!session.user.passwordHash || !(await passwordService.verify(currentPassword, session.user.passwordHash))) {
      return NextResponse.json({ error: "Current password is required to change email" }, { status: 403 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.id !== session.userId) {
      return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    }
  }

  const user = await prisma.user.update({
    data: {
      color,
      email,
      initials: initialsFromName(name),
      name
    },
    where: { id: session.userId }
  });

  await auditLogService.record({
    actorUserId: session.userId,
    metadata: {
      emailChanged: email !== session.user.email,
      colorChanged: color !== session.user.color,
      nameChanged: name !== session.user.name
    },
    targetUserId: session.userId,
    type: "profile.updated"
  });

  return NextResponse.json({ user: publicUser(user) });
}

function initialsFromName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || name.slice(0, 2).toUpperCase();
}

function publicUser(user: { color: string; email: string; id: string; initials: string; name: string }) {
  return {
    color: user.color,
    email: user.email,
    id: user.id,
    initials: user.initials,
    name: user.name
  };
}
