import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await authService.getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  await prisma.user.update({ data: { productGuideCompletedAt: new Date() }, where: { id: user.id } });
  return NextResponse.json({ ok: true });
}
