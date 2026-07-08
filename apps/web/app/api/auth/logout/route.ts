import { NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  await authService.destroyCurrentSession();
  const response = NextResponse.json({ ok: true });
  authService.clearSessionCookie(response);
  return response;
}
