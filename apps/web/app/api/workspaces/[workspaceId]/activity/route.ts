import { NextRequest, NextResponse } from "next/server";
import { activityRepository } from "@/lib/server/activityRepository";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { workspaceId } = await context.params;

  try {
    const events = await activityRepository.listWorkspaceEvents(user.id, workspaceId);
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Activity failed to load" }, { status: 403 });
  }
}
