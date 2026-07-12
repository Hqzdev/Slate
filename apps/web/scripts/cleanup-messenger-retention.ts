import { prisma } from "../lib/server/prisma";
import { messengerRetentionService } from "../lib/server/messenger/retentionService";

async function main() {
  const batchSize = readBatchSize(process.env.MESSENGER_RETENTION_BATCH_SIZE);
  const tombstones = await messengerRetentionService.replayTombstones(batchSize);
  const total = { attachmentsDeleted: 0, messagesCompleted: 0, messagesMarked: 0 };
  while (true) {
    const result = await messengerRetentionService.runBatch(batchSize);
    total.attachmentsDeleted += result.attachmentsDeleted;
    total.messagesCompleted += result.messagesCompleted;
    total.messagesMarked += result.messagesMarked;
    if (result.messagesMarked < batchSize && result.messagesCompleted < batchSize && result.attachmentsDeleted < batchSize) break;
  }
  process.stdout.write(`${JSON.stringify({ ...total, tombstones, status: "ok" })}\n`);
}

function readBatchSize(value: string | undefined) {
  const parsed = Number(value ?? "100");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) throw new Error("MESSENGER_RETENTION_BATCH_SIZE must be an integer between 1 and 500");
  return parsed;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger retention cleanup failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
