import { randomUUID } from "node:crypto";
import { isDatabaseSafeText } from "../../databaseSafeText";
import { AiDomainError } from "./errors";
import type { AiProvider, AiProviderMessage, AiProviderRequest, AiProviderResponse, AiProviderToolCall } from "./types";

export type GigaChatConfig = {
  apiBaseUrl: string;
  authorizationKey: string;
  authUrl: string;
  model: string;
  scope: string;
};

type GigaChatClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestId?: () => string;
  timeoutMs?: number;
};

type CachedToken = {
  expiresAt: number;
  value: string;
};

type GigaChatHttpResponse = {
  body: unknown;
  headers: Headers;
  ok: boolean;
  status: number;
};

const maximumAuthResponseChars = 64_000;
const maximumCompletionResponseChars = 2_000_000;

export class GigaChatClient implements AiProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly requestId: () => string;
  private readonly timeoutMs: number;
  private cachedToken: CachedToken | null = null;
  private pendingToken: Promise<CachedToken> | null = null;

  constructor(private readonly config: GigaChatConfig, options: GigaChatClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    const firstToken = await this.getAccessToken(request.signal);
    const firstResponse = await this.requestCompletion(firstToken, request);
    if (firstResponse.status !== 401) return this.readCompletion(firstResponse);

    this.cachedToken = null;
    const refreshedToken = await this.getAccessToken(request.signal);
    const refreshedResponse = await this.requestCompletion(refreshedToken, request);
    return this.readCompletion(refreshedResponse);
  }

  private async getAccessToken(signal?: AbortSignal) {
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > this.now()) {
      return this.cachedToken.value;
    }
    if (!this.pendingToken) {
      this.pendingToken = this.requestAccessToken(signal).finally(() => {
        this.pendingToken = null;
      });
    }
    const token = await this.pendingToken;
    this.cachedToken = token;
    return token.value;
  }

  private async requestAccessToken(signal?: AbortSignal): Promise<CachedToken> {
    const response = await this.requestJson(this.config.authUrl, {
      body: new URLSearchParams({ scope: this.config.scope }),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${this.config.authorizationKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        RqUID: this.requestId()
      },
      method: "POST"
    }, maximumAuthResponseChars, signal);

    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new AiDomainError("provider_authentication_failed", "GigaChat credentials were rejected", 503);
      }
      throw this.providerHttpError(response.status, "GigaChat authentication failed");
    }

    const body = response.body as Record<string, unknown> | null;
    const value = typeof body?.access_token === "string" ? body.access_token : "";
    if (!value) {
      throw new AiDomainError("provider_invalid_response", "GigaChat authentication returned an invalid response", 502, true);
    }

    return {
      expiresAt: resolveTokenExpiry(body ?? {}, this.now()),
      value
    };
  }

  private requestCompletion(token: string, request: AiProviderRequest) {
    const url = `${this.config.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    return this.requestJson(url, {
      body: JSON.stringify({
        function_call: "auto",
        functions: request.tools.map((tool) => ({
          description: tool.description,
          name: tool.name,
          parameters: tool.parameters
        })),
        messages: request.messages.map(toGigaChatMessage),
        model: this.config.model,
        stream: false
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }, maximumCompletionResponseChars, request.signal);
  }

  private readCompletion(response: GigaChatHttpResponse) {
    if (!response.ok) {
      throw this.providerHttpError(response.status, "GigaChat completion failed");
    }
    return normalizeGigaChatResponse(response.body, response.headers.get("x-request-id"));
  }

  private async requestJson(url: string, init: RequestInit, maximumChars: number, externalSignal?: AbortSignal): Promise<GigaChatHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const body = response.ok ? await readJsonResponse(response, maximumChars) : null;
      return {
        body,
        headers: response.headers,
        ok: response.ok,
        status: response.status
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AiDomainError("provider_timeout", "GigaChat request timed out", 504, true);
      }
      if (error instanceof AiDomainError) throw error;
      if (isCertificateError(error)) {
        throw new AiDomainError("provider_certificate_error", "GigaChat TLS certificate is not trusted. Configure NODE_EXTRA_CA_CERTS before starting Slate.", 503);
      }
      throw new AiDomainError("provider_unavailable", "GigaChat is unavailable", 503, true);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  private providerHttpError(status: number, message: string) {
    if (status === 429) return new AiDomainError("provider_rate_limited", message, 503, true);
    if (status >= 500) return new AiDomainError("provider_unavailable", message, 503, true);
    return new AiDomainError("provider_rejected_request", message, 502);
  }
}

export function loadGigaChatConfig(environment: Record<string, string | undefined> = process.env): GigaChatConfig {
  const clientId = environment.GIGACHAT_CLIENT_ID?.trim() ?? "";
  const clientSecret = environment.GIGACHAT_CLIENT_SECRET?.trim() ?? "";
  const config = {
    apiBaseUrl: environment.GIGACHAT_API_BASE_URL?.trim() ?? "",
    authorizationKey: resolveAuthorizationKey(
      environment.GIGACHAT_AUTHORIZATION_KEY?.trim() ?? "",
      clientId,
      clientSecret
    ),
    authUrl: environment.GIGACHAT_AUTH_URL?.trim() ?? "",
    model: environment.GIGACHAT_MODEL?.trim() ?? "",
    scope: environment.GIGACHAT_SCOPE?.trim() ?? ""
  };
  if (Object.values(config).some((value) => value.length === 0)) {
    throw new AiDomainError("provider_not_configured", "GigaChat is not configured", 503);
  }
  validateProviderUrl(config.authUrl, "GIGACHAT_AUTH_URL");
  validateProviderUrl(config.apiBaseUrl, "GIGACHAT_API_BASE_URL");
  return config;
}

function resolveAuthorizationKey(explicitKey: string, clientId: string, clientSecret: string) {
  if (explicitKey) return validateAuthorizationKey(explicitKey);
  if (!clientId || !clientSecret) return "";
  if (isEncodedClientCredential(clientSecret, clientId)) return validateAuthorizationKey(clientSecret);
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function isEncodedClientCredential(value: string, clientId: string) {
  if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return decoded.startsWith(`${clientId}:`) && decoded.length > clientId.length + 1;
}

function validateAuthorizationKey(value: string) {
  if (value.length > 8_192 || !/^[A-Za-z0-9+/]+=*$/.test(value)) {
    throw new AiDomainError("provider_not_configured", "GigaChat authorization key is invalid", 503);
  }
  return value;
}

export function normalizeGigaChatResponse(value: unknown, headerRequestId: string | null = null): AiProviderResponse {
  if (!value || typeof value !== "object") {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned an invalid response", 502, true);
  }
  const body = value as Record<string, unknown>;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned no completion", 502, true);
  }
  const choice = firstChoice as Record<string, unknown>;
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
  if (finishReason && finishReason !== "stop" && finishReason !== "function_call") {
    if (finishReason === "blacklist") {
      throw new AiDomainError("provider_content_blocked", "GigaChat blocked the completion", 422);
    }
    throw new AiDomainError("provider_incomplete_response", `GigaChat stopped with ${finishReason}`, 502, true);
  }
  const message = choice.message;
  if (!message || typeof message !== "object") {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned no assistant message", 502, true);
  }
  const record = message as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!isDatabaseSafeText(content)) {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned unsupported text", 502, true);
  }
  const toolCalls = normalizeToolCalls(record);
  if (!content && toolCalls.length === 0) {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned an empty completion", 502, true);
  }
  const requestIdCandidate = headerRequestId || (typeof body.request_id === "string" ? body.request_id : null);
  const requestId = requestIdCandidate && requestIdCandidate.length <= 256 && isDatabaseSafeText(requestIdCandidate) ? requestIdCandidate : null;
  const functionsStateCandidate = typeof record.functions_state_id === "string" ? record.functions_state_id : null;
  if (functionsStateCandidate && (functionsStateCandidate.length > 4_096 || !isDatabaseSafeText(functionsStateCandidate))) {
    throw new AiDomainError("provider_invalid_response", "GigaChat returned an invalid function state", 502, true);
  }
  const functionsStateId = functionsStateCandidate;
  return { content, functionsStateId, requestId, toolCalls };
}

function normalizeToolCalls(message: Record<string, unknown>): AiProviderToolCall[] {
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls.map((value, index) => normalizeToolCall(value, `tool-${index + 1}`));
  }
  if (message.function_call && typeof message.function_call === "object") {
    return [normalizeFunctionCall(message.function_call as Record<string, unknown>, "function-1")];
  }
  return [];
}

function normalizeToolCall(value: unknown, fallbackId: string) {
  if (!value || typeof value !== "object") {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned an invalid tool call", 502, true);
  }
  const record = value as Record<string, unknown>;
  const functionCall = record.function;
  if (!functionCall || typeof functionCall !== "object") {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned an invalid tool function", 502, true);
  }
  return normalizeFunctionCall(functionCall as Record<string, unknown>, typeof record.id === "string" ? record.id : fallbackId);
}

function normalizeFunctionCall(value: Record<string, unknown>, id: string): AiProviderToolCall {
  const name = typeof value.name === "string" ? value.name : "";
  if (!name || name.length > 128 || !isDatabaseSafeText(name)) {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned an invalid tool call name", 502, true);
  }
  if (id.length > 256 || !isDatabaseSafeText(id)) {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned an invalid tool call id", 502, true);
  }
  return {
    arguments: parseToolArguments(value.arguments),
    id,
    name
  };
}

function parseToolArguments(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned invalid tool arguments", 502, true);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new AiDomainError("provider_invalid_tool_call", "GigaChat returned malformed tool arguments", 502, true);
  }
}

function toGigaChatMessage(message: AiProviderMessage) {
  if (message.role === "tool") {
    return {
      content: message.content,
      name: message.name,
      role: "function"
    };
  }
  if (message.role === "assistant" && message.functionCall) {
    return {
      content: message.content,
      function_call: {
        arguments: message.functionCall.arguments,
        name: message.functionCall.name
      },
      functions_state_id: message.functionsStateId || undefined,
      role: "assistant"
    };
  }
  return {
    content: message.content,
    role: message.role
  };
}

function isCertificateError(error: unknown) {
  if (!(error instanceof Error) || !error.cause || typeof error.cause !== "object") return false;
  const code = "code" in error.cause ? error.cause.code : null;
  return code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "CERT_UNTRUSTED";
}

function resolveTokenExpiry(body: Record<string, unknown>, now: number) {
  if (typeof body.expires_at === "number") {
    return body.expires_at > 10_000_000_000 ? body.expires_at : body.expires_at * 1_000;
  }
  if (typeof body.expires_in === "number") {
    return now + Math.max(60, body.expires_in) * 1_000;
  }
  return now + 25 * 60 * 1_000;
}

function validateProviderUrl(value: string, field: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiDomainError("provider_not_configured", `${field} must be a valid URL`, 503);
  }
  if (url.protocol !== "https:") {
    throw new AiDomainError("provider_not_configured", `${field} must use HTTPS`, 503);
  }
}

async function readJsonResponse(response: Response, maximumChars: number) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumChars * 4) {
    throw new AiDomainError("provider_response_too_large", "GigaChat response exceeded the size limit", 502, true);
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumChars * 4) {
        await reader.cancel().catch(() => undefined);
        throw new AiDomainError("provider_response_too_large", "GigaChat response exceeded the size limit", 502, true);
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > maximumChars) {
        await reader.cancel().catch(() => undefined);
        throw new AiDomainError("provider_response_too_large", "GigaChat response exceeded the size limit", 502, true);
      }
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (text.length > maximumChars) {
    throw new AiDomainError("provider_response_too_large", "GigaChat response exceeded the size limit", 502, true);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
