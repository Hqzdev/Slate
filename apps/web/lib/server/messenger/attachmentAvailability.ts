import { MessengerDomainError } from "./errors";

export class MessengerAttachmentAvailability {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  requireEnabled() {
    if (this.environment.MESSENGER_ATTACHMENTS_ENABLED !== "true") {
      throw new MessengerDomainError("attachments_unavailable", "Messenger attachments are not enabled", 503, true);
    }
  }
}

export const messengerAttachmentAvailability = new MessengerAttachmentAvailability();
