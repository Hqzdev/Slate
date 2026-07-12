import {
  type MessengerAttachmentReservation,
  type MessengerConversationPage,
  type MessengerDirectConversationResult,
  type MessengerHistoryPage,
  type MessengerReaction,
  type MessengerReactionEmoji,
  type MessengerRealtimeAuthorization,
  type MessengerReceipt,
  type MessengerSendResult,
  type MessengerSequence,
  type MessengerUnread,
  type MessengerUploadAttachment,
  MessengerContractError,
  parseMessengerAttachmentReservation,
  parseMessengerAttachmentResult,
  parseMessengerConversationPage,
  parseMessengerAiInvocation,
  parseMessengerAiInvocationResult,
  parseMessengerDirectConversationResult,
  parseMessengerHistoryPage,
  parseMessengerReactionRemovalResult,
  parseMessengerReactionResult,
  parseMessengerRealtimeAuthorization,
  parseMessengerReceiptResult,
  parseMessengerSendResult,
  parseMessengerSequence,
  parseMessengerUnread
} from "./messengerTypes";

export type MessengerRequestOptions = {
  signal?: AbortSignal;
};

export type MessengerConversationListOptions = MessengerRequestOptions & {
  cursor?: string | null;
  limit?: number;
};

export type MessengerHistoryOptions = MessengerRequestOptions & {
  afterSequence?: MessengerSequence | null;
  beforeSequence?: MessengerSequence | null;
  limit?: number;
};

export type MessengerSendInput = {
  attachmentIds?: string[];
  aiAttachmentIds?: string[];
  body: string | null;
  clientRequestId: string;
};

export type MessengerReceiptInput = {
  deliveredThroughSequence?: MessengerSequence;
  readThroughSequence?: MessengerSequence;
};

export type MessengerAttachmentReservationInput = {
  byteSize: number;
  declaredContentType: string;
  fileName: string;
};

export type MessengerClientErrorDetails = {
  code: string;
  message: string;
  requestId: string | null;
  retryAfterMs: number | null;
  retryable: boolean;
  status: number;
};

export type MessengerFetchOptions = {
  body?: string;
  cache?: "no-store";
  credentials?: "same-origin";
  headers?: Record<string, string>;
  method?: "DELETE" | "GET" | "POST" | "PUT";
  signal?: AbortSignal;
};

type MessengerFetch = (input: string, init?: MessengerFetchOptions) => Promise<Response>;
type ResponseParser<T> = (value: unknown) => T;

export class MessengerClientError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;
  readonly status: number;

  constructor(details: MessengerClientErrorDetails) {
    super(details.message);
    this.name = "MessengerClientError";
    this.code = details.code;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
    this.retryable = details.retryable;
    this.status = details.status;
  }
}

export class MessengerClient {
  private readonly basePath: string;
  private readonly sendRequest: MessengerFetch;

  constructor(options: { basePath?: string; fetch?: MessengerFetch } = {}) {
    this.basePath = normalizeBasePath(options.basePath ?? "");
    this.sendRequest = options.fetch ?? ((input, init) => globalThis.fetch(input, init as RequestInit));
  }

  listUnread(workspaceId: string, options: MessengerRequestOptions = {}): Promise<MessengerUnread> {
    return this.request(this.workspacePath(workspaceId, "/unread"), parseMessengerUnread, {
      method: "GET",
      signal: options.signal
    });
  }

  authorizeRealtime(workspaceId: string, options: MessengerRequestOptions = {}): Promise<MessengerRealtimeAuthorization> {
    return this.request(this.workspacePath(workspaceId, "/realtime/authorize"), parseMessengerRealtimeAuthorization, {
      body: "{}",
      method: "POST",
      signal: options.signal
    });
  }

  setTyping(workspaceId: string, conversationId: string, active: boolean, options: MessengerRequestOptions = {}): Promise<void> {
    return this.request(this.conversationPath(workspaceId, conversationId, "/typing"), parseEmptyResponse, {
      body: JSON.stringify({ active }),
      method: "POST",
      signal: options.signal
    });
  }

