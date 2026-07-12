import { createHash } from "node:crypto";
import { messengerAttachmentService } from "../lib/server/messenger/attachmentService";
import { messengerObjectStorage } from "../lib/server/messenger/objectStorage";
import { prisma } from "../lib/server/prisma";

type SmokeContext = {
  conversationId: string;
  userId: string;
  workspaceId: string;
};

type UploadedAttachment = {
  attachmentId: string;
  storageKey: string;
};

const attachmentIds: string[] = [];
const storageKeys = new Set<string>();

async function main() {
  const context = await findSmokeContext();
  const cleanImage = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQSbnzH4QZYAwATUwJTb1H+cwAAAAASUVORK5CYII=",
    "base64"
  );
  const clean = await upload(context, {
    content: cleanImage,
    contentType: "image/png",
    fileName: "media-smoke.png",
    kind: "image"
  });
  const ready = await waitForTerminalState(clean.attachmentId);
  if (ready.status !== "ready") throw new Error(`Clean image reached ${ready.status}:${ready.rejectionCode ?? "unknown"}`);
  if (ready.detectedContentType !== "image/png" || ready.verifiedByteSize !== BigInt(cleanImage.byteLength)) {
    throw new Error("Clean image metadata was not verified");
  }
  if (ready.width !== 2 || ready.height !== 2 || !ready.thumbnailStorageKey) {
    throw new Error("Clean image preview metadata is incomplete");
  }
  if (ready.checksumSha256 !== createHash("sha256").update(cleanImage).digest("hex")) {
    throw new Error("Clean image checksum is incorrect");
  }
  storageKeys.add(ready.thumbnailStorageKey);
  const thumbnail = await messengerObjectStorage.headObject(ready.thumbnailStorageKey);
  if (thumbnail.contentType !== "image/webp" || thumbnail.byteSize < 1) {
    throw new Error("Clean image thumbnail is invalid");
  }
  const thumbnailRange = await messengerObjectStorage.readObject(ready.thumbnailStorageKey, "bytes=0-0");
  const thumbnailReader = thumbnailRange.body.getReader();
  const firstByte = await thumbnailReader.read();
  await thumbnailReader.cancel();
  if (thumbnailRange.byteSize !== 1 || thumbnailRange.contentRange !== `bytes 0-0/${thumbnail.byteSize}` || firstByte.value?.byteLength !== 1) {
    throw new Error("Clean image thumbnail range delivery is invalid");
  }
  const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  const infected = await upload(context, {
    content: eicar,
    contentType: "text/plain",
    fileName: "malware-smoke.txt",
    kind: "file"
  });
  const rejected = await waitForTerminalState(infected.attachmentId);
  if (rejected.status !== "rejected" || rejected.rejectionCode !== "malware_detected") {
    throw new Error(`Malware sample reached ${rejected.status}:${rejected.rejectionCode ?? "unknown"}`);
  }
  const jobs = await prisma.messengerMediaJob.findMany({
    where: { attachmentId: { in: [clean.attachmentId, infected.attachmentId] } }
  });
  if (jobs.length !== 2 || jobs.some((job) => job.status !== "completed" || !job.completedAt)) {
    throw new Error("Media jobs did not complete terminally");
  }
  process.stdout.write(`${JSON.stringify({ clean: "ready", malware: "rejected", thumbnail: "verified" })}\n`);
}

async function findSmokeContext(): Promise<SmokeContext> {
  const membership = await prisma.messengerConversationMember.findFirst({
    include: {
      conversation: true,
      user: { include: { memberships: true } }
    },
    where: {
      conversation: { kind: "general" },
      state: "active",
      user: { memberships: { some: { role: { in: ["owner", "editor"] } } } }
    }
  });
  if (!membership) throw new Error("No writable Messenger membership is available for media smoke testing");
  const workspaceMembership = membership.user.memberships.find(
    (item) => item.workspaceId === membership.conversation.workspaceId
  );
  if (!workspaceMembership) throw new Error("Messenger workspace membership is missing");
  return {
    conversationId: membership.conversationId,
    userId: membership.userId,
    workspaceId: membership.conversation.workspaceId
  };
}

async function upload(
  context: SmokeContext,
  input: { content: Buffer; contentType: string; fileName: string; kind: "file" | "image" }
): Promise<UploadedAttachment> {
  const reserved = await messengerAttachmentService.reserve(
    context.userId,
    context.workspaceId,
    context.conversationId,
    {
      byteSize: input.content.byteLength,
      declaredContentType: input.contentType,
      fileName: input.fileName,
      kind: input.kind
    }
  );
  attachmentIds.push(reserved.attachment.id);
  const attachment = await prisma.messengerMessageAttachment.findUniqueOrThrow({
    where: { id: reserved.attachment.id }
  });
  storageKeys.add(attachment.storageKey);
  const form = new FormData();
  for (const [name, value] of Object.entries(reserved.upload.fields)) form.append(name, value);
  form.append("file", new Blob([new Uint8Array(input.content)], { type: input.contentType }), input.fileName);
  const response = await fetch(reserved.upload.url, { body: form, method: "POST" });
  if (response.status !== 201) throw new Error(`Storage upload failed with ${response.status}`);
  const stored = await messengerObjectStorage.headObject(attachment.storageKey);
  await messengerAttachmentService.complete(
    context.userId,
    context.workspaceId,
    context.conversationId,
    attachment.id,
    { checksum: null, etag: stored.etag }
  );
  return { attachmentId: attachment.id, storageKey: attachment.storageKey };
}

async function waitForTerminalState(attachmentId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const attachment = await prisma.messengerMessageAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    if (attachment.status === "ready" || attachment.status === "rejected") return attachment;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const [attachment, job] = await Promise.all([
    prisma.messengerMessageAttachment.findUnique({ where: { id: attachmentId } }),
    prisma.messengerMediaJob.findUnique({ where: { attachmentId } })
  ]);
  throw new Error(`Media processing timed out: ${JSON.stringify({
    attachmentStatus: attachment?.status,
    attemptCount: job?.attemptCount,
    jobStatus: job?.status,
    lastErrorCode: job?.lastErrorCode
  })}`);
}

async function cleanup() {
  for (const storageKey of storageKeys) {
    await messengerObjectStorage.deleteObject(storageKey).catch(() => undefined);
  }
  if (attachmentIds.length === 0) return;
  const events = await prisma.messengerOutboxEvent.findMany({ where: { type: "attachment.changed" } });
  const eventIds = events
    .filter((event) => {
      const payload = event.payload as { attachmentId?: unknown };
      return typeof payload?.attachmentId === "string" && attachmentIds.includes(payload.attachmentId);
    })
    .map((event) => event.id);
  await prisma.messengerOutboxEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
  await prisma.messengerMessageAttachment.deleteMany({ where: { id: { in: attachmentIds } } }).catch(() => undefined);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Messenger media smoke failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
