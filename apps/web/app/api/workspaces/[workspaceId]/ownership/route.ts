import { NextRequest, NextResponse } from "next/server";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { emailVerificationPolicy } from "@/lib/server/emailVerificationPolicy";
import { workspaceRepository } from "@/lib/server/workspaceRepository";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "workspace:ownership-transfer" });
  if (denied) return denied;
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (emailVerificationPolicy.isRequired() && !user.emailVerifiedAt) return NextResponse.json({ error: "Verify your email before transferring ownership" }, { status: 403 });
  const body = await request.json().catch(() => null) as { memberUserId?: unknown; workspaceName?: unknown } | null;
  if (typeof body?.memberUserId !== "string" || typeof body.workspaceName !== "string") {
    return NextResponse.json({ error: "Member and workspace name confirmation are required" }, { status: 400 });
  }
  const { workspaceId } = await context.params;
  const recipient = await prisma.user.findUnique({ select: { emailVerifiedAt: true }, where: { id: body.memberUserId } });
  if (emailVerificationPolicy.isRequired() && !recipient?.emailVerifiedAt) return NextResponse.json({ error: "The new owner must verify their email first" }, { status: 403 });

  try {
    return NextResponse.json(await workspaceRepository.transferWorkspaceOwnership(user.id, workspaceId, body.memberUserId, body.workspaceName));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ownership transfer failed" }, { status: 403 });
  }
}
