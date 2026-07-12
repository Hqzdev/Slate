import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { clientIpAddressResolver } from "@/lib/server/clientIpAddress";
import { prisma } from "@/lib/server/prisma";

const sessionCookieName = "slate_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;
const maxSessionsPerUser = 8;

export type AuthUser = {
  color: string;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  initials: string;
  name: string;
  onboardingCompletedAt: Date | null;
  username: string | null;
};

export type SessionDevice = {
  browserName: string;
  createdAt: string;
  current: boolean;
  deviceName: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  lastSeenAt: string;
  operatingSystem: string;
  userAgent: string | null;
};

export class AuthService {
  async createSession(userId: string, request?: NextRequest) {
    await this.deleteExpiredSessions();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    const userAgent = request?.headers.get("user-agent") ?? null;
    const ipAddress = this.getRequestIpAddress(request);

    await prisma.$transaction(async (transaction) => {
      await transaction.session.create({
        data: {
          deviceName: this.getDeviceName(userAgent),
          expiresAt,
          ipAddress,
          lastSeenAt: new Date(),
          tokenHash,
          userAgent,
          userId
        }
      });

      const extraSessions = await transaction.session.findMany({
        orderBy: { createdAt: "desc" },
        skip: maxSessionsPerUser,
        select: { id: true },
        where: { userId }
      });

      if (extraSessions.length > 0) {
        await transaction.session.deleteMany({
          where: {
            id: {
              in: extraSessions.map((session) => session.id)
            }
          }
        });
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

  async destroyUserSessions(userId: string) {
    await prisma.session.deleteMany({
      where: { userId }
    });
  }

  async destroyUserSession(userId: string, sessionId: string) {
    await prisma.session.deleteMany({
      where: {
        id: sessionId,
        userId
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
    return this.getUserByToken(token, request);
  }

  async getCurrentSessionFromRequest(request: NextRequest) {
    const token = request.cookies.get(sessionCookieName)?.value;
    if (!token) return null;
    const session = await prisma.session.findUnique({
      include: { user: true },
      where: { tokenHash: this.hashToken(token) }
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      return null;
    }

    const userAgent = request.headers.get("user-agent") ?? session.userAgent;
    const ipAddress = this.getRequestIpAddress(request) ?? session.ipAddress;

    const updatedSession = await prisma.session.update({
      data: {
        deviceName: session.userAgent ? session.deviceName : this.getDeviceName(userAgent),
        ipAddress,
        lastSeenAt: new Date(),
        userAgent
      },
      include: { user: true },
      where: { id: session.id }
    });

    return updatedSession;
  }

  async listUserSessions(userId: string, currentSessionId: string | null) {
    await this.deleteExpiredSessions();
    const sessions = await prisma.session.findMany({
      orderBy: { lastSeenAt: "desc" },
      where: { userId }
    });

    return sessions.map((session): SessionDevice => ({
      browserName: this.getBrowserName(session.userAgent),
      createdAt: session.createdAt.toISOString(),
      current: session.id === currentSessionId,
      deviceName: session.deviceName ?? this.getDeviceName(session.userAgent),
      expiresAt: session.expiresAt.toISOString(),
      id: session.id,
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt.toISOString(),
      operatingSystem: this.getOperatingSystem(session.userAgent),
      userAgent: session.userAgent
    }));
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

  private async getUserByToken(token: string, request?: NextRequest) {
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

    const userAgent = request?.headers.get("user-agent") ?? session.userAgent;
    const ipAddress = this.getRequestIpAddress(request) ?? session.ipAddress;

    await prisma.session.update({
      data: {
        deviceName: session.userAgent ? session.deviceName : this.getDeviceName(userAgent),
        ipAddress,
        lastSeenAt: new Date(),
        userAgent
      },
      where: { id: session.id }
    });

    return {
      color: session.user.color,
      email: session.user.email,
      emailVerifiedAt: session.user.emailVerifiedAt,
      id: session.user.id,
      initials: session.user.initials,
      name: session.user.name,
      onboardingCompletedAt: session.user.onboardingCompletedAt,
      username: session.user.username
    };
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("base64url");
  }

  private getRequestIpAddress(request?: NextRequest) {
    return clientIpAddressResolver.resolve(request);
  }

  private getDeviceName(userAgent: string | null) {
    if (!userAgent) return "Unknown device";

    const browser = this.getBrowserName(userAgent);
    const os = this.getOperatingSystem(userAgent);
    if (browser !== "Unknown browser" && os !== "Unknown OS") return `${browser} on ${os}`;
    if (os !== "Unknown OS") return os;

    return "Browser session";
  }

  private getOperatingSystem(userAgent: string | null) {
    if (!userAgent) return "Unknown OS";

    const agent = userAgent.toLowerCase();
    if (agent.includes("iphone")) return "iOS";
    if (agent.includes("ipad")) return "iPadOS";
    if (agent.includes("macintosh") || agent.includes("mac os")) return "macOS";
    if (agent.includes("windows")) return "Windows";
    if (agent.includes("android")) return "Android";
    if (agent.includes("linux")) return "Linux";
    return "Unknown OS";
  }

  private getBrowserName(userAgent: string | null) {
    if (!userAgent) return "Unknown browser";

    const agent = userAgent.toLowerCase();
    if (agent.includes("edg/")) return "Edge";
    if (agent.includes("opr/") || agent.includes("opera")) return "Opera";
    if (agent.includes("firefox/")) return "Firefox";
    if (agent.includes("chrome/") || agent.includes("crios/")) return "Chrome";
    if (agent.includes("safari/")) return "Safari";
    return "Unknown browser";
  }

  private async deleteExpiredSessions() {
    await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lte: new Date()
        }
      }
    });
  }
}

export const authService = new AuthService();
