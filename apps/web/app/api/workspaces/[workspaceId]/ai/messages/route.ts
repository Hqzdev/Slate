import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { AiDomainError } from "@/lib/server/ai/errors";
import { aiErrorResponse, readJsonBody } from "@/lib/server/ai/http";
import { parseAiMessageInput, parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 12, scope: "ai:messages", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    const input = parseAiMessageInput(await readJsonBody(request));
    if (input.mode === "agent") throw new AiDomainError("agent_mode_endpoint_required", "Use the agent task endpoint for Agent mode", 400);
    const turn = await aiAssistantService.sendMessage(user.id, workspaceId, input, request.signal);
    return NextResponse.json(turn, { status: turn.responseMessage ? turn.replayed ? 200 : 201 : 202 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
