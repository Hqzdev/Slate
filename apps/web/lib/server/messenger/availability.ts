import { MessengerDomainError } from "./errors";

export class MessengerAvailability {
  constructor(private readonly enabledValue: () => string | undefined = () => process.env.MESSENGER_ENABLED) {}

  requireEnabled() {
    if (this.enabledValue()?.trim().toLowerCase() !== "true") {
      throw new MessengerDomainError("messenger_unavailable", "Messenger is not enabled", 503);
    }
  }
}

export const messengerAvailability = new MessengerAvailability();
