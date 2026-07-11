import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ fileNodeId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "file-nodes:update" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  if (typeof body.name !== "string" && !("parentId" in body)) {
    return NextResponse.json({ error: "name or parentId is required" }, { status: 400 });
  }

  const { fileNodeId } = await context.params;

  try {
    if ("parentId" in body) {
      const parentId = typeof body.parentId === "string" ? body.parentId : null;
      const position = typeof body.position === "number" ? body.position : null;
      const result = await workspaceRepository.moveFileNode(user.id, fileNodeId, parentId, position);
      return NextResponse.json(result);
    }

    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await workspaceRepository.renameFileNode(user.id, fileNodeId, body.name);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File node update failed" }, { status: 403 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ fileNodeId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "file-nodes:delete" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { fileNodeId } = await context.params;

  try {
    const result = await workspaceRepository.archiveFileNode(user.id, fileNodeId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File node delete failed" }, { status: 403 });
  }
}
