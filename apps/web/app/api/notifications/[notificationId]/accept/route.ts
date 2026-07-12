import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { inviteRepository } from "@/lib/server/inviteRepository";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ notificationId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "notifications:invite-accept", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { notificationId } = await context.params;
  const notification = await prisma.userNotification.findFirst({
    select: { inviteId: true },
    where: { id: notificationId, recipientId: user.id }
  });
  if (!notification) return NextResponse.json({ error: "Notification not found" }, { status: 404 });

  try {
    return NextResponse.json({ invite: await inviteRepository.acceptInviteById(user.id, notification.inviteId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invite accept failed" }, { status: 403 });
  }
}
