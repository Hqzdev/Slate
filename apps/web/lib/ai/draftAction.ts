import { compileCanvasDiagram, type CanvasDiagramEdge, type CanvasDiagramNode, type CanvasDiagramNodeKind, type CanvasDiagramPayload } from "./canvasDiagram";
import { renderMarkdownTable } from "./markdownTable";
import { isDatabaseSafeText, truncateDatabaseSafeText } from "../databaseSafeText";
import { isCanvasDocumentV1 } from "../canvas/canvasDocumentSchema";
import { assertAiCreateTargetName } from "./createTargetPolicy";

export type AiDraftActionType = "create_document" | "create_note" | "create_table_note" | "create_canvas_diagram" | "update_document";
export type AiCreateDraftActionType = Exclude<AiDraftActionType, "update_document">;

export type CreateDocumentDraftActionPayload = {
  content: string;
  parentId: string | null;
  title: string;
};

export type CreateNoteDraftActionPayload = {
  content: string;
  parentId: string | null;
  title: string;
};

export type CreateTableNoteDraftActionPayload = {
  columns: string[];
  parentId: string | null;
  rows: string[][];
  title: string;
};

export type CreateCanvasDiagramDraftActionPayload = CanvasDiagramPayload;

export type UpdateDocumentDraftActionPayload = {
  content: string;
  diffPreview: string;
  diffTruncated: boolean;
  documentId: string;
  documentType: "code" | "note";
  expectedContentHash: string;
  expectedUpdatedAt: string;
  resultContentHash: string;
  title: string;
};

export type AiDraftActionPayloadByType = {
  create_canvas_diagram: CreateCanvasDiagramDraftActionPayload;
  create_document: CreateDocumentDraftActionPayload;
  create_note: CreateNoteDraftActionPayload;
  create_table_note: CreateTableNoteDraftActionPayload;
  update_document: UpdateDocumentDraftActionPayload;
};

export type AiDraftActionPayload = AiDraftActionPayloadByType[AiDraftActionType];

export type MaterializedAiDraftAction = {
  canvasState: object | null;
  content: string;
  language: string | null;
  parentId: string | null;
  title: string;
  type: "canvas" | "code" | "note";
};

type JsonRecord = Record<string, unknown>;

const maximumContentLength = 262_144;
const maximumParentIdLength = 191;
const maximumTitleLength = 120;
const maximumColumns = 20;
const maximumRows = 200;
const maximumCellLength = 2_000;
const maximumCanvasNodes = 25;
const maximumCanvasEdges = 50;
const maximumCanvasNodeKeyLength = 64;
const maximumCanvasNodeLabelLength = 500;
const maximumCanvasEdgeLabelLength = 200;
const maximumPreviewLength = 1_200;
const maximumDocumentIdLength = 191;
const contentHashPattern = /^[a-f0-9]{64}$/;
const canvasNodeKinds = new Set<CanvasDiagramNodeKind>(["data", "decision", "note", "process", "terminal"]);

function parseRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as JsonRecord;
}

function requireExactKeys(record: JsonRecord, allowedKeys: string[], label: string) {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new Error(`${label} contains unknown field ${unknownKey}`);
  }
}

function parseString(value: unknown, label: string, maximumLength: number, allowEmpty = false) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  if (!allowEmpty && value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }

  if (value.length > maximumLength) {
    throw new Error(`${label} exceeds the maximum length`);
  }

  if (!isDatabaseSafeText(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }

  return value;
}

function parseParentId(value: unknown) {
  if (value === undefined || value === null) return null;
  const parentId = parseString(value, "parentId", maximumParentIdLength).trim();
  if (/\s/.test(parentId)) {
    throw new Error("parentId cannot contain whitespace");
  }
  return parentId;
}

function normalizeBaseTitle(value: unknown) {
  const title = parseString(value, "title", maximumTitleLength).trim();
  if (title === "." || title === "..") {
    throw new Error("title is reserved");
  }
  if (title.includes("/") || title.includes("\\")) {
    throw new Error("title cannot contain path separators");
  }
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error("title cannot contain control characters");
  }
  return title;
}

