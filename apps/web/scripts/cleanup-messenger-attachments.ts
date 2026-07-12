import { messengerAttachmentCleanupService } from "../lib/server/messenger/attachmentCleanupService";
import { prisma } from "../lib/server/prisma";

async function main() {
  let totalDeleted = 0;
  while (true) {
    const result = await messengerAttachmentCleanupService.runBatch();
    totalDeleted += result.deleted;
    if (result.scanned < 100) break;
  }
  process.stdout.write(`${JSON.stringify({ deleted: totalDeleted, status: "ok" })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger attachment cleanup failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
