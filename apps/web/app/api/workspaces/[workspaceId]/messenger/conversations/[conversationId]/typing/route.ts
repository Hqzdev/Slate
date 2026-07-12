import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAccessPolicy } from "@/lib/server/messenger/accessPolicy";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson, readMessengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier, parseMessengerTypingInput } from "@/lib/server/messenger/input";
import { messengerRealtimeConfiguration } from "@/lib/server/messenger/realtimeConfiguration";
import { messengerTypingService } from "@/lib/server/messenger/typingService";

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
    messengerRealtimeConfiguration.requireEnabled();
    const { conversationId: rawConversationId, workspaceId } = await context.params;
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const rateLimited = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 90,
      scope: "messenger:typing",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (rateLimited) return rateLimited;
    const input = parseMessengerTypingInput(await readMessengerJson(request));
    await messengerAccessPolicy.requireConversationWriter(user.id, workspaceId, conversationId);
    await messengerTypingService.publish({ ...input, conversationId, userId: user.id, workspaceId });
    return messengerJson({}, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
