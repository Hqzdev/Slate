import { redis } from "./redis";
import { messengerMediaStreamRegistry } from "./messenger/mediaStreamRegistry";

const accessRevocationChannel = "slate:sync:access-revoked";

export class RealtimeAccessRevocationPublisher {
  async publish(workspaceId: string, userId: string) {
    messengerMediaStreamRegistry.revoke(workspaceId, userId);
    try {
      await redis.publish(accessRevocationChannel, JSON.stringify({ userId, workspaceId }));
      return true;
    } catch {
      return false;
    }
  }
}

export const realtimeAccessRevocationPublisher = new RealtimeAccessRevocationPublisher();
