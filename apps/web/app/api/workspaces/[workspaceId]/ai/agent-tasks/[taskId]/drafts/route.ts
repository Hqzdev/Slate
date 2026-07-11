import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { aiAgentTaskService } from "@/lib/server/ai/agentTaskService";
import { aiErrorResponse } from "@/lib/server/ai/http";
import { parsePathIdentifier } from "@/lib/server/ai/input";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string; workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 6, scope: "ai:agent:drafts", windowMs: 60_000 });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const params = await context.params;
    const workspaceId = parsePathIdentifier(params.workspaceId, "workspaceId");
    const taskId = parsePathIdentifier(params.taskId, "taskId");
    return NextResponse.json(await aiAgentTaskService.prepareDrafts(user.id, workspaceId, taskId));
  } catch (error) {
    return aiErrorResponse(error);
  }
}
