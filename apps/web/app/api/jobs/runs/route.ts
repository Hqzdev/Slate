import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { getRunQueue } from "@/lib/server/runQueue";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const executionEnvironmentIds = new Set(["dry-run", "node-container", "node-syntax-check"]);

export async function GET(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const runs = await workspaceRepository.listRuns(user.id, workspaceId);
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run history failed" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const documentId = body.documentId;
  const environmentId = typeof body.environmentId === "string" ? body.environmentId : "dry-run";

  if (typeof documentId !== "string" || documentId.length === 0) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  if (!executionEnvironmentIds.has(environmentId)) {
    return NextResponse.json({ error: "Unsupported execution environment" }, { status: 400 });
  }

  try {
    const result = await workspaceRepository.createRun(user.id, documentId, environmentId);
    const runQueue = getRunQueue();
    await runQueue.add("run_document", {
      documentId,
      environmentId,
      fileName: result.document.title,
      language: result.document.language,
      runId: result.run.id,
      source: result.document.content
    });

    return NextResponse.json({ run: result.run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run creation failed" }, { status: 403 });
  }
}
