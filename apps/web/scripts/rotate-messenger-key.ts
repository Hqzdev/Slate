import { prisma } from "../lib/server/prisma";
import { messengerKeyEnvelopeService } from "../lib/server/messenger/keyEnvelopeService";

async function main() {
  const workspaceId = process.env.MESSENGER_ROTATE_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error("MESSENGER_ROTATE_WORKSPACE_ID is required");
  const result = await messengerKeyEnvelopeService.rotateActiveKey(workspaceId);
  process.stdout.write(`${JSON.stringify({ ...result, status: "ok", workspaceId })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger key rotation failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
