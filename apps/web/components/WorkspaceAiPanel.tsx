"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy01Icon, Refresh01Icon, ThumbsDownIcon, ThumbsUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createWorkspaceNavigationUrl } from "@/lib/client/workspaceNavigation";

export type WorkspaceAiDocument = {
  canvasState: unknown;
  content: string;
  id: string;
  language: string | null;
  position: number;
  title: string;
  type: "canvas" | "code" | "note";
  updatedAt: string;
};

export type WorkspaceAiFileNode = {
  documentId: string | null;
  id: string;
  kind: "document" | "folder";
  name: string;
  parentId: string | null;
  position: number;
};

export type WorkspaceAiApplyResult = {
  documents: WorkspaceAiDocument[];
  fileNodes: WorkspaceAiFileNode[];
  openDocumentId: string | null;
};

type WorkspaceAiPanelProps = {
  activeDocument: {
    id: string;
    title: string;
    updatedAt: string;
  } | null;
  canApply: boolean;
  onBeforeApply: (documentId: string) => Promise<void> | void;
  onBeforeSend?: (activeDocumentId: string | null) => Promise<void> | void;
  onWorkspaceChange: (result: WorkspaceAiApplyResult) => Promise<void> | void;
  workspaceId: string;
  workspaceName: string;
};

type AiMessageRole = "assistant" | "system" | "tool" | "user";
type AiMessageStatus = "failed" | "pending" | "sent";
type AiContextScope = "document" | "workspace";
type AiMessageFeedback = "disliked" | "liked";
type AiMode = "agent" | "ask" | "plan";
type ComposerCommand = {
  end: number;
  query: string;
  start: number;
  trigger: "@" | "/";
};
type ComposerCommandOption = {
  description: string;
  disabled: boolean;
  label: string;
  value: AiContextScope | AiMode;
};

const modeLabels: Record<AiMode, string> = {
  agent: "Agent",
  ask: "Ask",
  plan: "Plan"
};

