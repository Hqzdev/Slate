import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAccessPolicy } from "@/lib/server/messenger/accessPolicy";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { guardMessengerMutation, guardMessengerWorkspaceMutation, messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { messengerRealtimeConfiguration } from "@/lib/server/messenger/realtimeConfiguration";
import { messengerRealtimeGrantService } from "@/lib/server/messenger/realtimeGrant";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const requestId = randomUUID();
  const originDenied = await guardMessengerMutation(request, requestId);
  if (originDenied) return originDenied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  const { workspaceId } = await context.params;
  const rateLimited = await guardMessengerWorkspaceMutation(request, {
    limit: 12,
    scope: "messenger:realtime:authorize",
    userId: user.id,
    windowMs: 60_000,
    workspaceId
  }, requestId);
  if (rateLimited) return rateLimited;
  try {
    messengerAvailability.requireEnabled();
    messengerRealtimeConfiguration.requireEnabled();
    const member = await messengerAccessPolicy.requireRealtimeWorkspaceAccess(user.id, workspaceId);
    const issued = messengerRealtimeGrantService.create({
      accessVersion: member.messengerAccessVersion,
      membershipId: member.id,
      role: member.role,
      userId: member.userId,
      workspaceId: member.workspaceId
    });
    return messengerJson({
      expiresAt: issued.expiresAt,
      grant: issued.grant,
      protocolVersion: 1,
      socketUrl: messengerRealtimeConfiguration.getSocketUrl()
    }, 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
