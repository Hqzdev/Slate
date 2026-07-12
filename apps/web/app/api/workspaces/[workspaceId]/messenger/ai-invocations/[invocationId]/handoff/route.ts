import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { guardMessengerMutation, guardMessengerWorkspaceMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier } from "@/lib/server/messenger/input";
import { messengerAiService } from "@/lib/server/messenger/messengerAiService";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ invocationId: string; workspaceId: string }> }) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    const { invocationId: rawInvocationId, workspaceId } = await context.params;
    const invocationId = parseMessengerPathIdentifier(rawInvocationId, "invocationId");
    const principalDenied = await guardMessengerWorkspaceMutation(request, {
      limit: 12,
      scope: "messenger:ai:handoff",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    return messengerJson(await messengerAiService.openHandoff(user.id, workspaceId, invocationId), 201, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
