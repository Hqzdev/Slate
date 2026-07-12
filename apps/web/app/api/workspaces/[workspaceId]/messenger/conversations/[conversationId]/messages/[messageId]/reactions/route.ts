import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier, parseMessengerReactionInput } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string; messageId: string; workspaceId: string }> }
) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    const { conversationId: rawConversationId, messageId: rawMessageId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const messageId = parseMessengerPathIdentifier(rawMessageId, "messageId");
    const principalDenied = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 120,
      scope: "messenger:reactions:create",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    const emoji = parseMessengerReactionInput(await readMessengerJson(request));
    const reaction = await messengerRepository.addReaction(user.id, workspaceId, conversationId, messageId, emoji);
    return messengerJson({ reaction }, 201, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
