import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier, parseMessengerReceiptInput } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string; workspaceId: string }> }
) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    const { conversationId: rawConversationId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const principalDenied = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 180,
      scope: "messenger:receipts:update",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    const input = parseMessengerReceiptInput(await readMessengerJson(request));
    const receipt = await messengerRepository.updateReceipt(user.id, workspaceId, conversationId, input);
    return messengerJson({ receipt }, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
