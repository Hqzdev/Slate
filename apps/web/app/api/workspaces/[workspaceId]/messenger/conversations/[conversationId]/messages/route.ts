import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerHistoryQuery, parseMessengerPathIdentifier, parseMessengerSendInput } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ conversationId: string; workspaceId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    messengerAvailability.requireEnabled();
    const { conversationId: rawConversationId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const query = parseMessengerHistoryQuery(request.nextUrl.searchParams);
    const result = await messengerRepository.listMessages(user.id, workspaceId, conversationId, query);
    return messengerJson(result, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, context: Context) {
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
      limit: 60,
      scope: "messenger:messages:create",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (principalDenied) return principalDenied;
    const input = parseMessengerSendInput(await readMessengerJson(request));
    const result = await messengerRepository.sendMessage(user.id, workspaceId, conversationId, input);
    return messengerJson(result, result.replayed ? 200 : 201, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
