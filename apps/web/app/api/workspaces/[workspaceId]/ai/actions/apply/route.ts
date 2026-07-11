import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAssistantService } from "@/lib/server/ai/assistantService";
import { aiErrorResponse, readJsonBody } from "@/lib/server/ai/http";
import { parseActionIds, parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "ai:actions:batch-apply", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parsePathIdentifier(rawWorkspaceId, "workspaceId");
    const actionIds = parseActionIds(await readJsonBody(request));
    const result = await aiAssistantService.applyActions(user.id, workspaceId, actionIds);
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
