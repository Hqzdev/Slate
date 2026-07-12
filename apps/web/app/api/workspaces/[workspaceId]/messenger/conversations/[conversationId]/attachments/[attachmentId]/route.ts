import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAttachmentService } from "@/lib/server/messenger/attachmentService";
import { messengerAttachmentAvailability } from "@/lib/server/messenger/attachmentAvailability";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier } from "@/lib/server/messenger/input";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ attachmentId: string; conversationId: string; workspaceId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    messengerAttachmentAvailability.requireEnabled();
    const identifiers = await parseIdentifiers(context);
    const attachment = await messengerAttachmentService.getStatus(user.id, identifiers.workspaceId, identifiers.conversationId, identifiers.attachmentId);
    return messengerJson({ attachment }, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  const denied = await guardMessengerMutation(request, requestId);
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    messengerAttachmentAvailability.requireEnabled();
    const identifiers = await parseIdentifiers(context);
    const limited = await guardMessengerPrincipalMutation(request, {
      conversationId: identifiers.conversationId,
      limit: 30,
      scope: "messenger:attachments:abandon",
      userId: user.id,
      windowMs: 60_000,
      workspaceId: identifiers.workspaceId
    }, requestId);
    if (limited) return limited;
    const attachment = await messengerAttachmentService.abandon(user.id, identifiers.workspaceId, identifiers.conversationId, identifiers.attachmentId);
    return messengerJson({ attachment }, 202, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}

async function parseIdentifiers(context: Context) {
  const { attachmentId: rawAttachmentId, conversationId: rawConversationId, workspaceId } = await context.params;
  return {
    attachmentId: parseMessengerPathIdentifier(rawAttachmentId, "attachmentId"),
    conversationId: parseMessengerPathIdentifier(rawConversationId, "conversationId"),
    workspaceId
  };
}
