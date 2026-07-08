import { NextRequest, NextResponse } from "next/server";
import { type FileNodeKind } from "@prisma/client";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const fileNodeKinds = new Set<FileNodeKind>(["document", "folder"]);

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const kind = body.kind;

  if (!fileNodeKinds.has(kind)) {
    return NextResponse.json({ error: "Invalid file node kind" }, { status: 400 });
  }

  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
    return NextResponse.json({ error: "parentId must be a string" }, { status: 400 });
  }

  if (body.extension !== undefined && typeof body.extension !== "string") {
    return NextResponse.json({ error: "extension must be a string" }, { status: 400 });
  }

  const { workspaceId } = await context.params;

  try {
    const result = await workspaceRepository.createFileNode(user.id, workspaceId, {
      extension: body.extension,
      kind,
      name: body.name,
      parentId: body.parentId ?? null
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File node creation failed" }, { status: 403 });
  }
}
