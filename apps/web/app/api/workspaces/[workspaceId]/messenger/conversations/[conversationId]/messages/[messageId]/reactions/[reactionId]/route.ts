import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string; messageId: string; reactionId: string; workspaceId: string }> }
) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    const {
      conversationId: rawConversationId,
      messageId: rawMessageId,
      reactionId: rawReactionId,
      workspaceId
    } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const messageId = parseMessengerPathIdentifier(rawMessageId, "messageId");
    const reactionId = parseMessengerPathIdentifier(rawReactionId, "reactionId");
    const principalDenied = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 120,
      scope: "messenger:reactions:delete",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    const reaction = await messengerRepository.removeReaction(user.id, workspaceId, conversationId, messageId, reactionId);
    return messengerJson({ reaction }, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
