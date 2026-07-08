import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string; snapshotId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { documentId, snapshotId } = await context.params;
  try {
    const document = await workspaceRepository.restoreDocumentSnapshot(user.id, documentId, snapshotId);
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Snapshot restore failed" }, { status: 403 });
  }
}
