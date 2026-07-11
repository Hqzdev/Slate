import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";
import { CanvasStateValidationError } from "@/lib/canvas/canvasDocumentSchema";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "documents:update" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const { documentId } = await context.params;
  try {
    const document = await workspaceRepository.updateDocument(user.id, documentId, {
      canvasState: body.canvasState,
      content: body.content,
      title: body.title
    });

    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof CanvasStateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document update failed" }, { status: 403 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "documents:delete" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { documentId } = await context.params;
  try {
    await workspaceRepository.archiveDocument(user.id, documentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document delete failed" }, { status: 403 });
  }
}
