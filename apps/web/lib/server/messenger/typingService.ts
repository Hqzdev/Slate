import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { redis } from "../redis";
import { MessengerDomainError } from "./errors";

type TypingInput = {
  active: boolean;
  conversationId: string;
  userId: string;
  workspaceId: string;
};

type TypingPublisher = Pick<Redis, "publish">;

export class MessengerTypingService {
  constructor(
    private readonly publisher: TypingPublisher = redis,
    private readonly createEventId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date()
  ) {}

  async publish(input: TypingInput) {
    try {
      await this.publisher.publish(`slate:messenger:workspace:${input.workspaceId}`, JSON.stringify({
        conversationId: input.conversationId,
        eventId: this.createEventId(),
        occurredAt: this.now().toISOString(),
        payload: { active: input.active ? "start" : "stop", userId: input.userId },
        targetUserId: null,
        type: "typing.changed",
        v: 1,
        workspaceId: input.workspaceId
      }));
    } catch {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime is unavailable", 503, true);
    }
  }
}

export const messengerTypingService = new MessengerTypingService();
