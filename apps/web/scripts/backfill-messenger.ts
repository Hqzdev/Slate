import { prisma } from "../lib/server/prisma";
import { messengerProvisioningCoordinator } from "../lib/server/messenger/provisioningService";

const configuredBatchSize = Number(process.env.MESSENGER_BACKFILL_BATCH_SIZE ?? 100);
const batchSize = Number.isInteger(configuredBatchSize) && configuredBatchSize >= 1 && configuredBatchSize <= 500
  ? configuredBatchSize
  : 100;
let lastCompletedCursor: string | null = null;
let processedWorkspaceCount = 0;

async function main() {
  let cursor: string | undefined;
  let workspaceCount = 0;
  let membershipsActivated = 0;
  let membershipsRevoked = 0;
  let receiptsCreated = 0;
  let keysCreated = 0;

  try {
    while (true) {
      const workspaces = await prisma.workspace.findMany({
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: "asc" },
        select: { id: true },
        skip: cursor ? 1 : 0,
        take: batchSize
      });
      if (workspaces.length === 0) break;
      for (const workspace of workspaces) {
        const result = await messengerProvisioningCoordinator.reconcileWorkspace(workspace.id);
        workspaceCount += 1;
        processedWorkspaceCount = workspaceCount;
        membershipsActivated += result.membershipsActivated;
        membershipsRevoked += result.membershipsRevoked;
        receiptsCreated += result.receiptsCreated;
        if (result.keyCreated) keysCreated += 1;
      }
      cursor = workspaces.at(-1)?.id;
      lastCompletedCursor = cursor ?? null;
      process.stdout.write(`${JSON.stringify({ cursor, workspaceCount })}\n`);
    }
    process.stdout.write(`${JSON.stringify({
      keysCreated,
      membershipsActivated,
      membershipsRevoked,
      receiptsCreated,
      status: "complete",
      workspaceCount
    })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    cursor: lastCompletedCursor,
    errorCode: safeErrorCode(error),
    status: "failed",
    workspaceCount: processedWorkspaceCount
  })}\n`);
  process.exitCode = 1;
});

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown_error";
}