function replaceAiConversationUrl(conversationId: string, workspaceId: string) {
  const nextUrl = createWorkspaceNavigationUrl(window.location.href, { aiConversationId: conversationId, view: "ai", workspaceId });
  window.history.replaceState(null, "", nextUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type AiMessage = {
  activeDocumentId: string | null;
  clientRequestId: string | null;
  content: string;
  createdAt: string;
  error: string | null;
  id: string;
  inReplyToMessageId: string | null;
  processingStartedAt: string | null;
  retryable: boolean | null;
  role: AiMessageRole;
  status: AiMessageStatus;
};

type AiDraftAction = {
  description: string;
  details: string[];
  documentId: string | null;
  documentType: "code" | "note" | null;
  error: string | null;
  expiresAt: string | null;
  id: string;
  preview: string | null;
  previewTruncated: boolean;
  status: string;
  target: string | null;
  title: string;
  type: string;
};

type AiConversationSummary = {
  id: string;
  messageCount: number;
  title: string;
  updatedAt: string;
};

type AssistantMessageContentProps = {
  content: string;
  messageId: string;
  onComplete: (messageId: string) => void;
  onProgress: () => void;
  shouldType: boolean;
};

function AssistantMessageContent({ content, messageId, onComplete, onProgress, shouldType }: AssistantMessageContentProps) {
  const [visibleText, setVisibleText] = useState(shouldType ? "" : content);
  const [isComplete, setIsComplete] = useState(!shouldType);

  useEffect(() => {
    if (!shouldType) return;
    let visibleLength = 0;
    const timer = window.setInterval(() => {
      visibleLength = Math.min(visibleLength + 3, content.length);
      setVisibleText(content.slice(0, visibleLength));
      onProgress();
      if (visibleLength === content.length) {
        window.clearInterval(timer);
        setIsComplete(true);
        onComplete(messageId);
      }
    }, 12);
    return () => window.clearInterval(timer);
  }, [content, messageId, onComplete, onProgress, shouldType]);

  if (!isComplete) return <p className="ai-message-typing">{visibleText}</p>;
  return (
    <div className="ai-message-markdown">
      <ReactMarkdown
        components={{
          a: ({ children, href }) => <a href={href} rel="noreferrer" target="_blank">{children}</a>,
          img: () => null
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

type AiAgentStep = {
  action: "create" | "create_diagram" | "inspect_run" | "read" | "run" | "update";
  documentId: string | null;
  errorCode: string | null;
  id: string;
  label: string;
  output: unknown;
  runId: string | null;
  sequence: number;
  status: "completed" | "failed" | "running";
};

type AiAgentTask = {
  errorCode: string | null;
  id: string;
  plan: string;
  prompt: string;
  status: "awaiting_confirmation" | "blocked" | "completed" | "failed" | "running" | "stopped";
  steps: AiAgentStep[];
  summary: string | null;
};

type JsonRecord = Record<string, unknown>;

const actionableStatuses = new Set(["draft", "pending", "proposed", "ready"]);
const maximumActionPreviewLength = 1_200;
const maximumDiffLineCount = 80;
const maximumMessageLength = 4_000;
const processingLeaseDurationMs = 90_000;

function isActionableAction(action: Pick<AiDraftAction, "status" | "type">) {
  return actionableStatuses.has(action.status) || (action.type === "update_document" && action.status === "applying");
}

class AiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly retryable: boolean) {
    super(message);
    this.name = "AiRequestError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readString(record: JsonRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNullableString(record: JsonRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (value === null) return null;
    if (typeof value === "string") return value;
  }
  return null;
}

function readNumber(record: JsonRecord | null, keys: string[], fallback = 0) {
  if (!record) return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function readNullableNumber(record: JsonRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readNullableBoolean(record: JsonRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readMessageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (typeof part === "string") return [part];
    const record = asRecord(part);
    const text = readString(record, ["text", "content", "value"]);
    return text ? [text] : [];
  }).join("\n");
}

function normalizeRole(value: unknown): AiMessageRole {
  if (value === "user" || value === "human") return "user";
  if (value === "tool" || value === "function") return "tool";
  if (value === "system") return "system";
  return "assistant";
}

function normalizeMessage(value: unknown, index: number): AiMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  const role = normalizeRole(record.role ?? record.type);
  const content = readMessageContent(record.content ?? record.text ?? record.body ?? record.message ?? record.output);
  if (!content) return null;
  const createdAt = readString(record, ["createdAt", "created_at", "timestamp"]) ?? new Date().toISOString();
  const clientRequestId = readNullableString(record, ["clientRequestId", "client_request_id", "requestId"]);
  const id = readString(record, ["id", "messageId", "message_id"]) ?? clientRequestId ?? `${role}-${index}-${createdAt}`;
  const rawStatus = readString(record, ["status"]);
  const status: AiMessageStatus = rawStatus === "failed" || rawStatus === "pending" ? rawStatus : "sent";
  return {
    activeDocumentId: readNullableString(record, ["activeDocumentId", "active_document_id", "documentId"]),
    clientRequestId,
    content,
    createdAt,
    error: readNullableString(record, ["error", "errorMessage", "errorCode"]),
    id,
    inReplyToMessageId: readNullableString(record, ["inReplyToMessageId", "in_reply_to_message_id"]),
    processingStartedAt: readNullableString(record, ["processingStartedAt", "processing_started_at"]),
    retryable: readNullableBoolean(record, ["retryable"]),
    role,
    status
  };
}

function responseRoots(value: unknown) {
  const root = asRecord(value);
  if (!root) return [];
  const data = asRecord(root.data);
  const result = asRecord(root.result);
  const conversation = asRecord(root.conversation);
  const dataConversation = asRecord(data?.conversation);
  const request = asRecord(root.request) ?? asRecord(root.requestMessage);
  const response = asRecord(root.response) ?? asRecord(root.responseMessage);
  const action = asRecord(root.action);
  const changes = asRecord(root.changes) ?? asRecord(root.workspaceChange);
  return [root, data, result, conversation, dataConversation, request, response, action, changes].filter((record): record is JsonRecord => Boolean(record));
}

function normalizeMessages(value: unknown) {
  const candidates: unknown[] = [];
  for (const root of responseRoots(value)) {
    if (root.role && (root.content || root.text || root.body)) candidates.push(root);
    candidates.push(...asArray(root.messages));
    for (const key of ["message", "assistantMessage", "assistant_message", "userMessage", "user_message"]) {
      if (root[key]) candidates.push(root[key]);
    }
    const response = readString(root, ["response", "answer"]);
    if (response) candidates.push({ content: response, role: "assistant" });
  }

  const messages = candidates.map(normalizeMessage).filter((message): message is AiMessage => Boolean(message));
  return mergeMessages([], messages);
}

function compactValue(value: unknown) {
  if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 87)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  return null;
}

function normalizeActionPreview(value: string | null) {
  if (value === null) return { preview: null, truncated: false };
  const boundedCharacters = value.slice(0, maximumActionPreviewLength);
  const lines = boundedCharacters.split("\n");
  const preview = lines.slice(0, maximumDiffLineCount).join("\n");
  return {
    preview,
    truncated: value.length > boundedCharacters.length || lines.length > maximumDiffLineCount
  };
}

function diffLineType(line: string) {
  if (line.startsWith("@@")) return "header";
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

function actionTypeLabel(action: Pick<AiDraftAction, "documentType" | "type">) {
  if (action.type === "create_document") return "Code file";
  if (action.type === "create_note") return "Note";
  if (action.type === "create_table_note") return "Table note";
  if (action.type === "create_canvas_diagram") return "Canvas";
  if (action.type === "update_document" && action.documentType === "code") return "Code update";
  if (action.type === "update_document" && action.documentType === "note") return "Note update";
  if (action.type === "update_document") return "Document update";
  return "Workspace change";
}

function defaultActionTitle(type: string, documentType: AiDraftAction["documentType"], target: string | null) {
  if (type === "update_document" && target) return `Update ${target}`;
  if (type === "create_document") return "Create a code file";
  if (type === "create_note") return "Create a note";
  if (type === "create_table_note") return "Create a table note";
  if (type === "create_canvas_diagram") return "Create a canvas";
  return actionTypeLabel({ documentType, type });
}

function normalizeCanvasPreview(payload: JsonRecord | null) {
  if (readNullableBoolean(payload, ["invalid"]) === true) {
    return normalizeActionPreview(readNullableString(payload, ["preview"]));
  }
  const nodes = asArray(payload?.nodes).flatMap((value) => {
    const node = asRecord(value);
    const key = readString(node, ["key", "id"]);
    const label = readString(node, ["label", "name", "title", "key"]);
    return key && label ? [{ key, label }] : [];
  });
  const nodeLabelsByKey = new Map(nodes.map((node) => [node.key, node.label]));
  const connections = asArray(payload?.edges).flatMap((value) => {
    const edge = asRecord(value);
    const from = readString(edge, ["from", "source"]);
    const to = readString(edge, ["to", "target"]);
    if (!from || !to) return [];
    const label = readString(edge, ["label"]);
    const connection = `${nodeLabelsByKey.get(from) ?? from} → ${nodeLabelsByKey.get(to) ?? to}`;
    return [label ? `${connection} · ${label}` : connection];
  });
  if (connections.length > 0) return normalizeActionPreview(["Connections", ...connections].join("\n"));
  if (nodes.length > 0) return normalizeActionPreview(["Nodes", ...nodes.map((node) => `• ${node.label}`)].join("\n"));
  return normalizeActionPreview(readNullableString(payload, ["preview"]));
}

function normalizeActionDetails(type: string, payload: JsonRecord | null) {
  if (!payload) return [];
  if (type === "create_canvas_diagram") {
    const nodeCount = readNullableNumber(payload, ["nodeCount", "node_count"])
      ?? (Array.isArray(payload.nodes) ? payload.nodes.length : null);
    const connectionCount = readNullableNumber(payload, ["edgeCount", "edge_count"])
      ?? (Array.isArray(payload.edges) ? payload.edges.length : null);
    return [
      nodeCount === null ? null : `Nodes: ${nodeCount}`,
      connectionCount === null ? null : `Connections: ${connectionCount}`
    ].filter((detail): detail is string => detail !== null);
  }
  if (type === "create_table_note") {
    const columnCount = readNullableNumber(payload, ["columnCount", "column_count"]);
    const rowCount = readNullableNumber(payload, ["rowCount", "row_count"]);
    return [
      columnCount === null ? null : `Columns: ${columnCount}`,
      rowCount === null ? null : `Rows: ${rowCount}`
    ].filter((detail): detail is string => detail !== null);
  }
  const contentLength = readNullableNumber(payload, ["contentLength", "content_length"]);
  if (type === "create_document" || type === "create_note" || type === "update_document") {
    return contentLength === null ? [] : [`Characters: ${contentLength}`];
  }
  return Object.entries(payload).flatMap(([key, entry]) => {
    if (["content", "canvasState", "canvas_state", "documentId", "document_id", "expectedUpdatedAt", "expected_updated_at", "parentId", "parent_id", "preview", "title", "truncated"].includes(key)) return [];
    const compact = compactValue(entry);
    return compact ? [`${key.replace(/_/g, " ")}: ${compact}`] : [];
  }).slice(0, 3);
}

function normalizeAction(value: unknown): AiDraftAction | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, ["id", "actionId", "action_id"]);
  if (!id) return null;
  const payload = asRecord(record.payload) ?? asRecord(record.input) ?? asRecord(record.arguments);
  const type = readString(record, ["type", "kind", "tool", "toolName", "tool_name"]) ?? "workspace change";
  const documentId = readString(payload, ["documentId", "document_id"]);
  const rawDocumentType = readString(payload, ["documentType", "document_type"]);
  const documentType = rawDocumentType === "code" || rawDocumentType === "note" ? rawDocumentType : null;
  const target = readString(record, ["target", "path", "fileName", "filename", "documentTitle", "name"])
    ?? readString(payload, ["path", "fileName", "filename", "title", "name"]);
  const normalizedPreview = type === "create_canvas_diagram"
    ? normalizeCanvasPreview(payload)
    : normalizeActionPreview(readNullableString(payload, ["preview"]));
  const errorCode = readNullableString(record, ["errorCode", "error_code"]);
  const rawStatus = (readString(record, ["status"]) ?? "draft").toLowerCase();
  const status = errorCode === "document_version_conflict" ? "conflict" : rawStatus;
  const isUpdateConflict = type === "update_document" && status === "conflict";
  const details = normalizeActionDetails(type, payload);
  return {
    description: readString(record, ["description", "summary", "preview", "reason"])
      ?? (type === "update_document" ? "Review this diff before replacing the document content." : "Slate will apply this change after confirmation."),
    details,
    documentId,
    documentType,
    error: isUpdateConflict
      ? "This document changed after the draft was prepared. Regenerate the draft from the latest version."
      : readNullableString(record, ["error", "errorMessage", "errorCode"]),
    expiresAt: readNullableString(record, ["expiresAt", "expires_at"]),
    id,
    preview: normalizedPreview.preview,
    previewTruncated: normalizedPreview.truncated || readNullableBoolean(payload, ["truncated"]) === true,
    status,
    target,
    title: readString(record, ["title", "label", "displayName"])
      ?? defaultActionTitle(type, documentType, target),
    type
  };
}

function normalizeActions(value: unknown) {
  const candidates: unknown[] = [];
  for (const root of responseRoots(value)) {
    candidates.push(...asArray(root.actions), ...asArray(root.draftActions), ...asArray(root.draft_actions));
    const action = root.action ?? root.draftAction ?? root.draft_action;
    if (action) candidates.push(action);
    for (const message of asArray(root.messages)) {
      const messageRecord = asRecord(message);
      candidates.push(...asArray(messageRecord?.actions), ...asArray(messageRecord?.draftActions));
    }
  }
  return mergeActions([], candidates.map(normalizeAction).filter((action): action is AiDraftAction => Boolean(action)));
}

function normalizeNextCursor(value: unknown) {
  for (const root of responseRoots(value)) {
    const cursor = readString(root, ["nextCursor", "next_cursor"]);
    if (cursor) return cursor;
  }
  return null;
}

function normalizeConversationId(value: unknown) {
  for (const root of responseRoots(value)) {
    const conversation = asRecord(root.conversation);
    const id = readString(conversation, ["id"]);
    if (id) return id;
  }
  return null;
}

function normalizeAgentTask(value: unknown): AiAgentTask | null {
  const root = asRecord(value);
  const record = asRecord(root?.agentTask) ?? asRecord(root?.agent_task) ?? root;
  const id = readString(record, ["id"]);
  const plan = readString(record, ["plan"]);
  const prompt = readString(record, ["prompt"]);
  const status = readString(record, ["status"]);
  if (!id || !plan || !prompt || !status || !["awaiting_confirmation", "blocked", "completed", "failed", "running", "stopped"].includes(status)) return null;
  const steps = asArray(record?.steps).flatMap((value) => {
    const step = asRecord(value);
    const stepId = readString(step, ["id"]);
    const action = readString(step, ["action"]);
    const stepStatus = readString(step, ["status"]);
    const label = readString(step, ["label"]);
    if (!stepId || !label || !action || !stepStatus) return [];
    if (!["create", "create_diagram", "inspect_run", "read", "run", "update"].includes(action)) return [];
    if (!["completed", "failed", "running"].includes(stepStatus)) return [];
    return [{
      action: action as AiAgentStep["action"],
      documentId: readNullableString(step, ["documentId", "document_id"]),
      errorCode: readNullableString(step, ["errorCode", "error_code"]),
      id: stepId,
      label,
      output: step?.output ?? null,
      runId: readNullableString(step, ["runId", "run_id"]),
      sequence: readNumber(step, ["sequence"]),
      status: stepStatus as AiAgentStep["status"]
    }];
  });
  return {
    errorCode: readNullableString(record, ["errorCode", "error_code"]),
    id,
    plan,
    prompt,
    status: status as AiAgentTask["status"],
    steps,
    summary: readNullableString(record, ["summary"])
  };
}

function normalizeDocument(value: unknown): WorkspaceAiDocument | null {
  const record = asRecord(value);
  const id = readString(record, ["id"]);
  const title = readString(record, ["title", "name"]);
  const type = readString(record, ["type"]);
  if (!id || !title || (type !== "canvas" && type !== "code" && type !== "note")) return null;
  return {
    canvasState: record?.canvasState ?? record?.canvas_state ?? null,
    content: typeof record?.content === "string" ? record.content : "",
    id,
    language: readNullableString(record, ["language"]),
    position: readNumber(record, ["position"]),
    title,
    type,
    updatedAt: readString(record, ["updatedAt", "updated_at"]) ?? new Date().toISOString()
  };
}

function normalizeFileNode(value: unknown): WorkspaceAiFileNode | null {
  const record = asRecord(value);
  const id = readString(record, ["id"]);
  const name = readString(record, ["name", "title"]);
  const kind = readString(record, ["kind"]);
  if (!id || !name || (kind !== "document" && kind !== "folder")) return null;
  return {
    documentId: readNullableString(record, ["documentId", "document_id"]),
    id,
    kind,
    name,
    parentId: readNullableString(record, ["parentId", "parent_id"]),
    position: readNumber(record, ["position"])
  };
}

function normalizeApplyResult(value: unknown): WorkspaceAiApplyResult {
  const documents: WorkspaceAiDocument[] = [];
  const fileNodes: WorkspaceAiFileNode[] = [];
  let openDocumentId: string | null = null;
  for (const root of responseRoots(value)) {
    documents.push(...asArray(root.documents).map(normalizeDocument).filter((document): document is WorkspaceAiDocument => Boolean(document)));
    fileNodes.push(...asArray(root.fileNodes ?? root.file_nodes).map(normalizeFileNode).filter((fileNode): fileNode is WorkspaceAiFileNode => Boolean(fileNode)));
    const document = normalizeDocument(root.document);
    const fileNode = normalizeFileNode(root.fileNode ?? root.file_node);
    if (document) documents.push(document);
    if (fileNode) fileNodes.push(fileNode);
    openDocumentId ??= readString(root, ["openDocumentId", "open_document_id", "createdDocumentId", "created_document_id", "resultDocumentId", "result_document_id", "documentId"]);
  }
  return {
    documents: Array.from(new Map(documents.map((document) => [document.id, document])).values()),
    fileNodes: Array.from(new Map(fileNodes.map((fileNode) => [fileNode.id, fileNode])).values()),
    openDocumentId
  };
}

function mergeMessages(current: AiMessage[], incoming: AiMessage[]) {
  const merged = [...current];
  for (const message of incoming) {
    if (message.role === "assistant" && message.inReplyToMessageId) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const candidate = merged[index];
        if (candidate.role === "assistant" && candidate.inReplyToMessageId === message.inReplyToMessageId && candidate.id !== message.id) {
          merged.splice(index, 1);
        }
      }
      const requestIndex = merged.findIndex((candidate) => candidate.role === "user" && candidate.id === message.inReplyToMessageId);
      if (requestIndex >= 0) {
        merged[requestIndex] = { ...merged[requestIndex], error: null, processingStartedAt: null, retryable: null, status: "sent" };
      }
    }
    const existingIndex = merged.findIndex((candidate) => candidate.id === message.id || Boolean(message.clientRequestId && candidate.clientRequestId === message.clientRequestId));
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...message };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

