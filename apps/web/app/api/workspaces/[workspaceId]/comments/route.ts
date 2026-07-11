import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { commentRepository } from "@/lib/server/commentRepository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { workspaceId } = await context.params;

  try {
    const comments = await commentRepository.listWorkspaceComments(user.id, workspaceId);
    return NextResponse.json({ comments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comments failed to load" }, { status: 403 });
  }
}
