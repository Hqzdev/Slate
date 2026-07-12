import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { emailDeliveryService } from "@/lib/server/emailDeliveryService";
import { emailVerificationService } from "@/lib/server/emailVerificationService";
import { normalizeEmail } from "@/lib/server/identityPolicy";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 3, scope: "auth:resend-verification", windowMs: 60_000 });
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.emailVerifiedAt) {
    return NextResponse.json({ code: "email_already_verified", error: "This email is already verified" }, { status: 409 });
  }
  if (user) {
    const resend = await emailVerificationService.requestResend(user.id);
    if (!resend.token) return NextResponse.json({ error: "You have used all three resend attempts. Try again after the limit resets.", resetAt: resend.resetAt?.toISOString() ?? null }, { status: 429 });
    const delivery = await emailDeliveryService.sendVerificationEmail(user.email, resend.token);
    return NextResponse.json({ developmentCode: delivery.developmentCode, ok: true, remaining: resend.remaining, resetAt: resend.resetAt.toISOString() });
  }
  return NextResponse.json({ ok: true, remaining: 0 });
}
