import { prisma } from "../prisma";

const provisionalLifetimeMs = 24 * 60 * 60 * 1_000;

type DirectConversationCleanupClient = Pick<typeof prisma, "messengerConversation">;

export class DirectConversationCleanupService {
  constructor(
    private readonly client: DirectConversationCleanupClient = prisma,
    private readonly now: () => Date = () => new Date()
  ) {}

  async runBatch(limit = 100) {
    const expiredBefore = new Date(this.now().getTime() - provisionalLifetimeMs);
    const conversations = await this.client.messengerConversation.findMany({
      select: { id: true },
      take: limit,
      where: {
        activatedAt: null,
        attachments: { none: {} },
        createdAt: { lte: expiredBefore },
        kind: "direct",
        messages: { none: {} }
      }
    });
    if (conversations.length === 0) return { deleted: 0, scanned: 0 };
    const deleted = await this.client.messengerConversation.deleteMany({
      where: {
        activatedAt: null,
        attachments: { none: {} },
        id: { in: conversations.map((conversation) => conversation.id) },
        kind: "direct",
        messages: { none: {} }
      }
    });
    return { deleted: deleted.count, scanned: conversations.length };
  }
}

export const directConversationCleanupService = new DirectConversationCleanupService();
