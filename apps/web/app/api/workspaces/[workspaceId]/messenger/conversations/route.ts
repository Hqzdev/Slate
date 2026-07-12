import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { parseConversationListQuery } from "@/lib/server/messenger/input";
import { messengerRepository } from "@/lib/server/messenger/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const requestId = randomUUID();
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  const { workspaceId } = await context.params;
  try {
    messengerAvailability.requireEnabled();
    const query = parseConversationListQuery(request.nextUrl.searchParams);
    return messengerJson(await messengerRepository.listConversations(user.id, workspaceId, query), 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
