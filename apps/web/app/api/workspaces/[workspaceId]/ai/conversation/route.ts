import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { aiErrorResponse } from "@/lib/server/ai/http";
import { parseConversationCursor, parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    const cursor = parseConversationCursor(request.nextUrl.searchParams.get("cursor"));
    const result = await aiAssistantService.getConversation(user.id, workspaceId, cursor, request.nextUrl.searchParams.get("conversationId"));
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 6, scope: "ai:conversation:clear", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    await aiAssistantService.clearConversation(user.id, workspaceId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