  listConversations(
    workspaceId: string,
    options: MessengerConversationListOptions = {}
  ): Promise<MessengerConversationPage> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", validateLimit(options.limit).toString());
    return this.request(withQuery(this.workspacePath(workspaceId, "/conversations"), query), parseMessengerConversationPage, {
      method: "GET",
      signal: options.signal
    });
  }

  openDirectConversation(
    workspaceId: string,
    recipientUserId: string,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerDirectConversationResult> {
    if (!recipientUserId) throw inputError("invalid_recipient", "recipientUserId is required");
    return this.request(this.workspacePath(workspaceId, "/direct-conversations"), parseMessengerDirectConversationResult, {
      body: JSON.stringify({ recipientUserId }),
      method: "POST",
      signal: options.signal
    });
  }

  listMessages(
    workspaceId: string,
    conversationId: string,
    options: MessengerHistoryOptions = {}
  ): Promise<MessengerHistoryPage> {
    if (options.beforeSequence !== undefined && options.beforeSequence !== null
      && options.afterSequence !== undefined && options.afterSequence !== null) {
      throw inputError("invalid_cursor", "Use either beforeSequence or afterSequence");
    }
    const query = new URLSearchParams();
    if (options.beforeSequence !== undefined && options.beforeSequence !== null) {
      query.set("beforeSequence", validateSequenceInput(options.beforeSequence, "beforeSequence", false));
    }
    if (options.afterSequence !== undefined && options.afterSequence !== null) {
      query.set("afterSequence", validateSequenceInput(options.afterSequence, "afterSequence", true));
    }
    if (options.limit !== undefined) query.set("limit", validateLimit(options.limit).toString());
    const path = this.conversationPath(workspaceId, conversationId, "/messages");
    return this.request(withQuery(path, query), parseMessengerHistoryPage, {
      method: "GET",
      signal: options.signal
    });
  }

  sendMessage(
    workspaceId: string,
    conversationId: string,
    input: MessengerSendInput,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerSendResult> {
    return this.request(this.conversationPath(workspaceId, conversationId, "/messages"), parseMessengerSendResult, {
      body: JSON.stringify(input),
      method: "POST",
      signal: options.signal
    });
  }

  getAiInvocation(workspaceId: string, invocationId: string, options: MessengerRequestOptions = {}) {
    return this.request(this.workspacePath(workspaceId, `/ai-invocations/${encodeIdentifier(invocationId, "invocationId")}`), parseMessengerAiInvocation, {
      method: "GET",
      signal: options.signal
    });
  }

  openAiHandoff(workspaceId: string, invocationId: string, options: MessengerRequestOptions = {}): Promise<{ conversationId: string }> {
    return this.request(this.workspacePath(workspaceId, `/ai-invocations/${encodeIdentifier(invocationId, "invocationId")}/handoff`), parseAiHandoff, {
      body: "{}",
      method: "POST",
      signal: options.signal
    });
  }

  retryAiInvocation(workspaceId: string, conversationId: string, messageId: string, confirmProviderRedispatch: boolean, options: MessengerRequestOptions = {}) {
    return this.request(this.conversationPath(workspaceId, conversationId, `/messages/${encodeIdentifier(messageId, "messageId")}/ai-invocations`), parseMessengerAiInvocationResult, {
      body: JSON.stringify({ confirmProviderRedispatch }),
      method: "POST",
      signal: options.signal
    });
  }

  reserveAttachment(
    workspaceId: string,
    conversationId: string,
    input: MessengerAttachmentReservationInput,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerAttachmentReservation> {
    return this.request(this.conversationPath(workspaceId, conversationId, "/attachments"), parseMessengerAttachmentReservation, {
      body: JSON.stringify(input),
      method: "POST",
      signal: options.signal
    });
  }

  completeAttachment(
    workspaceId: string,
    conversationId: string,
    attachmentId: string,
    etag: string,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerUploadAttachment> {
    return this.request(this.attachmentPath(workspaceId, conversationId, attachmentId, "/complete"), parseMessengerAttachmentResult, {
      body: JSON.stringify({ checksum: null, etag }),
      method: "POST",
      signal: options.signal
    });
  }

  getAttachment(
    workspaceId: string,
    conversationId: string,
    attachmentId: string,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerUploadAttachment> {
    return this.request(this.attachmentPath(workspaceId, conversationId, attachmentId, ""), parseMessengerAttachmentResult, {
      method: "GET",
      signal: options.signal
    });
  }

  abandonAttachment(
    workspaceId: string,
    conversationId: string,
    attachmentId: string,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerUploadAttachment> {
    return this.request(this.attachmentPath(workspaceId, conversationId, attachmentId, ""), parseMessengerAttachmentResult, {
      method: "DELETE",
      signal: options.signal
    });
  }

  attachmentContentUrl(
    workspaceId: string,
    conversationId: string,
    attachmentId: string,
    variant: "original" | "poster" | "thumbnail" = "original"
  ) {
    const path = this.attachmentPath(workspaceId, conversationId, attachmentId, "/content");
    return `${this.basePath}${path}?variant=${variant}`;
  }

  updateReceipt(
    workspaceId: string,
    conversationId: string,
    input: MessengerReceiptInput,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerReceipt> {
    if (input.deliveredThroughSequence === undefined && input.readThroughSequence === undefined) {
      throw inputError("invalid_cursor", "At least one receipt cursor is required");
    }
    const body: MessengerReceiptInput = {};
    if (input.deliveredThroughSequence !== undefined) {
      body.deliveredThroughSequence = validateSequenceInput(input.deliveredThroughSequence, "deliveredThroughSequence", true);
    }
    if (input.readThroughSequence !== undefined) {
      body.readThroughSequence = validateSequenceInput(input.readThroughSequence, "readThroughSequence", true);
    }
    return this.request(this.conversationPath(workspaceId, conversationId, "/receipt"), parseMessengerReceiptResult, {
      body: JSON.stringify(body),
      method: "PUT",
      signal: options.signal
    });
  }

  addReaction(
    workspaceId: string,
    conversationId: string,
    messageId: string,
    emoji: MessengerReactionEmoji,
    options: MessengerRequestOptions = {}
  ): Promise<MessengerReaction> {
    const path = this.messagePath(workspaceId, conversationId, messageId, "/reactions");
    return this.request(path, parseMessengerReactionResult, {
      body: JSON.stringify({ emoji }),
      method: "POST",
      signal: options.signal
    });
  }

  async removeReaction(
    workspaceId: string,
    conversationId: string,
    messageId: string,
    reactionId: string,
    options: MessengerRequestOptions = {}
  ): Promise<string> {
    const path = this.messagePath(
      workspaceId,
      conversationId,
      messageId,
      `/reactions/${encodeIdentifier(reactionId, "reactionId")}`
    );
    const result = await this.request(path, parseMessengerReactionRemovalResult, {
      method: "DELETE",
      signal: options.signal
    });
    return result.id;
  }

  private async request<T>(path: string, parser: ResponseParser<T>, init: MessengerFetchOptions): Promise<T> {
    let response: Response;
    try {
      response = await this.sendRequest(`${this.basePath}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: init.body === undefined ? undefined : { "content-type": "application/json" }
      });
    } catch (error) {
      if (isAbortError(error, init.signal)) throw error;
      throw new MessengerClientError({
        code: "network_error",
        message: "Messenger could not reach the server",
        requestId: null,
        retryAfterMs: null,
        retryable: true,
        status: 0
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortError(error, init.signal)) throw error;
      if (!response.ok) throw parseErrorResponse(undefined, response);
      throw invalidResponse(response);
    }
    if (!response.ok) throw parseErrorResponse(payload, response);
    try {
      return parser(payload);
    } catch (error) {
      if (error instanceof MessengerContractError) throw invalidResponse(response);
      throw error;
    }
  }

  private workspacePath(workspaceId: string, suffix: string) {
    return `/api/workspaces/${encodeIdentifier(workspaceId, "workspaceId")}/messenger${suffix}`;
  }

  private conversationPath(workspaceId: string, conversationId: string, suffix: string) {
    return `${this.workspacePath(workspaceId, "/conversations")}/${encodeIdentifier(conversationId, "conversationId")}${suffix}`;
  }

  private messagePath(workspaceId: string, conversationId: string, messageId: string, suffix: string) {
    return `${this.conversationPath(workspaceId, conversationId, "/messages")}/${encodeIdentifier(messageId, "messageId")}${suffix}`;
  }

  private attachmentPath(workspaceId: string, conversationId: string, attachmentId: string, suffix: string) {
    return `${this.conversationPath(workspaceId, conversationId, "/attachments")}/${encodeIdentifier(attachmentId, "attachmentId")}${suffix}`;
  }
}

function parseAiHandoff(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record || typeof record.conversationId !== "string" || !record.conversationId) throw new MessengerContractError("handoff.conversationId");
  return { conversationId: record.conversationId };
}

function parseEmptyResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new MessengerContractError("emptyResponse");
}

function parseErrorResponse(value: unknown, response: Response) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const code = typeof record.code === "string" && /^[a-z0-9_]{1,128}$/.test(record.code)
    ? record.code
    : "messenger_request_failed";
  const message = typeof record.error === "string" && record.error.length > 0 && record.error.length <= 500
    ? record.error
    : "Messenger request failed";
  const requestId = typeof record.requestId === "string" && record.requestId.length > 0
    ? record.requestId
    : response.headers.get("x-request-id");
  const retryAfterMs = typeof record.retryAfterMs === "number"
    && Number.isSafeInteger(record.retryAfterMs)
    && record.retryAfterMs >= 0
    ? record.retryAfterMs
    : null;
  const retryable = typeof record.retryable === "boolean"
    ? record.retryable
    : response.status === 429 || response.status >= 500;
  return new MessengerClientError({ code, message, requestId, retryAfterMs, retryable, status: response.status });
}

function invalidResponse(response: Response) {
  return new MessengerClientError({
    code: "invalid_response",
    message: "Messenger returned an invalid response",
    requestId: response.headers.get("x-request-id"),
    retryAfterMs: null,
    retryable: true,
    status: response.status
  });
}

function inputError(code: string, message: string) {
  return new MessengerClientError({
    code,
    message,
    requestId: null,
    retryAfterMs: null,
    retryable: false,
    status: 0
  });
}

function validateSequenceInput(value: string, field: string, allowZero: boolean) {
  try {
    return parseMessengerSequence(value, field, allowZero);
  } catch {
    throw inputError("invalid_cursor", `${field} is invalid`);
  }
}

function validateLimit(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw inputError("invalid_cursor", "limit is invalid");
  return value;
}

function encodeIdentifier(value: string, field: string) {
  if (!value) throw inputError("invalid_request", `${field} is invalid`);
  return encodeURIComponent(value);
}

function normalizeBasePath(value: string) {
  if (!value || value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function withQuery(path: string, query: URLSearchParams) {
  const value = query.toString();
  return value ? `${path}?${value}` : path;
}

function isAbortError(error: unknown, signal: AbortSignal | null | undefined) {
  if (signal?.aborted) return true;
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export const messengerClient = new MessengerClient();
