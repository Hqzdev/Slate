import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";

const sessionCookieName = "slate_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;

export type AuthUser = {
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
};

export class AuthService {
  async createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + sessionDurationMs);

    await prisma.session.create({
      data: {
        expiresAt,
        tokenHash,
        userId
      }
    });

    return { expiresAt, token };
  }

  async destroyCurrentSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName)?.value;
    if (!token) return;

    await prisma.session.deleteMany({
      where: {
        tokenHash: this.hashToken(token)
      }
    });
  }

  async getCurrentUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName)?.value;
    if (!token) return null;
    return this.getUserByToken(token);
  }

  async getUserFromRequest(request: NextRequest) {
    const token = request.cookies.get(sessionCookieName)?.value;
    if (!token) return null;
    return this.getUserByToken(token);
  }

  setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
    response.cookies.set(sessionCookieName, token, {
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });
  }

  clearSessionCookie(response: NextResponse) {
    response.cookies.set(sessionCookieName, "", {
      expires: new Date(0),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });
  }

  private async getUserByToken(token: string) {
    const session = await prisma.session.findUnique({
      include: { user: true },
      where: { tokenHash: this.hashToken(token) }
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
      }
      return null;
    }

    return {
      color: session.user.color,
      email: session.user.email,
      id: session.user.id,
      initials: session.user.initials,
      name: session.user.name
    };
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("base64url");
  }
}

export const authService = new AuthService();
