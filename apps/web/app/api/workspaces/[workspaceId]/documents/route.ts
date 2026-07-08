import { NextRequest, NextResponse } from "next/server";
import { type DocumentType } from "@prisma/client";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const documentTypes = new Set<DocumentType>(["canvas", "code", "note"]);

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const type = body.type;

  if (!documentTypes.has(type)) {
    return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
  }

  const { workspaceId } = await context.params;
  try {
    const document = await workspaceRepository.createDocument(user.id, workspaceId, type);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document creation failed" }, { status: 403 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const documentIds = body.documentIds;

  if (!Array.isArray(documentIds) || !documentIds.every((documentId) => typeof documentId === "string" && documentId.length > 0)) {
    return NextResponse.json({ error: "documentIds must be a non-empty string array" }, { status: 400 });
  }

  const { workspaceId } = await context.params;
  try {
    const documents = await workspaceRepository.reorderDocuments(user.id, workspaceId, documentIds);
    return NextResponse.json({ documents });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document reorder failed" }, { status: 403 });
  }
}