function titleExtension(title: string) {
  const match = title.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizeTypedTitle(value: unknown, extension: "canvas" | "md") {
  const title = normalizeBaseTitle(value);
  const currentExtension = titleExtension(title);
  if (currentExtension && currentExtension !== extension && !(extension === "md" && currentExtension === "mdx")) {
    throw new Error(`title must use the .${extension} extension`);
  }
  const normalizedTitle = currentExtension ? title : `${title}.${extension}`;
  if (normalizedTitle.length > maximumTitleLength) {
    throw new Error("title exceeds the maximum length");
  }
  return normalizedTitle;
}

function parseContent(value: unknown) {
  return parseString(value, "content", maximumContentLength, true);
}

function parseCreateDocumentPayload(value: unknown): CreateDocumentDraftActionPayload {
  const record = parseRecord(value, "create_document payload");
  requireExactKeys(record, ["content", "parentId", "title"], "create_document payload");
  const title = normalizeBaseTitle(record.title);
  assertAiCreateTargetName(title);
  const extension = titleExtension(title);
  if (extension === "md" || extension === "mdx" || extension === "canvas") {
    throw new Error("create_document cannot create note or canvas files");
  }
  return {
    content: parseContent(record.content),
    parentId: parseParentId(record.parentId),
    title
  };
}

function parseCreateNotePayload(value: unknown): CreateNoteDraftActionPayload {
  const record = parseRecord(value, "create_note payload");
  requireExactKeys(record, ["content", "parentId", "title"], "create_note payload");
  const title = normalizeTypedTitle(record.title, "md");
  assertAiCreateTargetName(title);
  return {
    content: parseContent(record.content),
    parentId: parseParentId(record.parentId),
    title
  };
}

function parseStringArray(value: unknown, label: string, maximumItems: number, maximumItemLength: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) {
    throw new Error(`${label} must contain between 1 and ${maximumItems} items`);
  }
  return value.map((item, index) => parseString(item, `${label}[${index}]`, maximumItemLength).trim());
}

function parseCreateTableNotePayload(value: unknown): CreateTableNoteDraftActionPayload {
  const record = parseRecord(value, "create_table_note payload");
  requireExactKeys(record, ["columns", "parentId", "rows", "title"], "create_table_note payload");
  const columns = parseStringArray(record.columns, "columns", maximumColumns, maximumCellLength);
  const normalizedColumnNames = columns.map((column) => column.toLocaleLowerCase());
  if (new Set(normalizedColumnNames).size !== normalizedColumnNames.length) {
    throw new Error("columns must be unique");
  }
  if (!Array.isArray(record.rows) || record.rows.length > maximumRows) {
    throw new Error(`rows must contain at most ${maximumRows} items`);
  }
  const rows = record.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new Error(`rows[${rowIndex}] must contain exactly ${columns.length} cells`);
    }
    return row.map((cell, cellIndex) => parseString(cell, `rows[${rowIndex}][${cellIndex}]`, maximumCellLength, true));
  });
  renderMarkdownTable(columns, rows);
  const title = normalizeTypedTitle(record.title, "md");
  assertAiCreateTargetName(title);
  return {
    columns,
    parentId: parseParentId(record.parentId),
    rows,
    title
  };
}

function parseCanvasNode(value: unknown, index: number): CanvasDiagramNode {
  const record = parseRecord(value, `nodes[${index}]`);
  requireExactKeys(record, ["key", "kind", "label"], `nodes[${index}]`);
  const key = parseString(record.key, `nodes[${index}].key`, maximumCanvasNodeKeyLength).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)) {
    throw new Error(`nodes[${index}].key has an invalid format`);
  }
  const kind = record.kind === undefined ? "process" : record.kind;
  if (typeof kind !== "string" || !canvasNodeKinds.has(kind as CanvasDiagramNodeKind)) {
    throw new Error(`nodes[${index}].kind is invalid`);
  }
  return {
    key,
    kind: kind as CanvasDiagramNodeKind,
    label: parseString(record.label, `nodes[${index}].label`, maximumCanvasNodeLabelLength).trim()
  };
}

function parseCanvasEdge(value: unknown, index: number, nodeKeys: Set<string>): CanvasDiagramEdge {
  const record = parseRecord(value, `edges[${index}]`);
  requireExactKeys(record, ["from", "label", "to"], `edges[${index}]`);
  const from = parseString(record.from, `edges[${index}].from`, maximumCanvasNodeKeyLength).trim();
  const to = parseString(record.to, `edges[${index}].to`, maximumCanvasNodeKeyLength).trim();
  if (!nodeKeys.has(from) || !nodeKeys.has(to)) {
    throw new Error(`edges[${index}] references an unknown node`);
  }
  if (from === to) {
    throw new Error(`edges[${index}] cannot connect a node to itself`);
  }
  const label = record.label === undefined || record.label === null
    ? null
    : parseString(record.label, `edges[${index}].label`, maximumCanvasEdgeLabelLength, true).trim() || null;
  return { from, label, to };
}

