import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { commentRepository } from "@/lib/server/commentRepository";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ commentId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "comments:update" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const { commentId } = await context.params;

  try {
    const comment = await commentRepository.updateDocumentComment(user.id, commentId, {
      body: typeof body.body === "string" ? body.body : undefined,
      resolved: typeof body.resolved === "boolean" ? body.resolved : undefined
    });
    return NextResponse.json({ comment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comment update failed" }, { status: 403 });
  }
}
