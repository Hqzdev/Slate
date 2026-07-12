import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { auditLogService } from "@/lib/server/auditLog";
import { emailDeliveryService } from "@/lib/server/emailDeliveryService";
import { emailVerificationService } from "@/lib/server/emailVerificationService";
import { getPasswordValidationError, isValidEmail, isValidUsername, normalizeEmail, normalizeUsername } from "@/lib/server/identityPolicy";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const colors = ["blue", "violet", "teal", "green", "pink", "orange", "gray"] as const;

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 5, scope: "auth:register", windowMs: 60_000 });
  if (denied) return denied;

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
  const password = typeof body.password === "string" ? body.password : "";

  const passwordError = getPasswordValidationError(password, [email, username]);
  if (name.length < 2 || !isValidEmail(email) || !isValidUsername(username) || passwordError) {
    return NextResponse.json({ error: passwordError ?? "Enter a valid name, email, and username" }, { status: 400 });
  }

  const existingUsers = await prisma.user.findMany({ select: { email: true, username: true }, where: { OR: [{ email }, { username }] } });
  if (existingUsers.some((user) => user.email === email)) {
    return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
  }
  if (existingUsers.some((user) => user.username === username)) {
    return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
  }

  const userCount = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      color: colors[userCount % colors.length],
      email,
      initials: initialsFromName(name),
      name,
      passwordHash: await passwordService.hash(password),
      username
    }
  });

  try {
    await workspaceRepository.createDefaultWorkspaceForUser(user.id, name);
  } catch (error) {
    await prisma.user.deleteMany({ where: { id: user.id } });
    throw error;
  }
  await auditLogService.record({
    actorUserId: user.id,
    metadata: { email: user.email },
    type: "auth.registered"
  });
  const verificationToken = await emailVerificationService.createToken(user.id);
  const delivery = await emailDeliveryService.sendVerificationEmail(user.email, verificationToken).then((result) => ({ developmentCode: result.developmentCode, sent: true })).catch(() => ({ developmentCode: null, sent: false }));
  return NextResponse.json({ developmentCode: delivery.developmentCode, user: publicUser(user), verificationEmailSent: delivery.sent }, { status: 201 });
}

function initialsFromName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || name.slice(0, 2).toUpperCase();
}

function publicUser(user: { color: string; email: string; id: string; initials: string; name: string; username: string | null }) {
  return {
    color: user.color,
    email: user.email,
    id: user.id,
    initials: user.initials,
    name: user.name,
    username: user.username
  };
}
