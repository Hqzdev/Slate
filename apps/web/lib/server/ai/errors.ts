export class AiDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "AiDomainError";
  }
}

export function toAiDomainError(error: unknown) {
  if (error instanceof AiDomainError) return error;
  if (error instanceof Error && error.message === "Workspace access denied") {
    return new AiDomainError("workspace_access_denied", error.message, 403);
  }
  return new AiDomainError("ai_internal_error", "AI request failed", 500);
}
