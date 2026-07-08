import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { passwordService } from "@/lib/server/password";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await passwordService.verify(password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const session = await authService.createSession(user.id);
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
