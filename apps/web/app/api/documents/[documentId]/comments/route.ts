import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { commentRepository } from "@/lib/server/commentRepository";
import { parseCreateCommentInput } from "@/lib/comments/commentInput";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { documentId } = await context.params;

  try {
    const comments = await commentRepository.listDocumentComments(user.id, documentId);
    return NextResponse.json({ comments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comments failed to load" }, { status: 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "comments:create" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = parseCreateCommentInput(await request.json());
  const { documentId } = await context.params;

  try {
    const comment = await commentRepository.createDocumentComment(user.id, documentId, body);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comment creation failed" }, { status: 403 });
  }
}