function mergeActions(current: AiDraftAction[], incoming: AiDraftAction[]) {
  const merged = [...current];
  for (const action of incoming) {
    const existingIndex = merged.findIndex((candidate) => candidate.id === action.id);
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...action };
    } else {
      merged.push(action);
    }
  }
  return merged;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readResponse(response: Response) {
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) {
    const record = asRecord(body);
    const nestedError = asRecord(record?.error);
    const message = readString(record, ["error", "message"]) ?? readString(nestedError, ["message", "error"]) ?? `AI request failed (${response.status})`;
    const retryable = readNullableBoolean(record, ["retryable"])
      ?? readNullableBoolean(nestedError, ["retryable"])
      ?? (response.status === 408 || response.status === 429 || response.status >= 500);
    throw new AiRequestError(message, response.status, readString(record, ["code"]) ?? readString(nestedError, ["code"]), retryable);
  }
  return body;
}

function formatMessageTime(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agentStepDetail(step: AiAgentStep) {
  const record = asRecord(step.output);
  if (!record) return null;
  const target = readString(record, ["target", "title", "documentTitle"]);
  const runStatus = readString(record, ["status"]);
  const runId = readString(record, ["runId", "run_id"]);
  if (target) return target;
  if (runStatus && runId) return `${runStatus} · ${runId}`;
  if (runStatus) return runStatus;
  return null;
}

function agentRunOutput(step: AiAgentStep) {
  if (step.action !== "inspect_run") return null;
  const output = readNullableString(asRecord(step.output), ["output"]);
  return output ? output.slice(0, 8_000) : null;
}

function agentStatusLabel(status: AiAgentTask["status"]) {
  if (status === "awaiting_confirmation") return "Awaiting confirmation";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "blocked") return "Needs confirmation";
  if (status === "stopped") return "Stopped";
  return "Failed";
}

function friendlyAiError(value: string | null) {
  const detail = value?.trim() || "unknown_error";
  const normalized = detail.toLowerCase();
  if (normalized.includes("provider_rejected_request")) {
    return { detail, message: "The AI provider rejected the request. Try again or shorten the prompt." };
  }
  if (normalized.includes("provider_timeout")) {
    return { detail, message: "The AI provider took too long to respond. Try the request again." };
  }
  if (normalized.includes("provider_unavailable")) {
    return { detail, message: "The AI provider is temporarily unavailable. Try again in a moment." };
  }
  if (normalized.includes("generation_stopped")) {
    return { detail, message: "Generation was stopped. You can retry when you are ready." };
  }
  if (normalized.includes("ai_request_in_progress")) {
    return { detail, message: "This request is still being processed. Wait a moment, then retry." };
  }
  if (/^[a-z0-9_:-]+$/i.test(detail)) {
    return { detail, message: "The assistant could not complete the request. Try again or revise the prompt." };
  }
  return { detail, message: detail };
}

function statusLabel(status: string) {
  if (status === "applied") return "Applied";
  if (status === "discarded") return "Discarded";
  if (status === "applying") return "Applying";
  if (status === "conflict") return "Conflict";
  if (status === "failed") return "Failed";
  return "Draft ready";
}

function canRetryPendingMessage(message: AiMessage, activeRequestIds: Set<string>, now: number) {
  if (message.status !== "pending" || !message.clientRequestId || activeRequestIds.has(message.clientRequestId)) return false;
  if (!message.processingStartedAt) return true;
  const processingStartedAt = Date.parse(message.processingStartedAt);
  return Number.isNaN(processingStartedAt) || now - processingStartedAt >= processingLeaseDurationMs;
}

