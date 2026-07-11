import { AiDomainError } from "./errors";
import { isDatabaseSafeText } from "../../databaseSafeText";
import { aiChatModes, type AiChatMode } from "./types";

const maxMessageLength = 4_000;
const maxIdentifierLength = 160;
const maxActionBatchSize = 6;

export type AiMessageInput = {
  activeDocumentId: string | null;
  clientRequestId: string;
  conversationId?: string | null;
  content: string;
  mode?: AiChatMode;
};

export function parseAiMessageInput(value: unknown): AiMessageInput {
  const body = requireRecord(value, "Request body must be an object");
  const content = requireBoundedText(body.content, "content", maxMessageLength);
  const clientRequestId = requireBoundedText(body.clientRequestId, "clientRequestId", maxIdentifierLength);
  const activeDocumentId = optionalIdentifier(body.activeDocumentId, "activeDocumentId");
  const conversationId = optionalIdentifier(body.conversationId, "conversationId");
  const mode = parseAiChatMode(body.mode);
  return { activeDocumentId, clientRequestId, content, conversationId, mode };
}

export function parseAiChatMode(value: unknown): AiChatMode {
  if (value === undefined) return "ask";
  if (typeof value !== "string" || !aiChatModes.includes(value as AiChatMode)) {
    throw new AiDomainError("invalid_mode", "mode must be ask, plan, or agent", 400);
  }
  return value as AiChatMode;
}

export function parseActionIds(value: unknown) {
  const body = requireRecord(value, "Request body must be an object");
  if (!Array.isArray(body.actionIds) || body.actionIds.length === 0 || body.actionIds.length > maxActionBatchSize) {
    throw new AiDomainError("invalid_action_ids", `actionIds must contain between 1 and ${maxActionBatchSize} ids`, 400);
  }
  const actionIds = body.actionIds.map((value) => requireBoundedText(value, "actionId", maxIdentifierLength));
  if (new Set(actionIds).size !== actionIds.length) {
    throw new AiDomainError("duplicate_action_ids", "actionIds must be unique", 400);
  }
  return actionIds;
}

export function parseConversationCursor(value: string | null) {
  if (value === null || value === "") return null;
  if (value.length > maxIdentifierLength || !isDatabaseSafeText(value)) {
    throw new AiDomainError("invalid_cursor", "Conversation cursor is invalid", 400);
  }
  return value;
}

export function parsePathIdentifier(value: string, field: string) {
  if (!value || value.length > maxIdentifierLength || !isDatabaseSafeText(value)) {
    throw new AiDomainError(`invalid_${field}`, `${field} is invalid`, 400);
  }
  return value;
}

function optionalIdentifier(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  return requireBoundedText(value, field, maxIdentifierLength);
}

function requireBoundedText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new AiDomainError(`invalid_${field}`, `${field} must be a string`, 400);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength || !isDatabaseSafeText(text)) {
    throw new AiDomainError(`invalid_${field}`, `${field} must contain between 1 and ${maxLength} characters`, 400);
  }
  return text;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDomainError("invalid_request", message, 400);
  }
  return value as Record<string, unknown>;
}
