import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAgentTaskService } from "@/lib/server/ai/agentTaskService";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { AiDomainError } from "@/lib/server/ai/errors";
import { aiErrorResponse, readJsonBody } from "@/lib/server/ai/http";
import { parseAiMessageInput, parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";
import { workspaceAccessPolicy } from "@/lib/server/workspaceAccessPolicy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    return NextResponse.json({ agentTask: await aiAgentTaskService.getLatest(user.id, workspaceId, request.nextUrl.searchParams.get("conversationId")) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 6, scope: "ai:agent:create", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    const input = parseAiMessageInput(await readJsonBody(request));
    if (input.mode !== "agent") throw new AiDomainError("invalid_mode", "Agent task requires agent mode", 400);
    await workspaceAccessPolicy.requireWorkspaceWriter(user.id, workspaceId);
    const turn = await aiAssistantService.sendMessage(user.id, workspaceId, input, request.signal);
    if (!turn.responseMessage) throw new AiDomainError("agent_plan_unavailable", "Agent plan is not ready", 409, true);
    const agentTask = await aiAgentTaskService.createFromPlan({
      activeDocumentId: input.activeDocumentId,
      clientRequestId: input.clientRequestId,
      conversationId: turn.conversationId,
      ownerUserId: user.id,
      plan: turn.responseMessage.content,
      planMessageId: turn.responseMessage.id,
      prompt: input.content,
      workspaceId
    });
    return NextResponse.json({ ...turn, agentTask }, { status: turn.replayed ? 200 : 201 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
