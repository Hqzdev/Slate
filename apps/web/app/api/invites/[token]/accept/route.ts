import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { inviteRepository } from "@/lib/server/inviteRepository";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "invites:accept", windowMs: 60_000 });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { token } = await context.params;

  try {
    const invite = await inviteRepository.acceptInvite(user.id, token);
    return NextResponse.json({ invite });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invite accept failed" }, { status: 403 });
  }
}
