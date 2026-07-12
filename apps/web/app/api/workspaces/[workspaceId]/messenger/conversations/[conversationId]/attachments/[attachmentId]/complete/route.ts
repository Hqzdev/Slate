import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAttachmentService } from "@/lib/server/messenger/attachmentService";
import { messengerAttachmentAvailability } from "@/lib/server/messenger/attachmentAvailability";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerAttachmentCompletionInput, parseMessengerPathIdentifier } from "@/lib/server/messenger/input";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ attachmentId: string; conversationId: string; workspaceId: string }>;
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
    const { attachmentId: rawAttachmentId, conversationId: rawConversationId, workspaceId } = await context.params;
    const attachmentId = parseMessengerPathIdentifier(rawAttachmentId, "attachmentId");
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const limited = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 30,
      scope: "messenger:attachments:complete",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (limited) return limited;
    const input = parseMessengerAttachmentCompletionInput(await readMessengerJson(request));
    const attachment = await messengerAttachmentService.complete(user.id, workspaceId, conversationId, attachmentId, input);
    return messengerJson({ attachment }, 202, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
