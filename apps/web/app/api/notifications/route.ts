import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { notificationRepository } from "@/lib/server/notificationRepository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ notifications: await notificationRepository.list(user.id) });
}

export async function PATCH(request: NextRequest) {
  const denied = await guardMutationRequest(request, { scope: "notifications:read" });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json(await notificationRepository.markAllRead(user.id));
}
