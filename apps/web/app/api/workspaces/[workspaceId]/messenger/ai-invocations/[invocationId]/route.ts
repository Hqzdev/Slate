import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAuthenticationRequired, messengerErrorResponse, messengerJson } from "@/lib/server/messenger/http";
import { parseMessengerPathIdentifier } from "@/lib/server/messenger/input";
import { messengerAiService } from "@/lib/server/messenger/messengerAiService";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ invocationId: string; workspaceId: string }> }) {
  const requestId = randomUUID();
  const user = await authService.getUserFromRequest(request);
  if (!user) return messengerAuthenticationRequired(requestId);
  try {
    const { invocationId: rawInvocationId, workspaceId } = await context.params;
    const invocationId = parseMessengerPathIdentifier(rawInvocationId, "invocationId");
    return messengerJson(await messengerAiService.getInvocation(user.id, workspaceId, invocationId), 200, requestId);
  } catch (error) {
    return messengerErrorResponse(error, requestId);
  }
}
