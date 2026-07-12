import { MessengerDomainError } from "./errors";

export function createDirectPairKey(firstUserId: string, secondUserId: string) {
  if (firstUserId === secondUserId) {
    throw new MessengerDomainError("invalid_recipient", "A direct conversation requires another member", 400);
  }
  return [firstUserId, secondUserId].sort().join(":");
}
