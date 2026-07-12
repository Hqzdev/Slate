import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/server/prisma";

const verificationLifetimeMs = 1000 * 60 * 60 * 24;
const resendLimit = 3;
const resendWindowMs = 1000 * 60 * 60 * 12;

export class EmailVerificationService {
  async createToken(userId: string) {
    const token = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      prisma.emailVerificationToken.create({ data: { expiresAt: new Date(Date.now() + verificationLifetimeMs), tokenHash: this.hash(token), userId } })
    ]);
    return token;
  }

  async consumeToken(token: string) {
    const verification = await prisma.emailVerificationToken.findUnique({ include: { user: true }, where: { tokenHash: this.hash(token) } });
    if (!verification || verification.expiresAt <= new Date()) return null;
    await prisma.$transaction([
      prisma.user.update({ data: { emailVerifiedAt: new Date() }, where: { id: verification.userId } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: verification.userId } })
    ]);
    return verification.user;
  }

  async requestResend(userId: string) {
    const current = await prisma.emailVerificationToken.findFirst({ orderBy: { createdAt: "desc" }, where: { userId } });
    const now = new Date();
    const resetAt = current ? new Date(current.resendWindowStartedAt.getTime() + resendWindowMs) : null;
    const shouldReset = !current || !resetAt || resetAt <= now;
    if (!shouldReset && current.resendCount >= resendLimit) return { remaining: 0, resetAt, token: null };

    const nextCount = shouldReset ? 1 : current.resendCount + 1;
    const token = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const windowStartedAt = shouldReset ? now : current.resendWindowStartedAt;
    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      prisma.emailVerificationToken.create({ data: { expiresAt: new Date(now.getTime() + verificationLifetimeMs), resendCount: nextCount, resendWindowStartedAt: windowStartedAt, tokenHash: this.hash(token), userId } })
    ]);
    return { remaining: resendLimit - nextCount, resetAt: new Date(windowStartedAt.getTime() + resendWindowMs), token };
  }

  private hash(token: string) {
    return createHash("sha256").update(token).digest("base64url");
  }
}

export const emailVerificationService = new EmailVerificationService();
