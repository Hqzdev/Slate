import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { emailVerificationPolicy } from "@/lib/server/emailVerificationPolicy";

export const runtime = "nodejs";

const discoverySources = new Set(["search", "friend", "social", "community", "other"]);
const intendedUses = new Set(["personal", "team", "study", "client", "other"]);
const roles = new Set(["developer", "designer", "founder", "student", "manager", "other"]);

export async function POST(request: NextRequest) {
  const denied = await guardMutationRequest(request, { limit: 10, scope: "onboarding:complete" });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user || (emailVerificationPolicy.isRequired() && !user.emailVerifiedAt)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { discoverySource?: unknown; intendedUse?: unknown; role?: unknown };
  const discoverySource = typeof body.discoverySource === "string" ? body.discoverySource : "";
  const intendedUse = typeof body.intendedUse === "string" ? body.intendedUse : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!discoverySources.has(discoverySource) || !intendedUses.has(intendedUse) || !roles.has(role)) return NextResponse.json({ error: "Complete every onboarding question" }, { status: 400 });
  await prisma.user.update({ data: { onboardingCompletedAt: new Date(), onboardingDiscoverySource: discoverySource, onboardingIntendedUse: intendedUse, onboardingRole: role }, where: { id: user.id } });
  return NextResponse.json({ ok: true });
}
