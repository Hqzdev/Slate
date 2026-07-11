import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiConversationRepository } from "@/lib/server/ai/conversationRepository";
import { aiErrorResponse, readJsonBody } from "@/lib/server/ai/http";
import { parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";
import { workspaceAccessPolicy } from "@/lib/server/workspaceAccessPolicy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    await workspaceAccessPolicy.requireWorkspaceReader(user.id, workspaceId);
    return NextResponse.json({ conversations: await aiConversationRepository.listConversations(user.id, workspaceId) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 12, scope: "ai:conversations:create", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    await workspaceAccessPolicy.requireWorkspaceReader(user.id, workspaceId);
    await readJsonBody(request).catch(() => ({}));
    return NextResponse.json({ conversation: await aiConversationRepository.createConversation(user.id, workspaceId) }, { status: 201 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
