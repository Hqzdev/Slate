import { MessengerDomainError } from "./errors";

export class MessengerRealtimeConfiguration {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  requireEnabled() {
    if (this.environment.MESSENGER_REALTIME_ENABLED !== "true") {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime is not enabled", 503, true);
    }
  }

  getSocketUrl() {
    const configured = this.environment.MESSENGER_REALTIME_PUBLIC_URL;
    if (!configured && this.environment.NODE_ENV === "production") {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime is not configured", 503, true);
    }
    const value = configured ?? "ws://127.0.0.1:1236/messenger";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime URL is invalid", 503, true);
    }
    if (!new Set(["ws:", "wss:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime URL is invalid", 503, true);
    }
    if (this.environment.NODE_ENV === "production" && url.protocol !== "wss:") {
      throw new MessengerDomainError("realtime_unavailable", "Messenger realtime requires TLS", 503, true);
    }
    return url.toString();
  }
}

export const messengerRealtimeConfiguration = new MessengerRealtimeConfiguration();
