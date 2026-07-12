import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

export type MessengerOutboxInput = {
  conversationId?: string | null;
  payload: Prisma.InputJsonValue;
  targetUserId?: string | null;
  type: string;
  workspaceId: string;
};

type MessengerOutboxClient = {
  messengerOutboxEvent: {
    create(input: {
      data: {
        conversationId: string | null;
        eventId: string;
        payload: Prisma.InputJsonValue;
        targetUserId: string | null;
        type: string;
        workspaceId: string;
      };
    }): Promise<unknown>;
  };
};

export class MessengerOutboxRepository {
  constructor(private readonly eventIdFactory: () => string = randomUUID) {}

  async append(client: MessengerOutboxClient, input: MessengerOutboxInput) {
    return client.messengerOutboxEvent.create({
      data: {
        conversationId: input.conversationId ?? null,
        eventId: this.eventIdFactory(),
        payload: input.payload,
        targetUserId: input.targetUserId ?? null,
        type: input.type,
        workspaceId: input.workspaceId
      }
    });
  }
}

export const messengerOutboxRepository = new MessengerOutboxRepository();
