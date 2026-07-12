import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAttachmentService } from "@/lib/server/messenger/attachmentService";
import { messengerAttachmentAvailability } from "@/lib/server/messenger/attachmentAvailability";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerAttachmentReservationInput, parseMessengerPathIdentifier } from "@/lib/server/messenger/input";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ conversationId: string; workspaceId: string }>;
};

export async function POST(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    messengerAttachmentAvailability.requireEnabled();
    const { conversationId: rawConversationId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const limited = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 20,
      scope: "messenger:attachments:reserve",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (limited) return limited;
    const input = parseMessengerAttachmentReservationInput(await readMessengerJson(request));
    const result = await messengerAttachmentService.reserve(user.id, workspaceId, conversationId, input);
    return messengerJson(result, 201, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
