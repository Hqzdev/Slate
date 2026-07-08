import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const room = request.nextUrl.searchParams.get("room") ?? "";
  const realtimeUser = await workspaceRepository.authorizeRealtimeRoom(user.id, room);
  if (!realtimeUser) {
    return NextResponse.json({ error: "Realtime room access denied" }, { status: 403 });
  }

  return NextResponse.json({ user: realtimeUser });
}
