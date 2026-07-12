import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authService } from "@/lib/server/auth";
import { messengerAttachmentContentService, MessengerContentRangeError, type MessengerAttachmentVariant } from "@/lib/server/messenger/attachmentContentService";
import { messengerAttachmentAvailability } from "@/lib/server/messenger/attachmentAvailability";
import { messengerAvailability } from "@/lib/server/messenger/availability";
import { MessengerDomainError } from "@/lib/server/messenger/errors";
import { guardMessengerPrincipalMutation, messengerAuthenticationRequired, messengerErrorResponse } from "@/lib/server/messenger/http";
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
    const { attachmentId: rawAttachmentId, conversationId: rawConversationId, workspaceId } = await context.params;
    const attachmentId = parseMessengerPathIdentifier(rawAttachmentId, "attachmentId");
    const conversationId = parseMessengerPathIdentifier(rawConversationId, "conversationId");
    const limited = await guardMessengerPrincipalMutation(request, {
      conversationId,
      limit: 600,
      scope: "messenger:attachments:content",
      userId: user.id,
      windowMs: 60_000,
      workspaceId
    }, requestId);
    if (limited) return limited;
    const variant = parseVariant(request.nextUrl.searchParams.get("variant"));
    const content = await messengerAttachmentContentService.open({
      attachmentId,
      conversationId,
      rangeHeader: request.headers.get("range"),
      requestSignal: request.signal,
      userId: user.id,
      variant,
      workspaceId
    });
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "private, no-store, max-age=0",
      "content-disposition": content.contentDisposition,
      "content-length": content.byteSize.toString(),
      "content-security-policy": "sandbox; default-src 'none'",
      "content-type": content.contentType,
      "cross-origin-resource-policy": "same-origin",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId
    });
    if (content.contentRange) headers.set("content-range", content.contentRange);
    if (content.etag) headers.set("etag", `"${content.etag}"`);
    return new Response(content.body, { headers, status: content.status });
  } catch (error) {
    const response = messengerErrorResponse(error, requestId);
    if (error instanceof MessengerContentRangeError) response.headers.set("content-range", `bytes */${error.totalBytes}`);
    return response;
  }
}

function parseVariant(value: string | null): MessengerAttachmentVariant {
  if (value === null || value === "original") return "original";
  if (value === "thumbnail" || value === "poster") return value;
  throw new MessengerDomainError("invalid_attachment_variant", "Attachment variant is invalid", 400);
}
