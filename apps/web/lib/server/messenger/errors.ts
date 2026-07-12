export class MessengerDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "MessengerDomainError";
  }
}

export function toMessengerDomainError(error: unknown) {
  if (error instanceof MessengerDomainError) return error;
  if (error instanceof Error && error.message === "Workspace access denied") {
    return new MessengerDomainError("resource_not_found", "Resource was not found", 404);
  }
  return new MessengerDomainError("messenger_unavailable", "Messenger is temporarily unavailable", 503, true);
}
