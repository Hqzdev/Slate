import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { getRunQueue } from "@/lib/server/runQueue";
import { workspaceRepository } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const denied = await guardMutationRequest(request, { limit: 20, scope: "jobs:runs:cancel", windowMs: 60_000 });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const { runId } = await context.params;
    const run = await workspaceRepository.cancelRun(user.id, runId);
    const queuedRun = await getRunQueue().getJob(runId);
    if (queuedRun) await queuedRun.remove().catch(() => undefined);
    return NextResponse.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run cancellation failed";
    const status = message === "Run not found" ? 404 : message === "Run is no longer active" ? 409 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
