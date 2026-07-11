import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { aiErrorResponse } from "@/lib/server/ai/http";
import { parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string; workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 30, scope: "ai:actions:discard", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const params = await context.params;
    const workspaceId = parsePathIdentifier(params.workspaceId, "workspaceId");
    const actionId = parsePathIdentifier(params.actionId, "actionId");
    const result = await aiAssistantService.discardAction(user.id, workspaceId, actionId);
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
