import { messengerAttachmentService } from "../lib/server/messenger/attachmentService";
import { messengerObjectStorage } from "../lib/server/messenger/objectStorage";
import { prisma } from "../lib/server/prisma";

let attachmentId: string | null = null;
let storageKey: string | null = null;

async function main() {
  const membership = await prisma.messengerConversationMember.findFirst({
    include: {
      conversation: true,
      user: { include: { memberships: true } }
    },
    where: {
      conversation: { kind: "general" },
      state: "active",
      user: {
        memberships: { some: { role: { in: ["owner", "editor"] } } }
      }
    }
  });
  if (!membership) throw new Error("No writable Messenger membership is available for storage smoke testing");
  const workspaceMembership = membership.user.memberships.find((item) => item.workspaceId === membership.conversation.workspaceId);
  if (!workspaceMembership) throw new Error("Messenger workspace membership is missing");
  const content = "Slate storage smoke";
  const reserved = await messengerAttachmentService.reserve(
    membership.userId,
    membership.conversation.workspaceId,
    membership.conversationId,
    {
      byteSize: Buffer.byteLength(content),
      declaredContentType: "text/plain",
      fileName: "storage-smoke.txt",
      kind: "file"
    }
  );
  attachmentId = reserved.attachment.id;
  const row = await prisma.messengerMessageAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
  storageKey = row.storageKey;
  const form = new FormData();
  for (const [name, value] of Object.entries(reserved.upload.fields)) form.append(name, value);
  form.append("file", new Blob([content], { type: "text/plain" }), "storage-smoke.txt");
  const uploadResponse = await fetch(reserved.upload.url, { body: form, method: "POST" });
  if (uploadResponse.status !== 201) throw new Error(`Storage upload failed with ${uploadResponse.status}`);
  const stored = await messengerObjectStorage.headObject(storageKey);
  const completed = await messengerAttachmentService.complete(
    membership.userId,
    membership.conversation.workspaceId,
    membership.conversationId,
    attachmentId,
    { checksum: null, etag: stored.etag }
  );
  if (completed.status !== "uploaded") throw new Error("Attachment did not reach uploaded state");
  const mediaJob = await prisma.messengerMediaJob.findUnique({ where: { attachmentId } });
  if (!mediaJob || mediaJob.status !== "pending") throw new Error("Attachment media job was not created");
  const rejectedKey = `messenger/${membership.conversation.workspaceId}/smoke-rejected/${randomUUID()}`;
  const rejectedOperation = await messengerObjectStorage.createUpload({
    attachmentId: randomUUID(),
    byteSize: Buffer.byteLength(content) + 1,
    contentType: "text/plain",
    storageKey: rejectedKey
  });
  const rejectedForm = new FormData();
  for (const [name, value] of Object.entries(rejectedOperation.fields)) rejectedForm.append(name, value);
  rejectedForm.append("file", new Blob([content], { type: "text/plain" }), "rejected.txt");
  const rejectedResponse = await fetch(rejectedOperation.url, { body: rejectedForm, method: "POST" });
  if (rejectedResponse.ok) throw new Error("Storage accepted an object outside the exact size policy");
  await messengerObjectStorage.deleteObject(rejectedKey).catch(() => undefined);
  await messengerAttachmentService.abandon(
    membership.userId,
    membership.conversation.workspaceId,
    membership.conversationId,
    attachmentId
  );
  process.stdout.write(`${JSON.stringify({ attachmentId, byteSize: stored.byteSize, status: "ok" })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger storage smoke failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (storageKey) await messengerObjectStorage.deleteObject(storageKey).catch(() => undefined);
    if (attachmentId) {
      await prisma.messengerOutboxEvent.deleteMany({
        where: { payload: { equals: { attachmentId, status: "uploaded" } }, type: "attachment.changed" }
      }).catch(() => undefined);
      await prisma.messengerMessageAttachment.deleteMany({ where: { id: attachmentId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });
import { randomUUID } from "node:crypto";
