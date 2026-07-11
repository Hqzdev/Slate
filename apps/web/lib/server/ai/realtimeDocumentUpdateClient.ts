import { AiDomainError } from "./errors";
import { hashDocumentContent } from "./documentUpdateDraft";

export type RealtimeDocumentUpdateInput = {
  actionId: string;
  content: string;
  documentId: string;
  documentType: "code" | "note";
  expectedContentHash: string;
  roomName: string;
  workspaceId: string;
};

export type RealtimeDocumentUpdateResult = {
  actionId: string;
  applied: boolean;
  contentHash: string;
  documentId: string;
  documentType: "code" | "note";
  roomName: string;
};

type RealtimeDocumentUpdateClientOptions = {
  fetchImpl?: typeof fetch;
  secret?: string;
  timeoutMs?: number;
  url?: string;
};

export class RealtimeDocumentUpdateClient {
  private readonly fetchImpl: typeof fetch;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: RealtimeDocumentUpdateClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.secret = options.secret ?? process.env.SYNC_INTERNAL_API_SECRET?.trim() ?? "";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.url = options.url ?? process.env.SYNC_INTERNAL_URL?.trim() ?? "http://127.0.0.1:1234";
  }

  async applyTextReplacement(input: RealtimeDocumentUpdateInput): Promise<RealtimeDocumentUpdateResult> {
    if (this.secret.length < 32) {
      throw new AiDomainError("realtime_update_not_configured", "Realtime document updates are not configured", 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/internal/realtime/text-replace`, {
        body: JSON.stringify(input),
        headers: {
          Authorization: `Bearer ${this.secret}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: controller.signal
      });
      const body = await readResponseBody(response);
      if (response.status === 409) {
        if (responseErrorCode(body) === "idempotency_conflict") {
          throw new AiDomainError("realtime_idempotency_conflict", "The realtime update receipt conflicts with this draft", 409);
        }
        throw new AiDomainError("document_version_conflict", "The document changed after this draft was prepared", 409);
      }
      if (!response.ok) {
        if (response.status === 503 || response.status === 429 || response.status >= 500) {
          throw new AiDomainError("realtime_update_unavailable", "Realtime document update is temporarily unavailable", 503, true);
        }
        if (response.status === 401 || response.status === 403) {
          throw new AiDomainError("realtime_update_unauthorized", "Realtime document update authorization failed", 503);
        }
        throw new AiDomainError("realtime_update_rejected", responseMessage(body, "Realtime document update was rejected"), 422);
      }
      return parseResult(body, input);
    } catch (error) {
      if (error instanceof AiDomainError) throw error;
      if (controller.signal.aborted) {
        throw new AiDomainError("realtime_update_timeout", "Realtime document update timed out", 504, true);
      }
      throw new AiDomainError("realtime_update_unavailable", "Realtime document update is temporarily unavailable", 503, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function responseMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const message = (value as Record<string, unknown>).message;
  return typeof message === "string" && message.length <= 300 ? message : fallback;
}

function responseErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as Record<string, unknown>).error;
  return typeof code === "string" ? code : null;
}

function parseResult(value: unknown, input: RealtimeDocumentUpdateInput): RealtimeDocumentUpdateResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDomainError("realtime_update_invalid_response", "Realtime document update returned an invalid response", 502, true);
  }
  const result = value as Record<string, unknown>;
  if (
    result.actionId !== input.actionId
    || typeof result.applied !== "boolean"
    || result.contentHash !== hashDocumentContent(input.content)
    || result.documentId !== input.documentId
    || result.documentType !== input.documentType
    || result.roomName !== input.roomName
  ) {
    throw new AiDomainError("realtime_update_invalid_response", "Realtime document update returned an invalid response", 502, true);
  }
  return result as RealtimeDocumentUpdateResult;
}

export const realtimeDocumentUpdateClient = new RealtimeDocumentUpdateClient();
