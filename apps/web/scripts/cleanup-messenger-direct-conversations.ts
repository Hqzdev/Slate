import { directConversationCleanupService } from "../lib/server/messenger/directConversationCleanupService";
import { prisma } from "../lib/server/prisma";

async function main() {
  let deleted = 0;
  while (true) {
    const result = await directConversationCleanupService.runBatch();
    deleted += result.deleted;
    if (result.scanned < 100) break;
  }
  process.stdout.write(`${JSON.stringify({ deleted, status: "ok" })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger direct conversation cleanup failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
