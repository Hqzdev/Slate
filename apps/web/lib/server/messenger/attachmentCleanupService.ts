import { prisma } from "../prisma";
import { messengerObjectStorage, type MessengerObjectStorage } from "./objectStorage";

type AttachmentCleanupClient = Pick<typeof prisma, "messengerMessageAttachment">;

export class MessengerAttachmentCleanupService {
  constructor(
    private readonly client: AttachmentCleanupClient = prisma,
    private readonly objectStorage: Pick<MessengerObjectStorage, "deleteObject"> = messengerObjectStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

  async runBatch(limit = 100) {
    const now = this.now();
    const attachments = await this.client.messengerMessageAttachment.findMany({
      orderBy: { createdAt: "asc" },
      take: limit,
      where: {
        deletedAt: null,
        OR: [
          { status: { in: ["deleting", "rejected", "expired"] } },
          { expiresAt: { lte: now }, status: { in: ["reserved", "ready"] } }
        ]
      }
    });
    let deleted = 0;
    for (const attachment of attachments) {
      const claimed = await this.client.messengerMessageAttachment.updateMany({
        data: { status: "deleting" },
        where: { deletedAt: null, id: attachment.id, status: attachment.status }
      });
      if (claimed.count !== 1) continue;
      try {
        const keys = [attachment.storageKey, attachment.thumbnailStorageKey, attachment.posterStorageKey].filter((key): key is string => Boolean(key));
        await Promise.all(keys.map((key) => this.objectStorage.deleteObject(key)));
        await this.client.messengerMessageAttachment.update({
          data: { deletedAt: this.now() },
          where: { id: attachment.id }
        });
        deleted += 1;
      } catch {}
    }
    return { deleted, scanned: attachments.length };
  }
}

export const messengerAttachmentCleanupService = new MessengerAttachmentCleanupService();