export function WorkspaceAiPanel({ activeDocument, canApply, onBeforeApply, onBeforeSend, onWorkspaceChange, workspaceId, workspaceName }: WorkspaceAiPanelProps) {
  const [actions, setActions] = useState<AiDraftAction[]>([]);
  const [agentAdvancing, setAgentAdvancing] = useState(false);
  const [agentTask, setAgentTask] = useState<AiAgentTask | null>(null);
  const [contextScope, setContextScope] = useState<AiContextScope>("workspace");
  const [composerCommandIndex, setComposerCommandIndex] = useState(0);
  const [composerCursor, setComposerCursor] = useState(0);
  const [composerMenuDismissed, setComposerMenuDismissed] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() => window.location.pathname.match(/\/workspace\/ai\/(sltx-[a-f0-9]{4}-[a-f0-9]{4})$/)?.[1] ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedActionIds, setExpandedActionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [mode, setMode] = useState<AiMode>("ask");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [clearingConversation, setClearingConversation] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatSwitcherOpen, setChatSwitcherOpen] = useState(false);
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, AiMessageFeedback>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [activeRequestIds, setActiveRequestIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeSendControllerRef = useRef<AbortController | null>(null);
  const agentAdvancingRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const historyRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const stickToBottomRef = useRef(true);
  const typedMessageIdsRef = useRef<Set<string>>(new Set());
  const handleTypingComplete = useCallback((messageId: string) => {
    setTypingMessageId((current) => current === messageId ? null : current);
  }, []);
  const scrollHistoryToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const history = historyRef.current;
      if (history && stickToBottomRef.current) history.scrollTop = history.scrollHeight;
      scrollFrameRef.current = null;
    });
  }, []);
  const actionableActions = useMemo(() => actions.filter((action) => {
    if (!isActionableAction(action)) return false;
    if (action.type === "update_document" && !action.documentId) return false;
    if (action.type === "update_document" && action.status === "applying") return true;
    if (!action.expiresAt) return true;
    const expiresAt = Date.parse(action.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt > currentTime;
  }), [actions, currentTime]);
  const currentAction = useMemo(() => [...actionableActions].reverse()[0] ?? [...actions].reverse()[0] ?? null, [actionableActions, actions]);
  const previousActions = useMemo(() => currentAction ? actions.filter((action) => action.id !== currentAction.id) : [], [actions, currentAction]);
  const hasServerPendingMessage = useMemo(() => messages.some((message) => (
    message.role === "user"
    && message.status === "pending"
    && message.clientRequestId !== null
    && !activeRequestIds.has(message.clientRequestId)
    && !canRetryPendingMessage(message, activeRequestIds, currentTime)
  )), [activeRequestIds, currentTime, messages]);
  const conversationMessages = useMemo(() => messages.filter((message) => message.role === "assistant" || message.role === "user"), [messages]);
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const effectiveContextScope: AiContextScope = contextScope === "document" && activeDocument ? "document" : "workspace";
  const contextDocument = effectiveContextScope === "document" ? activeDocument : null;
  const contextLabel = contextDocument ? `Document context · ${contextDocument.title}` : `Workspace context · ${workspaceName}`;
  const agentBusy = Boolean(agentTask && ["awaiting_confirmation", "blocked", "running"].includes(agentTask.status));
  const visibleConversations = useMemo(() => conversations.filter((conversation) => conversation.title.toLowerCase().includes(chatSearch.trim().toLowerCase())), [chatSearch, conversations]);
  const composerCommand = useMemo<ComposerCommand | null>(() => {
    const prefix = draft.slice(0, composerCursor);
    const match = prefix.match(/(^|\s)([@/])([^\s@/]*)$/);
    if (!match) return null;
    const query = match[3];
    const trigger = match[2] as ComposerCommand["trigger"];
    return { end: composerCursor, query, start: composerCursor - query.length - 1, trigger };
  }, [composerCursor, draft]);
  const composerCommandOptions = useMemo<ComposerCommandOption[]>(() => {
    if (!composerCommand) return [];
    const candidates: ComposerCommandOption[] = composerCommand.trigger === "@"
      ? [
          { description: `Use all of ${workspaceName} as context`, disabled: false, label: "Workspace", value: "workspace" },
          { description: activeDocument ? `Use ${activeDocument.title} as context` : "Open a document to use it as context", disabled: !activeDocument, label: "Current document", value: "document" }
        ]
      : [
          { description: "Ask a question about the selected context", disabled: false, label: "Ask", value: "ask" },
          { description: "Create a plan before making changes", disabled: false, label: "Plan", value: "plan" },
          { description: canApply ? "Make changes through reviewable drafts" : "Editor access is required", disabled: !canApply, label: "Agent", value: "agent" }
        ];
    const query = composerCommand.query.toLowerCase();
    return candidates.filter((candidate) => `${candidate.label} ${candidate.description}`.toLowerCase().includes(query));
  }, [activeDocument, canApply, composerCommand, workspaceName]);
  const composerMenuOpen = Boolean(composerCommand && !composerMenuDismissed);

  useEffect(() => {
    function closeComposerMenu(event: MouseEvent) {
      if (!composerShellRef.current?.contains(event.target as Node)) setComposerMenuDismissed(true);
    }

    document.addEventListener("mousedown", closeComposerMenu);
    return () => document.removeEventListener("mousedown", closeComposerMenu);
  }, []);

  const loadConversations = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/ai/conversations`, { cache: "no-store", signal });
    const body = await readResponse(response);
    const result = asRecord(body);
    const items = Array.isArray(result?.conversations) ? result.conversations : [];
    const normalized = items.flatMap((item) => {
      const record = asRecord(item);
      const id = readString(record, ["id"]);
      const title = readString(record, ["title"]);
      const updatedAt = readString(record, ["updatedAt"]);
      const messageCount = typeof record?.messageCount === "number" ? record.messageCount : 0;
      return id && title && updatedAt ? [{ id, messageCount, title, updatedAt }] : [];
    });
    setConversations(normalized);
    return normalized;
  }, [workspaceId]);

  async function switchConversation(nextConversationId: string) {
    if (nextConversationId === conversationId || loading || sending || agentBusy) return;
    setLoading(true);
    setChatSwitcherOpen(false);
    setMessages([]);
    setActions([]);
    const controller = createController();
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/conversation?conversationId=${encodeURIComponent(nextConversationId)}`, { cache: "no-store", signal: controller.signal });
      const body = await readResponse(response);
      if (controller.signal.aborted) return;
      setConversationId(nextConversationId);
      setMessages(normalizeMessages(body));
      setActions(normalizeActions(body));
      setNextCursor(normalizeNextCursor(body));
      replaceAiConversationUrl(nextConversationId, workspaceId);
    } catch (loadError) {
      if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Conversation could not be loaded");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);

    const conversationQuery = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    void fetch(`/api/workspaces/${workspaceId}/ai/conversation${conversationQuery}`, { cache: "no-store", signal: controller.signal })
      .then(readResponse)
      .then((body) => {
        if (controller.signal.aborted) return;
        const incomingMessages = normalizeMessages(body);
        const incomingActions = normalizeActions(body);
        setMessages((current) => mergeMessages(incomingMessages, current));
        setActions((current) => mergeActions(incomingActions, current));
        setConversationId(normalizeConversationId(body));
        setNextCursor(normalizeNextCursor(body));
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "AI conversation failed to load");
      })
      .finally(() => {
        controllersRef.current.delete(controller);
        if (!controller.signal.aborted) setLoading(false);
      });

    void loadConversations(controller.signal).catch(() => undefined);

    const agentConversationQuery = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    void fetch(`/api/workspaces/${workspaceId}/ai/agent-tasks${agentConversationQuery}`, { cache: "no-store", signal: controller.signal })
      .then(readResponse)
      .then((body) => {
        if (!controller.signal.aborted) setAgentTask(normalizeAgentTask(body));
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [conversationId, loadConversations, workspaceId]);

  useEffect(() => {
    const controllers = controllersRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const retryDeadlines = messages.flatMap((message) => {
      if (message.status !== "pending" || !message.clientRequestId || activeRequestIds.has(message.clientRequestId) || !message.processingStartedAt) return [];
      const processingStartedAt = Date.parse(message.processingStartedAt);
      return Number.isNaN(processingStartedAt) ? [] : [processingStartedAt + processingLeaseDurationMs];
    });
    const actionExpiryDeadlines = actions.flatMap((action) => {
      if (!action.expiresAt || !actionableStatuses.has(action.status)) return [];
      const expiresAt = Date.parse(action.expiresAt);
      return Number.isNaN(expiresAt) ? [] : [expiresAt];
    });
    const deadlines = [...retryDeadlines, ...actionExpiryDeadlines];
    const nextDeadline = deadlines.filter((deadline) => deadline > currentTime).reduce((earliest, deadline) => Math.min(earliest, deadline), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextDeadline)) return;
    const timer = window.setTimeout(() => setCurrentTime(Date.now()), Math.max(0, nextDeadline - now) + 50);
    return () => window.clearTimeout(timer);
  }, [actions, activeRequestIds, currentTime, messages, sending]);

  useEffect(() => {
    const history = historyRef.current;
    if (!history || !stickToBottomRef.current) return;
    history.scrollTo({ behavior: loading ? "auto" : "smooth", top: history.scrollHeight });
  }, [actions, loading, messages, sending]);

  useEffect(() => {
    if (loading || sending || !hasServerPendingMessage) return;
    const controllers = controllersRef.current;
    let requestController: AbortController | null = null;
    const pollConversation = () => {
      if (requestController) return;
      const controller = new AbortController();
      requestController = controller;
      controllers.add(controller);
      const conversationQuery = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
      void fetch(`/api/workspaces/${workspaceId}/ai/conversation${conversationQuery}`, { cache: "no-store", signal: controller.signal })
        .then(readResponse)
        .then((body) => {
          if (controller.signal.aborted) return;
          const incomingMessages = normalizeMessages(body);
          const incomingActions = normalizeActions(body);
          setMessages((current) => mergeMessages(current, incomingMessages));
          setActions((current) => mergeActions(current, incomingActions));
        })
        .catch(() => undefined)
        .finally(() => {
          controllers.delete(controller);
          if (requestController === controller) requestController = null;
        });
    };
    const timer = window.setInterval(pollConversation, 3_000);
    return () => {
      window.clearInterval(timer);
      requestController?.abort();
      if (requestController) controllers.delete(requestController);
    };
  }, [conversationId, hasServerPendingMessage, loading, sending, workspaceId]);

  useEffect(() => {
    if (!agentTask || agentTask.status !== "running" || agentAdvancingRef.current || sending) return;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const previousStepCount = agentTask.steps.length;
    agentAdvancingRef.current = true;
    setAgentAdvancing(true);
    void fetch(`/api/workspaces/${workspaceId}/ai/agent-tasks/${agentTask.id}/next`, {
      method: "POST",
      signal: controller.signal
    })
      .then(readResponse)
      .then(async (body) => {
        if (controller.signal.aborted) return;
        const nextTask = normalizeAgentTask(body);
        if (!nextTask) throw new Error("Agent task response is invalid");
        setAgentTask(nextTask);
        const completedSteps = nextTask.steps.slice(previousStepCount);
        if (completedSteps.some((step) => ["create", "create_diagram", "update"].includes(step.action) && step.status === "completed")) {
          await onWorkspaceChange({ documents: [], fileNodes: [], openDocumentId: completedSteps.at(-1)?.documentId ?? null });
        }
      })
      .catch((advanceError) => {
        if (!controller.signal.aborted) setError(advanceError instanceof Error ? advanceError.message : "Agent step failed");
      })
      .finally(() => {
        controllersRef.current.delete(controller);
        agentAdvancingRef.current = false;
        if (!controller.signal.aborted) setAgentAdvancing(false);
      });
    return () => controller.abort();
  }, [agentTask, onWorkspaceChange, sending, workspaceId]);

  function createController() {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }

  function releaseController(controller: AbortController) {
    controllersRef.current.delete(controller);
  }

  async function loadOlderMessages() {
    if (!nextCursor || loading || loadingMore) return;
    const cursor = nextCursor;
    setLoadingMore(true);
    setError(null);
    stickToBottomRef.current = false;
    const controller = createController();

    try {
      const conversationQuery = conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : "";
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/conversation?cursor=${encodeURIComponent(cursor)}${conversationQuery}`, { cache: "no-store", signal: controller.signal });
      const body = await readResponse(response);
      if (controller.signal.aborted) return;
      const incomingMessages = normalizeMessages(body);
      const incomingActions = normalizeActions(body);
      setMessages((current) => mergeMessages(incomingMessages, current));
      setActions((current) => mergeActions(incomingActions, current));
      setNextCursor(normalizeNextCursor(body));
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Older AI messages failed to load");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  function mergeResponse(body: unknown, optimisticMessageId?: string) {
    const incomingMessages = normalizeMessages(body);
    const assistantMessage = incomingMessages.filter((message) => message.role === "assistant").at(-1) ?? null;
    if (assistantMessage && !typedMessageIdsRef.current.has(assistantMessage.id)) {
      typedMessageIdsRef.current.add(assistantMessage.id);
      setTypingMessageId(assistantMessage.id);
    }
    const incomingActions = normalizeActions(body);
    setMessages((current) => {
      const serverUserMessages = incomingMessages.filter((message) => message.role === "user");
      const serverUserMessageIds = new Set(serverUserMessages.map((message) => message.id));
      const serverClientRequestIds = new Set(serverUserMessages.flatMap((message) => message.clientRequestId ? [message.clientRequestId] : []));
      const hasServerUserMessage = serverUserMessages.length > 0;
      const base = optimisticMessageId && hasServerUserMessage
        ? current.filter((message) => (
            message.id !== optimisticMessageId
            && !(message.role === "user" && Boolean(message.clientRequestId && serverClientRequestIds.has(message.clientRequestId)))
            && !(message.role === "assistant" && Boolean(message.inReplyToMessageId && serverUserMessageIds.has(message.inReplyToMessageId)))
          ))
        : current;
      const delivered = optimisticMessageId && !hasServerUserMessage
        ? base.map((message) => message.id === optimisticMessageId ? { ...message, status: "sent" as const } : message)
        : base;
      return mergeMessages(delivered, incomingMessages);
    });
    setActions((current) => mergeActions(current, incomingActions));
    setConversationId((current) => normalizeConversationId(body) ?? current);
  }

  async function sendContent(content: string, activeDocumentId: string | null, clientRequestId: string, optimisticMessageId: string, allowContextFallback: boolean, requestMode: AiMode) {
    if (loading || sending) return;
    activeRequestIdRef.current = clientRequestId;
    setActiveRequestIds((current) => new Set(current).add(clientRequestId));
    setSending(true);
    setError(null);
    const processingStartedAt = new Date().toISOString();
    setMessages((current) => current.map((message) => message.id === optimisticMessageId ? {
      ...message,
      error: null,
      processingStartedAt,
      retryable: null,
      status: "pending"
    } : message));
    const controller = createController();
    activeSendControllerRef.current = controller;

    try {
      let requestActiveDocumentId = activeDocumentId;
      if (requestActiveDocumentId && onBeforeSend) {
        try {
          await onBeforeSend(requestActiveDocumentId);
        } catch {
          if (allowContextFallback) {
            requestActiveDocumentId = null;
            if (mountedRef.current) {
              setMessages((current) => current.map((message) => message.id === optimisticMessageId ? { ...message, activeDocumentId: null } : message));
            }
          }
        }
      }
      if (controller.signal.aborted) return;
      const endpoint = requestMode === "agent"
        ? `/api/workspaces/${workspaceId}/ai/agent-tasks`
        : `/api/workspaces/${workspaceId}/ai/messages`;
      const response = await fetch(endpoint, {
        body: JSON.stringify({ activeDocumentId: requestActiveDocumentId, clientRequestId, content, conversationId, mode: requestMode }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal
      });
      const body = await readResponse(response);
      if (controller.signal.aborted) return;
      mergeResponse(body, optimisticMessageId);
      if (requestMode === "agent") setAgentTask(normalizeAgentTask(body));
    } catch (sendError) {
      if (controller.signal.aborted) return;
      const message = sendError instanceof Error ? sendError.message : "Message failed to send";
      const retryable = sendError instanceof AiRequestError ? sendError.retryable : true;
      setMessages((current) => current.map((entry) => entry.id === optimisticMessageId ? {
        ...entry,
        error: message,
        retryable,
        status: retryable ? "pending" : "failed"
      } : entry));
      setError(message);
    } finally {
      if (mountedRef.current) {
        setActiveRequestIds((current) => {
          const next = new Set(current);
          next.delete(clientRequestId);
          return next;
        });
      }
      releaseController(controller);
      if (activeRequestIdRef.current === clientRequestId) activeRequestIdRef.current = null;
      if (activeSendControllerRef.current === controller) activeSendControllerRef.current = null;
      if (mountedRef.current) setSending(false);
    }
  }

  function enqueueMessage(content: string, activeDocumentId: string | null) {
    const normalizedContent = content.trim();
    if (!normalizedContent || loading || sending || (mode === "agent" && agentBusy)) return;
    const clientRequestId = requestId();
    const createdAt = new Date().toISOString();
    const optimisticMessage: AiMessage = {
      activeDocumentId,
      clientRequestId,
      content: normalizedContent,
      createdAt,
      error: null,
      id: clientRequestId,
      inReplyToMessageId: null,
      processingStartedAt: createdAt,
      retryable: null,
      role: "user",
      status: "pending"
    };
    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    stickToBottomRef.current = true;
    void sendContent(normalizedContent, activeDocumentId, clientRequestId, optimisticMessage.id, true, mode);
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    enqueueMessage(draft, contextDocument?.id ?? null);
  }

  function retryMessage(message: AiMessage) {
    if (!message.clientRequestId || loading || sending) return;
    stickToBottomRef.current = true;
    void sendContent(message.content, message.activeDocumentId, message.clientRequestId, message.id, false, mode);
  }

  function repeatMessage(message: AiMessage) {
    enqueueMessage(message.content, message.activeDocumentId);
  }

  async function copyMessage(message: AiMessage) {
    await window.navigator.clipboard.writeText(message.content).catch(() => undefined);
  }

  function setFeedback(messageId: string, feedback: AiMessageFeedback) {
    setMessageFeedback((current) => current[messageId] === feedback
      ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== messageId))
      : { ...current, [messageId]: feedback });
  }

  function stopGeneration() {
    const activeRequestId = activeRequestIdRef.current;
    activeSendControllerRef.current?.abort();
    setMessages((current) => current.map((message) => activeRequestId && message.clientRequestId === activeRequestId ? {
      ...message,
      error: "generation_stopped",
      retryable: true,
      status: "failed"
    } : message));
    setSending(false);
  }

  async function confirmAgentTask() {
    if (!agentTask || !["awaiting_confirmation", "blocked"].includes(agentTask.status) || !canApply) return;
    setAgentAdvancing(true);
    setError(null);
    const controller = createController();
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/agent-tasks/${agentTask.id}/confirm`, {
        method: "POST",
        signal: controller.signal
      });
      const body = await readResponse(response);
      if (!controller.signal.aborted) setAgentTask(normalizeAgentTask(body));
    } catch (confirmError) {
      if (!controller.signal.aborted) setError(confirmError instanceof Error ? confirmError.message : "Agent confirmation failed");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setAgentAdvancing(false);
    }
  }

  async function stopAgentTask() {
    if (!agentTask || !["awaiting_confirmation", "blocked", "running"].includes(agentTask.status)) return;
    setAgentAdvancing(true);
    setError(null);
    const controller = createController();
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/agent-tasks/${agentTask.id}/stop`, {
        method: "POST",
        signal: controller.signal
      });
      const body = await readResponse(response);
      if (!controller.signal.aborted) setAgentTask(normalizeAgentTask(body));
    } catch (stopError) {
      if (!controller.signal.aborted) setError(stopError instanceof Error ? stopError.message : "Agent stop failed");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setAgentAdvancing(false);
    }
  }

  async function prepareAgentDrafts() {
    if (!agentTask || !["awaiting_confirmation", "blocked"].includes(agentTask.status) || !canApply) return;
    setAgentAdvancing(true);
    setError(null);
    const controller = createController();
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/agent-tasks/${agentTask.id}/drafts`, {
        method: "POST",
        signal: controller.signal
      });
      const body = await readResponse(response);
      if (controller.signal.aborted) return;
      setAgentTask(normalizeAgentTask(body));
      setActions((current) => mergeActions(current, normalizeActions(body)));
    } catch (draftError) {
      if (!controller.signal.aborted) setError(draftError instanceof Error ? draftError.message : "Agent drafts failed");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setAgentAdvancing(false);
    }
  }

  function handleDraftChange(value: string, textarea: HTMLTextAreaElement) {
    setDraft(value);
    setComposerCursor(textarea.selectionStart);
    setComposerCommandIndex(0);
    setComposerMenuDismissed(false);
    setModeMenuOpen(false);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(160, textarea.scrollHeight)}px`;
  }

  function handleComposerSelection(textarea: HTMLTextAreaElement) {
    setComposerCursor(textarea.selectionStart);
    setComposerCommandIndex(0);
    setComposerMenuDismissed(false);
  }

  function applyComposerCommand(option: ComposerCommandOption) {
    if (!composerCommand || option.disabled) return;
    if (composerCommand.trigger === "@") setContextScope(option.value as AiContextScope);
    else setMode(option.value as AiMode);
    const nextDraft = `${draft.slice(0, composerCommand.start)}${draft.slice(composerCommand.end)}`;
    setDraft(nextDraft);
    setComposerCursor(composerCommand.start);
    setComposerMenuDismissed(false);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(composerCommand.start, composerCommand.start);
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (composerMenuOpen && composerCommand) {
      if (event.key === "ArrowDown" && composerCommandOptions.length > 0) {
        event.preventDefault();
        setComposerCommandIndex((current) => (current + 1) % composerCommandOptions.length);
        return;
      }
      if (event.key === "ArrowUp" && composerCommandOptions.length > 0) {
        event.preventDefault();
        setComposerCommandIndex((current) => (current - 1 + composerCommandOptions.length) % composerCommandOptions.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setComposerMenuDismissed(true);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const option = composerCommandOptions[Math.min(composerCommandIndex, composerCommandOptions.length - 1)];
        if (option) applyComposerCommand(option);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function runAction(action: AiDraftAction, operation: "apply" | "discard") {
    if (loading || pendingActionIds.has(action.id) || (operation === "apply" && !canApply)) return;
    setPendingActionIds((current) => new Set(current).add(action.id));
    setError(null);
    let requestStarted = false;

    try {
      if (operation === "apply" && action.type === "update_document") {
        if (!action.documentId) throw new Error("The target document is no longer available");
        await onBeforeApply(action.documentId);
      }
      if (!mountedRef.current) return;
      setActions((current) => current.map((candidate) => candidate.id === action.id ? { ...candidate, error: null, status: operation === "apply" ? "applying" : candidate.status } : candidate));
      requestStarted = true;
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/actions/${action.id}/${operation}`, {
        method: "POST"
      });
      const body = await readResponse(response);
      const incomingActions = normalizeActions(body);
      if (mountedRef.current) {
        setActions((current) => {
          const fallbackStatus = operation === "apply" ? "applied" : "discarded";
          const withFallback = current.map((candidate) => candidate.id === action.id ? { ...candidate, error: null, status: fallbackStatus } : candidate);
          return mergeActions(withFallback, incomingActions);
        });
      }
      if (operation === "apply") {
        try {
          const result = normalizeApplyResult(body);
          if (action.type === "update_document") result.openDocumentId = null;
          await onWorkspaceChange(result);
        } catch (reconciliationError) {
          if (mountedRef.current) {
            const detail = reconciliationError instanceof Error ? reconciliationError.message : "workspace refresh failed";
            setError(`Change was applied, but ${detail}`);
          }
        }
      }
    } catch (actionError) {
      if (!mountedRef.current) return;
      const updateConflict = requestStarted
        && action.type === "update_document"
        && actionError instanceof AiRequestError
        && (actionError.code === "document_version_conflict" || actionError.status === 409);
      const message = updateConflict
        ? "This document changed after the draft was prepared. Regenerate the draft from the latest version."
        : actionError instanceof Error ? actionError.message : `Action ${operation} failed`;
      const status = updateConflict ? "conflict" : action.status;
      setActions((current) => current.map((candidate) => candidate.id === action.id ? { ...candidate, error: message, status } : candidate));
      setError(message);
    } finally {
      if (mountedRef.current) {
        setPendingActionIds((current) => {
          const next = new Set(current);
          next.delete(action.id);
          return next;
        });
      }
    }
  }

  function handleHistoryScroll() {
    const history = historyRef.current;
    if (!history) return;
    stickToBottomRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 48;
  }

  function toggleActionPreview(actionId: string) {
    setExpandedActionIds((current) => {
      const next = new Set(current);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }

  async function startNewChat() {
    if (loading || sending || clearingConversation) return;
    setClearingConversation(true);
    setError(null);
    const controller = createController();
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/conversations`, { headers: { "content-type": "application/json" }, method: "POST", signal: controller.signal });
      const body = await readResponse(response);
      const createdConversationId = normalizeConversationId(body);
      if (!createdConversationId) throw new Error("New conversation could not be created");
      if (controller.signal.aborted) return;
      setActions([]);
      setAgentTask(null);
      setConversationId(createdConversationId);
      setMessages([]);
      setNextCursor(null);
      setExpandedActionIds(new Set());
      setChatSwitcherOpen(false);
      await loadConversations();
      replaceAiConversationUrl(createdConversationId, workspaceId);
      stickToBottomRef.current = true;
    } catch (clearError) {
      if (!controller.signal.aborted) setError(clearError instanceof Error ? clearError.message : "Conversation could not be cleared");
    } finally {
      releaseController(controller);
      if (!controller.signal.aborted) setClearingConversation(false);
    }
  }

  return (
    <div className="ai-panel">
      <header className="ai-panel-header">
        <div className="ai-panel-heading">
          <strong>Slate Assistant</strong>
          <small>{contextLabel}</small>
        </div>
        <div className="ai-panel-actions">
          <button className={chatSwitcherOpen ? "active" : ""} disabled={loading || sending || clearingConversation || agentBusy} onClick={() => setChatSwitcherOpen((current) => !current)} type="button">Chats</button>
          <button disabled={loading || sending || clearingConversation || agentBusy} onClick={() => void startNewChat()} type="button">New chat</button>
          {chatSwitcherOpen && (
            <div className="ai-chat-switcher">
              <div><strong>Chats</strong><small>{contextLabel}</small></div>
              <input aria-label="Search chats" onChange={(event) => setChatSearch(event.target.value)} placeholder="Search chats" value={chatSearch} />
              <div className="ai-chat-switcher-list">
                {visibleConversations.map((conversation) => (
                  <button aria-pressed={conversation.id === conversationId} className={conversation.id === conversationId ? "active" : ""} key={conversation.id} onClick={() => void switchConversation(conversation.id)} type="button">
                    <strong>{conversation.title}</strong>
                    <small>Workspace · {conversation.messageCount} messages</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      <div aria-live="polite" className="ai-history" onScroll={handleHistoryScroll} ref={historyRef} role="log">
        {loading && <div className="ai-loading"><i /><span>Loading conversation</span></div>}
        {!loading && nextCursor && (
          <button className="ai-load-older" disabled={loadingMore} onClick={() => void loadOlderMessages()} type="button">
            {loadingMore ? "Loading older messages" : "Load older messages"}
          </button>
        )}
        {!loading && messages.length === 0 && actions.length === 0 && !agentTask && (
          <div className="ai-empty-state">
            <h2>How can I help with this workspace?</h2>
            <p>Ask about files, architecture, runs, or workspace changes.</p>
            <div className="ai-suggestions-group">
              <span>Suggested prompts</span>
              <div className="ai-suggestion-list">
                <button onClick={() => setDraft("Summarize this workspace and its most important files.")} type="button">Summarize workspace</button>
                <button onClick={() => setDraft("Find the most important files and explain why they matter.")} type="button">Find important files</button>
                <button onClick={() => setDraft("Explain the current architecture and its main components.")} type="button">Explain architecture</button>
                <button onClick={() => setDraft("Review the latest run and identify the next action.")} type="button">Review latest run</button>
              </div>
            </div>
          </div>
        )}

        {conversationMessages.map((message, index) => {
          const previousMessage = conversationMessages[index - 1] ?? null;
          const previousCreatedAt = previousMessage ? Date.parse(previousMessage.createdAt) : Number.NaN;
          const createdAt = Date.parse(message.createdAt);
          const grouped = message.role === "assistant"
            && previousMessage?.role === message.role
            && !Number.isNaN(previousCreatedAt)
            && !Number.isNaN(createdAt)
            && createdAt - previousCreatedAt < 5 * 60_000;
          const sourceRequest = message.inReplyToMessageId ? messagesById.get(message.inReplyToMessageId) ?? null : null;
          const retryablePending = canRetryPendingMessage(message, activeRequestIds, currentTime);
          const activelySending = Boolean(message.clientRequestId && activeRequestIds.has(message.clientRequestId));
          const pendingWithError = message.status === "pending" && !activelySending && Boolean(message.error);
          const failed = message.status === "failed" || retryablePending || pendingWithError;
          const friendlyError = friendlyAiError(message.error);
          return (
            <article className={`ai-message ai-message-${message.role}${message.role === "assistant" ? " ai-message-appear" : ""}${grouped ? " ai-message-grouped" : ""}`} key={message.id}>
              {!grouped && message.role === "assistant" && (
                <div className="ai-message-meta">
                  <time title={new Date(message.createdAt).toLocaleString()}>{formatMessageTime(message.createdAt)}</time>
                </div>
              )}
              {message.role === "assistant" ? <AssistantMessageContent content={message.content} messageId={message.id} onComplete={handleTypingComplete} onProgress={scrollHistoryToBottom} shouldType={message.id === typingMessageId} /> : <p>{message.content}</p>}
              {failed && (
                <div className="ai-message-error-card">
                  <strong>I couldn&apos;t complete that request.</strong>
                  <p>{retryablePending && !message.error ? "The previous attempt stopped before completing. Try it again." : friendlyError.message}</p>
                  <div>
                    {(message.role === "user" && message.clientRequestId && message.retryable !== false || sourceRequest?.role === "user") && (
                      <button disabled={loading || sending} onClick={() => message.role === "user" && message.clientRequestId ? retryMessage(message) : sourceRequest ? repeatMessage(sourceRequest) : undefined} type="button">Retry</button>
                    )}
                    {message.error && (
                      <details>
                        <summary>Details</summary>
                        <code>{friendlyError.detail}</code>
                      </details>
                    )}
                  </div>
                </div>
              )}
              {message.status === "sent" && message.role === "assistant" && (
                <div className="ai-message-actions">
                  <button aria-label="Copy response" data-tooltip="Copy" onClick={() => void copyMessage(message)} type="button">
                    <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.8} />
                  </button>
                  <button aria-label="Like response" aria-pressed={messageFeedback[message.id] === "liked"} className={messageFeedback[message.id] === "liked" ? "active" : ""} data-tooltip="Like" onClick={() => setFeedback(message.id, "liked")} type="button">
                    <HugeiconsIcon icon={ThumbsUpIcon} size={16} strokeWidth={1.8} />
                  </button>
                  <button aria-label="Dislike response" aria-pressed={messageFeedback[message.id] === "disliked"} className={messageFeedback[message.id] === "disliked" ? "active" : ""} data-tooltip="Dislike" onClick={() => setFeedback(message.id, "disliked")} type="button">
                    <HugeiconsIcon icon={ThumbsDownIcon} size={16} strokeWidth={1.8} />
                  </button>
                  {sourceRequest?.role === "user" && (
                    <button aria-label="Regenerate response" data-tooltip="Regenerate" disabled={loading || sending} onClick={() => repeatMessage(sourceRequest)} type="button">
                      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {sending && (
          <div className="ai-thinking" aria-live="polite">
            <span><i /><i /><i /></span>
            <p>Thinking · Reading workspace</p>
          </div>
        )}

        {agentTask && (
          <section className={`ai-agent-task ai-agent-task-${agentTask.status}`} aria-label="Agent task">
            <div className="ai-agent-task-heading">
              <div>
                <span>Agent task</span>
                <strong>{agentStatusLabel(agentTask.status)}</strong>
              </div>
              <b>{agentTask.steps.length} steps</b>
            </div>
            <div className="ai-agent-plan">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{agentTask.plan}</ReactMarkdown>
            </div>
            {agentTask.steps.length > 0 && (
              <ol className="ai-agent-steps">
                {agentTask.steps.map((step) => (
                  <li className={`ai-agent-step ai-agent-step-${step.status}`} key={step.id}>
                    <i />
                    <span>
                      <strong>{step.label}</strong>
                      {agentStepDetail(step) && <small>{agentStepDetail(step)}</small>}
                      {step.errorCode && <small>{step.errorCode}</small>}
                      {agentRunOutput(step) && <pre>{agentRunOutput(step)}</pre>}
                    </span>
                  </li>
                ))}
                {agentTask.status === "running" && agentAdvancing && (
                  <li className="ai-agent-step ai-agent-step-running"><i /><span><strong>Working on next step</strong></span></li>
                )}
              </ol>
            )}
            {agentTask.status === "running" && agentTask.steps.length === 0 && agentAdvancing && (
              <div className="ai-agent-initializing"><i /><span>Reading workspace and starting the first step</span></div>
            )}
            {agentTask.summary && <div className="ai-agent-summary"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{agentTask.summary}</ReactMarkdown></div>}
            {agentTask.errorCode && <p className="ai-agent-error">{agentTask.errorCode}</p>}
            <div className="ai-agent-controls">
              {["awaiting_confirmation", "blocked"].includes(agentTask.status) && (
                <button className="ai-agent-confirm" disabled={!canApply || agentAdvancing} onClick={() => void confirmAgentTask()} type="button">{agentTask.status === "blocked" ? "Confirm continuation" : "Confirm and run"}</button>
              )}
              {["awaiting_confirmation", "blocked"].includes(agentTask.status) && (
                <button disabled={!canApply || agentAdvancing} onClick={() => void prepareAgentDrafts()} type="button">Prepare drafts</button>
              )}
              {["awaiting_confirmation", "blocked", "running"].includes(agentTask.status) && (
                <button disabled={agentAdvancing && agentTask.status !== "running"} onClick={() => void stopAgentTask()} type="button">Stop</button>
              )}
            </div>
            {!canApply && <p className="ai-viewer-notice">Editor access is required to confirm Agent mode.</p>}
          </section>
        )}

        {currentAction && !typingMessageId && (() => {
          const pending = pendingActionIds.has(currentAction.id);
          const expiresAt = currentAction.expiresAt ? Date.parse(currentAction.expiresAt) : Number.NaN;
          const expired = currentAction.status !== "applying" && !Number.isNaN(expiresAt) && expiresAt <= currentTime;
          const actionable = isActionableAction(currentAction) && !expired && (currentAction.type !== "update_document" || Boolean(currentAction.documentId));
          const markdownPreview = currentAction.type === "create_note" || currentAction.type === "create_table_note";
          const previewExpanded = expandedActionIds.has(currentAction.id);
          return (
            <section className={`ai-action-card ai-action-${currentAction.status} ai-action-appear`} aria-label="Proposed workspace change" key={currentAction.id}>
              <div className="ai-action-card-heading">
                <div>
                  <span>Proposed change</span>
                  <strong>{currentAction.title}</strong>
                </div>
                <b>{pending ? "Working" : expired ? "Expired" : statusLabel(currentAction.status)}</b>
              </div>
              <div className="ai-action-target">
                <small>{actionTypeLabel(currentAction)}</small>
                {currentAction.target && <code>{currentAction.target}</code>}
              </div>
              {currentAction.details.length > 0 && <div className="ai-action-details">{currentAction.details.map((detail) => <small key={detail}>{detail}</small>)}</div>}
              {previewExpanded && currentAction.preview && currentAction.type === "update_document" && (
                <div aria-label={`Proposed changes for ${currentAction.target ?? "document"}`} className="ai-action-diff" role="region">
                  {currentAction.preview.split("\n").map((line, index) => (
                    <div className={`ai-action-diff-line ai-action-diff-${diffLineType(line)}`} key={`${index}-${line}`}>
                      <code>{line || " "}</code>
                    </div>
                  ))}
                </div>
              )}
              {previewExpanded && currentAction.preview && markdownPreview && (
                <div className="ai-action-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{currentAction.preview}</ReactMarkdown>
                </div>
              )}
              {previewExpanded && currentAction.preview && !markdownPreview && currentAction.type !== "update_document" && <pre className="ai-action-preview">{currentAction.preview}</pre>}
              {previewExpanded && currentAction.previewTruncated && <small className="ai-action-preview-truncated">Preview shortened for review.</small>}
              {currentAction.error && (
                <div className="ai-action-error">
                  <span>{friendlyAiError(currentAction.error).message}</span>
                  <details><summary>Details</summary><code>{friendlyAiError(currentAction.error).detail}</code></details>
                </div>
              )}
              {currentAction.type === "update_document" && currentAction.status === "conflict" && (
                <span className="ai-action-conflict-guidance">Regenerate this change from the latest document version.</span>
              )}
              {(currentAction.preview || actionable) && (
                <div className="ai-action-controls">
                  {currentAction.preview && <button onClick={() => toggleActionPreview(currentAction.id)} type="button">{previewExpanded ? "Hide preview" : "Preview"}</button>}
                  {actionable && <button className="ai-action-apply" disabled={loading || !canApply || pending} onClick={() => void runAction(currentAction, "apply")} title={canApply ? "Apply this change" : "Editor access required"} type="button">{currentAction.status === "applying" ? "Retry" : "Apply"}</button>}
                  {actionable && <button disabled={loading || pending} onClick={() => void runAction(currentAction, "discard")} type="button">Discard</button>}
                </div>
              )}
              {!canApply && actionable && <p className="ai-viewer-notice">Editor access is required to apply this change.</p>}
            </section>
          );
        })()}

        {previousActions.length > 0 && (
          <details className="ai-action-history">
            <summary>Previous changes · {previousActions.length}</summary>
            <div>
              {[...previousActions].reverse().map((action) => {
                const pending = pendingActionIds.has(action.id);
                const expiresAt = action.expiresAt ? Date.parse(action.expiresAt) : Number.NaN;
                const expired = !Number.isNaN(expiresAt) && expiresAt <= currentTime;
                const actionable = isActionableAction(action) && !expired && (action.type !== "update_document" || Boolean(action.documentId));
                return (
                  <span key={action.id}>
                    <span><strong>{action.target ?? action.title}</strong><small>{expired ? "Expired" : statusLabel(action.status)}</small></span>
                    {actionable && (
                      <span className="ai-action-history-controls">
                        <button disabled={!canApply || pending} onClick={() => void runAction(action, "apply")} type="button">Apply</button>
                        <button disabled={pending} onClick={() => void runAction(action, "discard")} type="button">Discard</button>
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {error && <div className="ai-panel-error" role="alert"><strong>Assistant unavailable</strong><span>{friendlyAiError(error).message}</span></div>}
      <form className="ai-composer" onSubmit={submitMessage}>
        <div className="ai-composer-shell" ref={composerShellRef}>
          {composerMenuOpen && composerCommand && (
            <div aria-label={composerCommand.trigger === "@" ? "Context options" : "Assistant actions"} className="ai-composer-command-menu" data-trigger={composerCommand.trigger} role="listbox">
              <div className="ai-composer-command-heading">
                <span aria-hidden="true">{composerCommand.trigger}</span>
                <div><strong>{composerCommand.trigger === "@" ? "Add context" : "Choose an action"}</strong><small>{composerCommand.trigger === "@" ? "Select what the assistant can use" : "Select how the assistant should respond"}</small></div>
              </div>
              {composerCommandOptions.length > 0 ? composerCommandOptions.map((option, index) => (
                <button aria-selected={index === composerCommandIndex} className={index === composerCommandIndex ? "active" : ""} disabled={option.disabled} key={option.value} onClick={() => applyComposerCommand(option)} role="option" type="button">
                  <span>{option.label}</span><small>{option.description}</small>
                </button>
              )) : <p>No matching options</p>}
            </div>
          )}
          <textarea aria-label="Message Slate Assistant" disabled={loading || sending || (mode === "agent" && agentBusy)} maxLength={maximumMessageLength} onChange={(event) => handleDraftChange(event.target.value, event.target)} onKeyDown={handleComposerKeyDown} onSelect={(event) => handleComposerSelection(event.currentTarget)} placeholder={loading ? "Loading conversation" : mode === "plan" ? "Describe what should be planned..." : mode === "agent" ? agentBusy ? "Finish or stop the current agent task" : "Describe the task for the agent..." : "Ask anything about this workspace..."} ref={composerRef} rows={1} value={draft} />
          <div className="ai-composer-footer">
            <div className="ai-mode-menu" data-open={modeMenuOpen ? "true" : "false"}>
              <button aria-expanded={modeMenuOpen} aria-haspopup="menu" className="ai-mode-trigger" disabled={sending} onClick={() => { setComposerMenuDismissed(true); setModeMenuOpen((open) => !open); }} type="button">
                <span>{modeLabels[mode]}</span>
                <span aria-hidden="true">⌄</span>
              </button>
              {modeMenuOpen && (
                <div aria-label="Assistant mode" className="ai-mode-options" role="menu">
                  {(["ask", "plan", "agent"] as AiMode[]).map((nextMode) => (
                    <button aria-checked={mode === nextMode} className={mode === nextMode ? "active" : ""} disabled={nextMode === "agent" && !canApply} key={nextMode} onClick={() => { setMode(nextMode); setModeMenuOpen(false); }} role="menuitemradio" title={nextMode === "agent" && !canApply ? "Editor access required" : undefined} type="button">
                      {modeLabels[nextMode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div aria-label="Assistant context" className="ai-context-switcher" role="group">
              <button aria-pressed={effectiveContextScope === "workspace"} className={effectiveContextScope === "workspace" ? "active" : ""} onClick={() => { setComposerMenuDismissed(true); setContextScope("workspace"); }} type="button">Workspace</button>
              <button aria-pressed={effectiveContextScope === "document"} className={effectiveContextScope === "document" ? "active" : ""} disabled={!activeDocument} onClick={() => { setComposerMenuDismissed(true); setContextScope("document"); }} title={activeDocument ? `Use ${activeDocument.title} as context` : "Open a document to use document context"} type="button">Current document</button>
            </div>
            <span className="ai-composer-shortcut">Enter to send · Shift Enter for newline</span>
            {sending ? (
              <button aria-label="Stop generation" className="ai-composer-stop" onClick={stopGeneration} type="button">Stop</button>
            ) : (
              <button aria-label="Send message" disabled={loading || draft.trim().length === 0 || (mode === "agent" && agentBusy)} type="submit">↑</button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
