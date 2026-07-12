import process from "node:process";
import { messengerAiService } from "../lib/server/messenger/messengerAiService";

let stopping = false;
let nextCleanupAt = 0;

async function work() {
  while (!stopping) {
    if (Date.now() >= nextCleanupAt) {
      await messengerAiService.cleanupExpiredAttachments().catch(() => undefined);
      nextCleanupAt = Date.now() + 60_000;
    }
    const processed = await messengerAiService.processNext().catch(() => false);
    if (!processed) await delay(500);
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

void work().catch(() => {
  process.exitCode = 1;
});
