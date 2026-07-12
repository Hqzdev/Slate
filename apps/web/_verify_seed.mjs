import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
const prisma = new PrismaClient();
const tag = "verify_" + Date.now();
const user = await prisma.user.create({ data: { email: `${tag}@t.io`, name: "Verify", initials: "VE", color: "blue" } });
const keyId = process.env.MESSENGER_KEY_ID?.trim() || "local-development-v1";
const wrappingKey = process.env.MESSENGER_KEY_ENCRYPTION_KEY
  ? Buffer.from(process.env.MESSENGER_KEY_ENCRYPTION_KEY, "base64")
  : createHash("sha256").update("slate-local-messenger-wrapping-key-v1").digest();
const result = await prisma.$transaction(async (transaction) => {
  const ws = await transaction.workspace.create({ data: { createdByUserId: user.id, slug: tag, name: "Verify WS" } });
  await transaction.workspaceSettings.create({ data: { workspaceId: ws.id } });
  await transaction.workspaceMember.create({ data: { role: "owner", userId: user.id, workspaceId: ws.id } });
  const general = await transaction.messengerConversation.create({ data: { activatedAt: new Date(), generalKey: ws.id, kind: "general", workspaceId: ws.id } });
  await transaction.messengerConversationMember.create({ data: { conversationId: general.id, userId: user.id } });
  await transaction.messengerMessageReceipt.create({ data: { conversationId: general.id, userId: user.id } });
  const dataKey = randomBytes(32);
  const wrapNonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, wrapNonce);
  cipher.setAAD(Buffer.from(`slate:messenger:key-envelope:v1:${ws.id}:1:${keyId}`));
  const wrappedDataKey = Buffer.concat([cipher.update(dataKey), cipher.final(), cipher.getAuthTag()]);
  dataKey.fill(0);
  await transaction.messengerKeyEnvelope.create({
    data: {
      activatedAt: new Date(),
      algorithm: "aes-256-gcm-v1",
      kmsKeyId: keyId,
      version: 1,
      workspaceId: ws.id,
      wrapNonce,
      wrappedDataKey
    }
  });
  const doc = await transaction.document.create({ data: { title: "canvas.slate", type: "canvas", position: 0, workspaceId: ws.id, canvasState: { version: 1, shapes: [], viewport: { panX: 0, panY: 0, zoom: 1 } } } });
  return { doc, ws };
});
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("base64url");
await prisma.session.create({ data: { tokenHash, expiresAt: new Date(Date.now() + 3600_000), userId: user.id } });
console.log(JSON.stringify({ token, documentId: result.doc.id, workspaceId: result.ws.id }));
await prisma.$disconnect();
