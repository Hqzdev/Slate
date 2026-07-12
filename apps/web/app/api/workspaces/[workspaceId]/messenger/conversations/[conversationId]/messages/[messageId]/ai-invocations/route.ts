import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier } from "@/lib/server/messenger/input";
import { messengerAiService } from "@/lib/server/messenger/messengerAiService";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ conversationId: string; messageId: string; workspaceId: string }> }) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    const { conversationId: rawConversationId, messageId: rawMessageId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const messageId = parseMessengerPathIdentifier(rawMessageId, "messageId");
    const principalDenied = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 12,
      scope: "messenger:ai:retry",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    const body = await readMessengerJson(request);
    const confirmProviderRedispatch = Boolean(body.confirmProviderRedispatch);
    if (Object.keys(body).some((key) => key !== "confirmProviderRedispatch") || (body.confirmProviderRedispatch !== undefined && typeof body.confirmProviderRedispatch !== "boolean")) {
      throw new Error("Invalid AI invocation retry request");
    }
    const invocation = await messengerAiService.retryInvocation(user.id, workspaceId, conversationId, messageId, confirmProviderRedispatch);
    return messengerJson({ aiInvocation: invocation }, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
