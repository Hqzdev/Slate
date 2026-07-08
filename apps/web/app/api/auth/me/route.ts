import { NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await authService.getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({ user });
}