function parseCreateCanvasDiagramPayload(value: unknown): CreateCanvasDiagramDraftActionPayload {
  const record = parseRecord(value, "create_canvas_diagram payload");
  requireExactKeys(record, ["edges", "nodes", "parentId", "title"], "create_canvas_diagram payload");
  if (!Array.isArray(record.nodes) || record.nodes.length === 0 || record.nodes.length > maximumCanvasNodes) {
    throw new Error(`nodes must contain between 1 and ${maximumCanvasNodes} items`);
  }
  const nodes = record.nodes.map(parseCanvasNode);
  const nodeKeys = new Set(nodes.map((node) => node.key));
  if (nodeKeys.size !== nodes.length) {
    throw new Error("node keys must be unique");
  }
  if (!Array.isArray(record.edges) || record.edges.length > maximumCanvasEdges) {
    throw new Error(`edges must contain at most ${maximumCanvasEdges} items`);
  }
  const edges = record.edges.map((edge, index) => parseCanvasEdge(edge, index, nodeKeys));
  const edgeKeys = edges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ""}`);
  if (new Set(edgeKeys).size !== edgeKeys.length) {
    throw new Error("edges must be unique");
  }
  const title = normalizeTypedTitle(record.title, "canvas");
  assertAiCreateTargetName(title);
  return {
    edges,
    nodes,
    parentId: parseParentId(record.parentId),
    title
  };
}

function parseContentHash(value: unknown, label: string) {
  const hash = parseString(value, label, 64).trim().toLowerCase();
  if (!contentHashPattern.test(hash)) {
    throw new Error(`${label} is invalid`);
  }
  return hash;
}

function parseExpectedUpdatedAt(value: unknown) {
  const expectedUpdatedAt = parseString(value, "expectedUpdatedAt", 40).trim();
  const parsed = new Date(expectedUpdatedAt);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== expectedUpdatedAt) {
    throw new Error("expectedUpdatedAt must be an ISO timestamp");
  }
  return expectedUpdatedAt;
}

function parseUpdateDocumentPayload(value: unknown): UpdateDocumentDraftActionPayload {
  const record = parseRecord(value, "update_document payload");
  requireExactKeys(record, ["content", "diffPreview", "diffTruncated", "documentId", "documentType", "expectedContentHash", "expectedUpdatedAt", "resultContentHash", "title"], "update_document payload");
  const documentId = parseString(record.documentId, "documentId", maximumDocumentIdLength).trim();
  if (/\s/.test(documentId)) {
    throw new Error("documentId cannot contain whitespace");
  }
  if (record.documentType !== "code" && record.documentType !== "note") {
    throw new Error("documentType must be code or note");
  }
  if (typeof record.diffTruncated !== "boolean") {
    throw new Error("diffTruncated must be a boolean");
  }
  const content = parseContent(record.content);
  const expectedContentHash = parseContentHash(record.expectedContentHash, "expectedContentHash");
  const resultContentHash = parseContentHash(record.resultContentHash, "resultContentHash");
  if (expectedContentHash === resultContentHash) {
    throw new Error("update_document must change document content");
  }
  return {
    content,
    diffPreview: parseString(record.diffPreview, "diffPreview", maximumPreviewLength, true),
    diffTruncated: record.diffTruncated,
    documentId,
    documentType: record.documentType,
    expectedContentHash,
    expectedUpdatedAt: parseExpectedUpdatedAt(record.expectedUpdatedAt),
    resultContentHash,
    title: normalizeBaseTitle(record.title)
  };
}

export function parseAiDraftActionPayload<T extends AiDraftActionType>(type: T, value: unknown): AiDraftActionPayloadByType[T] {
  if (type === "create_document") return parseCreateDocumentPayload(value) as AiDraftActionPayloadByType[T];
  if (type === "create_note") return parseCreateNotePayload(value) as AiDraftActionPayloadByType[T];
  if (type === "create_table_note") return parseCreateTableNotePayload(value) as AiDraftActionPayloadByType[T];
  if (type === "create_canvas_diagram") return parseCreateCanvasDiagramPayload(value) as AiDraftActionPayloadByType[T];
  if (type === "update_document") return parseUpdateDocumentPayload(value) as AiDraftActionPayloadByType[T];
  throw new Error("Unsupported AI draft action type");
}

function buildAiDraftActionPayloadSummary<T extends AiDraftActionType>(type: T, value: unknown) {
  const payload = parseAiDraftActionPayload(type, value);
  if (type === "create_document" || type === "create_note") {
    const content = payload as CreateDocumentDraftActionPayload | CreateNoteDraftActionPayload;
    return {
      contentLength: content.content.length,
      parentId: content.parentId,
      preview: truncateDatabaseSafeText(content.content, maximumPreviewLength),
      title: content.title,
      truncated: content.content.length > maximumPreviewLength
    };
  }
  if (type === "create_table_note") {
    const table = payload as CreateTableNoteDraftActionPayload;
    const content = renderMarkdownTable(table.columns, table.rows);
    return {
      columnCount: table.columns.length,
      parentId: table.parentId,
      preview: truncateDatabaseSafeText(content, maximumPreviewLength),
      rowCount: table.rows.length,
      title: table.title,
      truncated: content.length > maximumPreviewLength
    };
  }
  if (type === "update_document") {
    const update = payload as UpdateDocumentDraftActionPayload;
    return {
      contentLength: update.content.length,
      documentId: update.documentId,
      documentType: update.documentType,
      expectedUpdatedAt: update.expectedUpdatedAt,
      preview: update.diffPreview,
      title: update.title,
      truncated: update.diffTruncated
    };
  }
  const canvas = payload as CreateCanvasDiagramDraftActionPayload;
  const labelsByKey = new Map(canvas.nodes.map((node) => [node.key, node.label]));
  const connectedNodeKeys = new Set(canvas.edges.flatMap((edge) => [edge.from, edge.to]));
  const edgeLines = canvas.edges.map((edge) => {
    const source = labelsByKey.get(edge.from) ?? edge.from;
    const target = labelsByKey.get(edge.to) ?? edge.to;
    return `${source} → ${target}${edge.label ? ` · ${edge.label}` : ""}`;
  });
  const isolatedNodeLines = canvas.nodes.filter((node) => !connectedNodeKeys.has(node.key)).map((node) => `• ${node.label}`);
  const previewSections = [
    ...(edgeLines.length > 0 ? ["Connections", ...edgeLines] : []),
    ...(edgeLines.length > 0 && isolatedNodeLines.length > 0 ? [""] : []),
    ...(isolatedNodeLines.length > 0 ? ["Nodes", ...isolatedNodeLines] : [])
  ];
  const preview = previewSections.join("\n");
  return {
    edgeCount: canvas.edges.length,
    nodeCount: canvas.nodes.length,
    parentId: canvas.parentId,
    preview: truncateDatabaseSafeText(preview, maximumPreviewLength),
    title: canvas.title,
    truncated: preview.length > maximumPreviewLength
  };
}

export function summarizeAiDraftActionPayload<T extends AiDraftActionType>(type: T, value: unknown) {
  try {
    return buildAiDraftActionPayloadSummary(type, value);
  } catch {
    return {
      invalid: true,
      parentId: null,
      preview: "Draft payload is invalid",
      title: "Invalid draft",
      truncated: false
    };
  }
}

function languageForTitle(title: string) {
  const extension = titleExtension(title) ?? "";
  const languages: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    kt: "kotlin",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "shell",
    sql: "sql",
    svg: "xml",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml"
  };
  return languages[extension] ?? "plaintext";
}

export function materializeAiDraftAction<T extends AiCreateDraftActionType>(type: T, payload: AiDraftActionPayloadByType[T]): MaterializedAiDraftAction {
  const parsedPayload = parseAiDraftActionPayload(type, payload);
  if (type === "create_document") {
    const document = parsedPayload as CreateDocumentDraftActionPayload;
    return {
      canvasState: null,
      content: document.content,
      language: languageForTitle(document.title),
      parentId: document.parentId,
      title: document.title,
      type: "code"
    };
  }
  if (type === "create_note") {
    const note = parsedPayload as CreateNoteDraftActionPayload;
    return {
      canvasState: null,
      content: note.content,
      language: null,
      parentId: note.parentId,
      title: note.title,
      type: "note"
    };
  }
  if (type === "create_table_note") {
    const table = parsedPayload as CreateTableNoteDraftActionPayload;
    return {
      canvasState: null,
      content: renderMarkdownTable(table.columns, table.rows),
      language: null,
      parentId: table.parentId,
      title: table.title,
      type: "note"
    };
  }
  const canvas = parsedPayload as CreateCanvasDiagramDraftActionPayload;
  const canvasState = compileCanvasDiagram(canvas);
  if (!isCanvasDocumentV1(canvasState)) {
    throw new Error("Compiled canvas diagram does not match the canonical schema");
  }
  return {
    canvasState,
    content: "",
    language: null,
    parentId: canvas.parentId,
    title: canvas.title,
    type: "canvas"
  };
}
