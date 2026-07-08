import { NextRequest, NextResponse } from "next/server";
import { gitImportService } from "@/lib/server/gitImportService";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const url = body.url;

  if (typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const { workspaceId } = await context.params;

  try {
    await workspaceRepository.requireWorkspaceEditor(user.id, workspaceId);
    const result = await gitImportService.importRepository(url);
    const documents = await workspaceRepository.importDocuments(user.id, workspaceId, result.documents);
    return NextResponse.json({ documents, summary: result.summary }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git import failed";
    const status = message === "Workspace access denied" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
