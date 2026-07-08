import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { documentId } = await context.params;
  try {
    const snapshots = await workspaceRepository.listDocumentSnapshots(user.id, documentId);
    return NextResponse.json({ snapshots });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Snapshot list failed" }, { status: 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const { documentId } = await context.params;
  try {
    const snapshot = await workspaceRepository.createDocumentSnapshot(user.id, documentId, body.label);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Snapshot create failed" }, { status: 403 });
  }
}
