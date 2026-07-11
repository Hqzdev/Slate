import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { redis } from "@/lib/server/redis";

export const runtime = "nodejs";

export async function GET() {
  const [aiStorage, database, redisStatus] = await Promise.all([aiStorageHealth(), databaseHealth(), redisHealth()]);
  const ok = aiStorage === "ready" && database === "connected" && redisStatus === "connected";

  return NextResponse.json(
    {
      aiStorage,
      database,
      ok,
      redis: redisStatus,
      service: "web"
    },
    { status: ok ? 200 : 503 }
  );
}

async function aiStorageHealth() {
  try {
    await Promise.all([
      prisma.aiConversation.count(),
      prisma.aiDraftAction.count(),
      prisma.aiMessage.count()
    ]);
    return "ready";
  } catch {
    return "error";
  }
}

async function databaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "error";
  }
}

async function redisHealth() {
  try {
    await redis.ping();
    return "connected";
  } catch {
    return "error";
  }
}
