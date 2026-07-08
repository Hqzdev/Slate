import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const colors = ["blue", "violet", "teal", "gray"] as const;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (name.length < 2 || !email.includes("@") || password.length < 8) {
    return NextResponse.json({ error: "Valid name, email, and 8+ character password are required" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
  }

  const userCount = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      color: colors[userCount % colors.length],
      email,
      initials: initialsFromName(name),
      name,
      passwordHash: await passwordService.hash(password)
    }
  });

  await workspaceRepository.createDefaultWorkspaceForUser(user.id, name);
  const session = await authService.createSession(user.id);
  const response = NextResponse.json({ user: publicUser(user) }, { status: 201 });
  authService.setSessionCookie(response, session.token, session.expiresAt);
  return response;
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
