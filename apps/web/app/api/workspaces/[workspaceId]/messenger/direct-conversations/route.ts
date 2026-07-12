import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerDirectConversationInput } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    const { workspaceId } = await context.params;
    const limited = await guardMessengerPrincipalMutation(request, {
      conversationId: "direct-conversations",
      limit: 20,
      scope: "messenger:direct-conversations:create",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (limited) return limited;
    const input = parseMessengerDirectConversationInput(await readMessengerJson(request));
    const result = await messengerRepository.openDirectConversation(user.id, workspaceId, input.recipientUserId);
    return messengerJson({ conversation: result.conversation }, result.created ? 201 : 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
