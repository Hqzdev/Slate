import { NextResponse } from "next/server";
import { inviteRepository } from "@/lib/server/inviteRepository";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = await inviteRepository.getInvite(token);

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  return NextResponse.json({ invite });
}
