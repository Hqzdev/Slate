import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { aiConversationRepository } from "@/lib/server/ai/conversationRepository";
import { aiErrorResponse, readJsonBody } from "@/lib/server/ai/http";
import { parseConversationCursor, parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";
import { workspaceAccessPolicy } from "@/lib/server/workspaceAccessPolicy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string; conversationId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { conversationId, workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    return NextResponse.json(await aiAssistantService.getConversation(user.id, workspaceId, parseConversationCursor(request.nextUrl.searchParams.get("cursor")), parsePathIdentifier(conversationId, "conversationId")));
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string; conversationId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 12, scope: "ai:conversations:update", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { conversationId, workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    const body = await readJsonBody(request) as { title?: unknown };
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80) return NextResponse.json({ error: "A title between 1 and 80 characters is required" }, { status: 400 });
    await workspaceAccessPolicy.requireWorkspaceReader(user.id, workspaceId);
    await aiConversationRepository.updateConversation(user.id, workspaceId, parsePathIdentifier(conversationId, "conversationId"), body.title.trim());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string; conversationId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 12, scope: "ai:conversations:archive", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { conversationId, workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    await workspaceAccessPolicy.requireWorkspaceReader(user.id, workspaceId);
    await aiConversationRepository.archiveConversation(user.id, workspaceId, parsePathIdentifier(conversationId, "conversationId"));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
