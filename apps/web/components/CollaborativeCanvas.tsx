"use client";

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type CanvasColor,
  type CanvasContextAction,
  type CanvasDash,
  type CanvasEditorAction,
  type CanvasFill,
  CanvasEditorShell,
  type CanvasFont,
  type CanvasInspectorAction,
  type CanvasLayerAction,
  type CanvasNumberKey,
  type CanvasPoint,
  type CanvasShape,
  type CanvasShapeType,
  type CanvasSize,
  type CanvasStats,
  type CanvasStyleKey,
  type CanvasTextAlign,
  type CanvasToolId,
  type CanvasViewport
} from "@/components/CanvasEditorShell";
import { LiveCursors, type LiveCursor, type LiveCursorUser } from "@/components/LiveCursors";
import { cornerResizeHandleOrder, getResizeHandleAtPoint, getResizeHandlePoints, resizeShape, type ResizeHandle } from "@/lib/canvas/canvasGeometry";
import { type RealtimeConnectionStatus, watchRealtimeConnection } from "@/lib/client/realtimeConnection";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

type CollaborativeCanvasProps = {
  canvasId: string;
  initialState: unknown;
  onStateChange: (state: unknown) => void;
  onPresenceChange: (users: LiveCursorUser[]) => void;
  onRealtimeStatusChange: (status: RealtimeConnectionStatus) => void;
  readOnly: boolean;
  roomName: string;
  theme: "dark" | "light";
  title: string;
  user: LiveCursorUser;
};

type CanvasDocument = {
  gridSize: number;
  shapeTombstones: Record<string, CanvasShapeMetadata>;
  shapes: CanvasShape[];
  snapToGrid: boolean;
  version: 1;
  viewport: CanvasViewport;
};

type CanvasPresencePointer = {
  canvasId: string;
  updatedAt: number;
  x: number;
  y: number;
};

type CanvasShapeMetadata = {
  clientId: string;
  revision: number;
  updatedAt: number;
};

type CanvasPresenceSelection = {
  canvasId: string;
  selectedShapeIds: string[];
  updatedAt: number;
};

type RemoteSelection = {
  bounds: SelectionBox;
  selectedShapeIds: string[];
  user: LiveCursorUser;
};

type DragState = {
  document: CanvasDocument;
  sourceId: string;
  start: CanvasPoint;
  target: CanvasPoint;
  type: "connect";
  viewport: CanvasViewport;
} | {
  document: CanvasDocument;
  ids: string[];
  origin: CanvasPoint;
  type: "move";
  viewport: CanvasViewport;
} | {
  document: CanvasDocument;
  origin: CanvasPoint;
  type: "pan";
  viewport: CanvasViewport;
} | {
  document: CanvasDocument;
  handle: ResizeHandle;
  id: string;
  origin: CanvasPoint;
  type: "resize";
  viewport: CanvasViewport;
} | {
  document: CanvasDocument;
  origin: CanvasPoint;
  type: "select";
  viewport: CanvasViewport;
};

const resizableShapeTypes = new Set<CanvasShapeType>(["ellipse", "note", "rectangle", "text"]);
const connectableShapeTypes = new Set<CanvasShapeType>(["ellipse", "note", "rectangle", "text"]);

type ConnectionHandle = "e" | "n" | "s" | "w";

type EditingTextState = {
  id: string;
  text: string;
};

type SelectionBox = {
  h: number;
  w: number;
  x: number;
  y: number;
};

type DragPreview = {
  dx: number;
  dy: number;
  ids: string[];
  snapDisabled: boolean;
  type: "move";
} | {
  shapes: Record<string, CanvasShape>;
  type: "resize";
};

type ConnectionPreview = {
  source: CanvasPoint;
  target: CanvasPoint;
};

const syncUrl = process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://127.0.0.1:1234";
const canvasWidth = 2400;
const canvasHeight = 1600;
const defaultGridSize = 24;
const connectionSnapRadiusPx = 28;
const pointerThrottleMs = 50;
const stalePresenceMs = 4000;

const colorHex: Record<CanvasColor, string> = {
  black: "#18181b",
  blue: "#2f6bff",
  green: "#2f9e44",
  grey: "#71717a",
  "light-blue": "#74c0fc",
  "light-green": "#8ce99a",
  "light-red": "#ff8787",
  "light-violet": "#d0bfff",
  orange: "#ff922b",
  red: "#fa5252",
  violet: "#7950f2",
  white: "#f8fafc",
  yellow: "#ffd43b"
};

const defaultCanvasSize = 18;
const defaultLineSize = 2;
const minCanvasSize = 8;
const maxCanvasSize = 96;
const minLineSize = 1;
const maxLineSize = 16;
const minLineLength = 8;
const legacyCanvasSizes: Record<string, CanvasSize> = {
  l: 24,
  m: 18,
  s: 14,
  xl: 32
};
const canvasTextPaddingX = 14;
const canvasTextPaddingY = 16;
const canvasTextLineHeightRatio = 1.25;

function clampCanvasSize(value: number): CanvasSize {
  return Math.max(minCanvasSize, Math.min(maxCanvasSize, Math.round(value)));
}

function clampLineSize(value: number): CanvasSize {
  return Math.max(minLineSize, Math.min(maxLineSize, Math.round(value)));
}

function normalizeCanvasSize(value: unknown): CanvasSize {
  if (typeof value === "number" && Number.isFinite(value)) return clampCanvasSize(value);
  if (typeof value === "string" && value in legacyCanvasSizes) return legacyCanvasSizes[value];
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? clampCanvasSize(parsedValue) : defaultCanvasSize;
}

function normalizeLineSize(value: unknown): CanvasSize {
  if (typeof value === "string" && value in legacyCanvasSizes) return clampLineSize(legacyCanvasSizes[value] / 8);
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return defaultLineSize;
  return parsedValue > maxLineSize ? clampLineSize(parsedValue / 8) : clampLineSize(parsedValue);
}

function normalizeShapeSize(shape: Pick<CanvasShape, "size" | "type">): CanvasSize {
  return shape.type === "arrow" || shape.type === "line" ? normalizeLineSize(shape.size) : normalizeCanvasSize(shape.size);
}

function getCanvasFontSize(shape: CanvasShape) {
  return normalizeCanvasSize(shape.size);
}

function getCanvasStrokeWidth(shape: CanvasShape) {
  if (shape.type === "arrow" || shape.type === "line") return normalizeLineSize(shape.size);
  return Math.max(1, Math.min(8, getCanvasFontSize(shape) / 8));
}

function createShapeId() {
  return `shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultDocument(): CanvasDocument {
  return {
    gridSize: defaultGridSize,
    shapeTombstones: {},
    shapes: [
      createShape("rectangle", { x: 110, y: 90 }, { name: "Rectangle 1", text: "charge()", w: 180, h: 76 }),
      createShape("rectangle", { x: 250, y: 230 }, { name: "Rectangle 2", text: "gateway.submit", w: 190, h: 82 }),
      createShape("note", { x: 430, y: 105 }, { name: "Note 1", text: "retry must reset backoff after success", w: 220, h: 120 }),
      createShape("arrow", { x: 210, y: 165 }, { name: "Arrow 1", w: 160, h: 110 })
    ],
    snapToGrid: true,
    version: 1,
    viewport: { panX: 120, panY: 80, zoom: 1 }
  };
}

function createShape(type: CanvasShapeType, point: CanvasPoint, overrides: Partial<CanvasShape> = {}): CanvasShape {
  const now = Date.now();
  const baseShape: CanvasShape = {
    clientId: "local",
    color: "blue",
    dash: "solid",
    fill: type === "text" || type === "line" || type === "arrow" ? "none" : "semi",
    font: "sans",
    h: type === "text" ? 48 : type === "line" || type === "arrow" ? 80 : 96,
    id: createShapeId(),
    isHidden: false,
    isLocked: false,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    opacity: 1,
    revision: 0,
    size: type === "line" || type === "arrow" ? defaultLineSize : defaultCanvasSize,
    text: type === "text" ? "Text" : type === "note" ? "Note" : "",
    textAlign: "left",
    type,
    updatedAt: now,
    w: type === "text" ? 180 : type === "line" || type === "arrow" ? 140 : 160,
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
  return {
    ...baseShape,
    ...overrides
  };
}

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasDocument>;
  return candidate.version === 1 && Array.isArray(candidate.shapes) && Boolean(candidate.viewport);
}

function normalizeDocument(value: unknown): CanvasDocument {
  if (isCanvasDocument(value)) {
    const normalizedShapes = value.shapes.map((shape) => ({
      ...shape,
      clientId: typeof shape.clientId === "string" && shape.clientId ? shape.clientId : "legacy",
      isHidden: Boolean(shape.isHidden),
      isLocked: Boolean(shape.isLocked),
      name: typeof shape.name === "string" && shape.name.trim() ? shape.name.trim() : shape.type.charAt(0).toUpperCase() + shape.type.slice(1),
      revision: Number.isFinite(shape.revision) ? Math.max(0, Math.round(shape.revision)) : 0,
      size: normalizeShapeSize(shape),
      updatedAt: Number.isFinite(shape.updatedAt) ? shape.updatedAt : Date.now()
    }));
    return {
      ...value,
      gridSize: Number.isFinite(value.gridSize) ? value.gridSize : defaultGridSize,
      shapeTombstones: normalizeShapeTombstones(value.shapeTombstones),
      shapes: normalizeShapeNames(normalizedShapes),
      snapToGrid: typeof value.snapToGrid === "boolean" ? value.snapToGrid : true
    };
  }
  return createDefaultDocument();
}

function normalizeShapeNames(shapes: CanvasShape[]) {
  const counts = new Map<CanvasShapeType, number>();
  return shapes.map((shape) => {
    if (shape.name.trim() && !shape.name.match(/^(Arrow|Ellipse|Line|Note|Rectangle|Text)$/)) return shape;
    const nextName = getNextShapeName(shapes.slice(0, shapes.indexOf(shape)), shape.type, counts);
    return { ...shape, name: nextName };
  });
}

function normalizeShapeTombstones(value: unknown): Record<string, CanvasShapeMetadata> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const tombstones: Record<string, CanvasShapeMetadata> = {};
  for (const [id, metadata] of Object.entries(value)) {
    if (!metadata || typeof metadata !== "object") continue;
    const candidate = metadata as Partial<CanvasShapeMetadata>;
    if (typeof candidate.clientId !== "string" || !Number.isFinite(candidate.updatedAt) || !Number.isFinite(candidate.revision)) continue;
    const revision = candidate.revision;
    const updatedAt = candidate.updatedAt;
    if (revision === undefined || updatedAt === undefined) continue;
    tombstones[id] = {
      clientId: candidate.clientId,
      revision: Math.max(0, Math.round(revision)),
      updatedAt
    };
  }
  return tombstones;
}

function getShapeTypeLabel(type: CanvasShapeType) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getNextShapeName(shapes: CanvasShape[], type: CanvasShapeType, seededCounts?: Map<CanvasShapeType, number>) {
  const label = getShapeTypeLabel(type);
  const count = seededCounts?.get(type) ?? shapes.filter((shape) => shape.type === type).length;
  seededCounts?.set(type, count + 1);
  return `${label} ${count + 1}`;
}

function sanitizeShapeName(shape: CanvasShape, name: string) {
  const trimmedName = name.trim();
  return trimmedName || shape.name || getShapeTypeLabel(shape.type);
}

function getShapeBounds(shape: CanvasShape) {
  const x = Math.min(shape.x, shape.x + shape.w);
  const y = Math.min(shape.y, shape.y + shape.h);
  return {
    h: Math.abs(shape.h),
    w: Math.abs(shape.w),
    x,
    y
  };
}

function getSelectedBounds(shapes: CanvasShape[]) {
  if (shapes.length === 0) return null;
  const bounds = shapes.map(getShapeBounds);
  const minX = Math.min(...bounds.map((shape) => shape.x));
  const minY = Math.min(...bounds.map((shape) => shape.y));
  const maxX = Math.max(...bounds.map((shape) => shape.x + shape.w));
  const maxY = Math.max(...bounds.map((shape) => shape.y + shape.h));
  return { h: maxY - minY, w: maxX - minX, x: minX, y: minY };
}

function getFill(shape: CanvasShape) {
  if (shape.fill === "none") return "transparent";
  if (shape.fill === "solid") return colorHex[shape.color];
  return `${colorHex[shape.color]}33`;
}

function getStrokeDash(shape: CanvasShape) {
  if (shape.dash === "dashed") return "10 8";
  if (shape.dash === "dotted") return "2 7";
  if (shape.dash === "long-dashed") return "18 10";
  if (shape.dash === "dash-dot") return "12 7 2 7";
  return undefined;
}

function formatSvgNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getSvgStrokeDash(shape: CanvasShape) {
  const strokeDash = getStrokeDash(shape);
  return strokeDash ? ` stroke-dasharray="${strokeDash}"` : "";
}

function getSvgCommonAttributes(shape: CanvasShape) {
  return `opacity="${formatSvgNumber(shape.opacity)}" stroke="${colorHex[shape.color]}"${getSvgStrokeDash(shape)} stroke-width="${formatSvgNumber(getCanvasStrokeWidth(shape))}"`;
}

function getSvgTextAttributes(shape: CanvasShape) {
  const bounds = getShapeBounds(shape);
  const textAnchor = shape.textAlign === "center" ? "middle" : shape.textAlign === "right" ? "end" : "start";
  const textX = shape.textAlign === "center" ? bounds.x + bounds.w / 2 : shape.textAlign === "right" ? bounds.x + bounds.w - canvasTextPaddingX : bounds.x + canvasTextPaddingX;
  const textY = bounds.y + Math.min(bounds.h - canvasTextPaddingY, getCanvasFontSize(shape) + canvasTextPaddingY);
  const fontFamily = shape.font === "mono" ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : shape.font === "serif" ? "Georgia, serif" : "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  return { fontFamily, textAnchor, textX, textY };
}

function renderShapeTextSvg(shape: CanvasShape) {
  if (!shape.text && shape.type !== "text" && shape.type !== "note") return "";
  const { fontFamily, textAnchor, textX, textY } = getSvgTextAttributes(shape);
  const lines = getWrappedCanvasTextLines(shape);
  const lineHeight = getCanvasTextLineHeight(shape);
  const fill = shape.type === "note" ? "#18181b" : colorHex[shape.color];
  const tspans = lines.map((line, index) => `<tspan x="${formatSvgNumber(textX)}" dy="${index === 0 ? "0" : formatSvgNumber(lineHeight)}">${escapeXml(line)}</tspan>`).join("");
  return `<text fill="${fill}" font-family="${escapeXml(fontFamily)}" font-size="${formatSvgNumber(getCanvasFontSize(shape))}" font-weight="650" opacity="${formatSvgNumber(shape.opacity)}" text-anchor="${textAnchor}" x="${formatSvgNumber(textX)}" y="${formatSvgNumber(textY)}">${tspans}</text>`;
}

function getCanvasTextLineHeight(shape: CanvasShape) {
  return getCanvasFontSize(shape) * canvasTextLineHeightRatio;
}

function getCanvasTextMaxLineWidth(shape: CanvasShape) {
  return Math.max(getCanvasFontSize(shape), getShapeBounds(shape).w - canvasTextPaddingX * 2);
}

function getCanvasTextMaxLineCount(shape: CanvasShape) {
  const bounds = getShapeBounds(shape);
  const availableHeight = Math.max(0, bounds.h - canvasTextPaddingY * 2);
  return Math.max(1, Math.floor(availableHeight / getCanvasTextLineHeight(shape)) + 1);
}

function getEstimatedCanvasTextWidth(value: string, shape: CanvasShape) {
  const fontSize = getCanvasFontSize(shape);
  const fontFactor = shape.font === "mono" ? 0.62 : shape.font === "serif" ? 0.56 : 0.54;
  return [...value].reduce((width, character) => {
    if (character === " ") return width + fontSize * 0.32;
    if (character === "\t") return width + fontSize * 0.96;
    if (/[A-Z0-9]/.test(character)) return width + fontSize * (fontFactor + 0.08);
    if (/[il.,'|]/.test(character)) return width + fontSize * 0.28;
    if (/[mwMW@#%&]/.test(character)) return width + fontSize * (fontFactor + 0.18);
    return width + fontSize * fontFactor;
  }, 0);
}

function splitCanvasTextToken(token: string, shape: CanvasShape, maxWidth: number) {
  const chunks: string[] = [];
  let current = "";
  for (const character of token) {
    const next = `${current}${character}`;
    if (current && getEstimatedCanvasTextWidth(next, shape) > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapCanvasTextParagraph(paragraph: string, shape: CanvasShape, maxWidth: number) {
  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const tokens = getEstimatedCanvasTextWidth(word, shape) > maxWidth ? splitCanvasTextToken(word, shape, maxWidth) : [word];
    for (const token of tokens) {
      const next = current ? `${current} ${token}` : token;
      if (current && getEstimatedCanvasTextWidth(next, shape) > maxWidth) {
        lines.push(current);
        current = token;
      } else {
        current = next;
      }
    }
  }

  if (current) lines.push(current);
  return lines;
}

function truncateCanvasTextLine(line: string, shape: CanvasShape, maxWidth: number) {
  const ellipsis = "...";
  let value = line;
  while (value.length > 0 && getEstimatedCanvasTextWidth(`${value}${ellipsis}`, shape) > maxWidth) {
    value = value.slice(0, -1);
  }
  return value ? `${value}${ellipsis}` : ellipsis;
}

function getWrappedCanvasTextLines(shape: CanvasShape) {
  const maxWidth = getCanvasTextMaxLineWidth(shape);
  const maxLineCount = getCanvasTextMaxLineCount(shape);
  const lines = shape.text.split("\n").flatMap((paragraph) => wrapCanvasTextParagraph(paragraph, shape, maxWidth));
  if (lines.length <= maxLineCount) return lines;
  const visibleLines = lines.slice(0, maxLineCount);
  visibleLines[visibleLines.length - 1] = truncateCanvasTextLine(visibleLines[visibleLines.length - 1] ?? "", shape, maxWidth);
  return visibleLines;
}

function renderArrowHeadSvg(shape: CanvasShape) {
  const end = { x: shape.x + shape.w, y: shape.y + shape.h };
  const angle = Math.atan2(shape.h, shape.w);
  const length = 14 + getCanvasStrokeWidth(shape) * 2;
  const spread = Math.PI / 7;
  const left = {
    x: end.x - Math.cos(angle - spread) * length,
    y: end.y - Math.sin(angle - spread) * length
  };
  const right = {
    x: end.x - Math.cos(angle + spread) * length,
    y: end.y - Math.sin(angle + spread) * length
  };
  return `<path d="M ${formatSvgNumber(left.x)} ${formatSvgNumber(left.y)} L ${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)} L ${formatSvgNumber(right.x)} ${formatSvgNumber(right.y)}" fill="none" stroke="${colorHex[shape.color]}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${formatSvgNumber(getCanvasStrokeWidth(shape))}" />`;
}

function renderShapeSvg(shape: CanvasShape) {
  if (shape.isHidden) return "";
  const bounds = getShapeBounds(shape);
  const commonAttributes = getSvgCommonAttributes(shape);
  const textSvg = renderShapeTextSvg(shape);
  if (shape.type === "rectangle") return `<g><rect fill="${getFill(shape)}" height="${formatSvgNumber(bounds.h)}" rx="8" ${commonAttributes} width="${formatSvgNumber(bounds.w)}" x="${formatSvgNumber(bounds.x)}" y="${formatSvgNumber(bounds.y)}" />${textSvg}</g>`;
  if (shape.type === "ellipse") return `<g><ellipse cx="${formatSvgNumber(bounds.x + bounds.w / 2)}" cy="${formatSvgNumber(bounds.y + bounds.h / 2)}" fill="${getFill(shape)}" rx="${formatSvgNumber(bounds.w / 2)}" ry="${formatSvgNumber(bounds.h / 2)}" ${commonAttributes} />${textSvg}</g>`;
  if (shape.type === "note") return `<g><rect fill="${getFill({ ...shape, fill: shape.fill === "none" ? "solid" : shape.fill })}" height="${formatSvgNumber(bounds.h)}" rx="8" ${commonAttributes} width="${formatSvgNumber(bounds.w)}" x="${formatSvgNumber(bounds.x)}" y="${formatSvgNumber(bounds.y)}" />${textSvg}</g>`;
  if (shape.type === "line") return `<line x1="${formatSvgNumber(shape.x)}" x2="${formatSvgNumber(shape.x + shape.w)}" y1="${formatSvgNumber(shape.y)}" y2="${formatSvgNumber(shape.y + shape.h)}" ${commonAttributes} />`;
  if (shape.type === "arrow") return `<g><line x1="${formatSvgNumber(shape.x)}" x2="${formatSvgNumber(shape.x + shape.w)}" y1="${formatSvgNumber(shape.y)}" y2="${formatSvgNumber(shape.y + shape.h)}" ${commonAttributes} />${renderArrowHeadSvg(shape)}</g>`;
  return `<g><rect fill="transparent" height="${formatSvgNumber(bounds.h)}" stroke="transparent" width="${formatSvgNumber(bounds.w)}" x="${formatSvgNumber(bounds.x)}" y="${formatSvgNumber(bounds.y)}" />${textSvg}</g>`;
}

function getCanvasExportBounds(shapes: CanvasShape[]) {
  const visibleShapes = shapes.filter((shape) => !shape.isHidden);
  const bounds = getSelectedBounds(visibleShapes);
  if (!bounds) return { h: canvasHeight, w: canvasWidth, x: 0, y: 0 };
  const padding = 48;
  return {
    h: Math.max(1, bounds.h + padding * 2),
    w: Math.max(1, bounds.w + padding * 2),
    x: bounds.x - padding,
    y: bounds.y - padding
  };
}

function createCanvasSvg(document: CanvasDocument, title: string) {
  const bounds = getCanvasExportBounds(document.shapes);
  const visibleShapes = document.shapes.filter((shape) => !shape.isHidden);
  const shapeMarkup = visibleShapes.map(renderShapeSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(bounds.w)}" height="${formatSvgNumber(bounds.h)}" viewBox="${formatSvgNumber(bounds.x)} ${formatSvgNumber(bounds.y)} ${formatSvgNumber(bounds.w)} ${formatSvgNumber(bounds.h)}" role="img" aria-label="${escapeXml(title)}"><rect fill="#f8fafc" height="${formatSvgNumber(bounds.h)}" width="${formatSvgNumber(bounds.w)}" x="${formatSvgNumber(bounds.x)}" y="${formatSvgNumber(bounds.y)}" />${shapeMarkup}</svg>`;
}

function createExportFileName(title: string, extension: "png" | "svg") {
  const normalizedTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "canvas";
  return `${normalizedTitle}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCanvasSvg(document: CanvasDocument, title: string) {
  const svg = createCanvasSvg(document, title);
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), createExportFileName(title, "svg"));
}

async function downloadCanvasPng(document: CanvasDocument, title: string) {
  const svg = createCanvasSvg(document, title);
  const bounds = getCanvasExportBounds(document.shapes);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  image.decoding = "async";
  const imageLoaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Canvas export image could not be loaded"));
  });
  image.src = url;
  await imageLoaded;
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(bounds.w);
  canvas.height = Math.ceil(bounds.h);
  const context = canvas.getContext("2d");
  URL.revokeObjectURL(url);
  if (!context) return;
  context.drawImage(image, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, createExportFileName(title, "png"));
  }, "image/png");
}

function getPointerPoint(event: PointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, viewport: CanvasViewport): CanvasPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
    y: (event.clientY - rect.top - viewport.panY) / viewport.zoom
  };
}

function getShapeAtPoint(shapes: CanvasShape[], point: CanvasPoint) {
  return [...shapes].reverse().find((shape) => {
    if (shape.isHidden) return false;
    const x1 = Math.min(shape.x, shape.x + shape.w);
    const y1 = Math.min(shape.y, shape.y + shape.h);
    const x2 = Math.max(shape.x, shape.x + shape.w);
    const y2 = Math.max(shape.y, shape.y + shape.h);
    return point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
  }) ?? null;
}

function isConnectableShape(shape: CanvasShape) {
  return connectableShapeTypes.has(shape.type) && !shape.isHidden;
}

function getConnectionHandlePoints(shape: CanvasShape): Record<ConnectionHandle, CanvasPoint> {
  const bounds = getShapeBounds(shape);
  return {
    e: { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
    n: { x: bounds.x + bounds.w / 2, y: bounds.y },
    s: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
    w: { x: bounds.x, y: bounds.y + bounds.h / 2 }
  };
}

function getConnectionHandleAtPoint(shape: CanvasShape, point: CanvasPoint, viewport: CanvasViewport): ConnectionHandle | null {
  const hitRadius = 9 / viewport.zoom;
  const handlePoints = getConnectionHandlePoints(shape);
  for (const handle of Object.keys(handlePoints) as ConnectionHandle[]) {
    const handlePoint = handlePoints[handle];
    if (Math.abs(point.x - handlePoint.x) <= hitRadius && Math.abs(point.y - handlePoint.y) <= hitRadius) return handle;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNearestPointOnShapeBounds(shape: CanvasShape, point: CanvasPoint) {
  const bounds = getShapeBounds(shape);
  const x1 = bounds.x;
  const x2 = bounds.x + bounds.w;
  const y1 = bounds.y;
  const y2 = bounds.y + bounds.h;
  const insideX = point.x >= x1 && point.x <= x2;
  const insideY = point.y >= y1 && point.y <= y2;

  if (insideX && insideY) {
    const distances = [
      { point: { x: x1, y: point.y }, value: point.x - x1 },
      { point: { x: x2, y: point.y }, value: x2 - point.x },
      { point: { x: point.x, y: y1 }, value: point.y - y1 },
      { point: { x: point.x, y: y2 }, value: y2 - point.y }
    ];
    return distances.reduce((nearest, item) => (item.value < nearest.value ? item : nearest)).point;
  }

  return {
    x: clampNumber(point.x, x1, x2),
    y: clampNumber(point.y, y1, y2)
  };
}

function getConnectionTargetPoint(shapes: CanvasShape[], sourceId: string, point: CanvasPoint, viewport: CanvasViewport) {
  const maxDistance = connectionSnapRadiusPx / viewport.zoom;
  let nearestTarget: { distance: number; point: CanvasPoint } | null = null;

  for (const shape of shapes) {
    if (shape.id === sourceId || !isConnectableShape(shape)) continue;
    const targetPoint = getNearestPointOnShapeBounds(shape, point);
    const distance = Math.hypot(targetPoint.x - point.x, targetPoint.y - point.y);
    if (distance > maxDistance) continue;
    if (!nearestTarget || distance < nearestTarget.distance) nearestTarget = { distance, point: targetPoint };
  }

  return nearestTarget?.point ?? null;
}

function snapValue(value: number, gridSize: number) {
  return Math.round(value / gridSize) * gridSize;
}

function snapPoint(point: CanvasPoint, document: CanvasDocument, disabled = false): CanvasPoint {
  if (disabled || !document.snapToGrid) return { x: Math.round(point.x), y: Math.round(point.y) };
  return {
    x: snapValue(point.x, document.gridSize),
    y: snapValue(point.y, document.gridSize)
  };
}

function snapNumber(value: number, document: CanvasDocument) {
  return document.snapToGrid ? snapValue(value, document.gridSize) : Math.round(value);
}

function moveSelectedShapes(shapes: CanvasShape[], selectedIds: string[], delta: CanvasPoint, document: CanvasDocument, snapDisabled = false) {
  const selectedSet = new Set(selectedIds);
  return shapes.map((shape) => {
    if (!selectedSet.has(shape.id) || shape.isLocked) return shape;
    const nextPoint = snapPoint({ x: shape.x + delta.x, y: shape.y + delta.y }, document, snapDisabled);
    return { ...shape, x: nextPoint.x, y: nextPoint.y };
  });
}

function resizeLineToLength(shape: CanvasShape, value: number) {
  const nextLength = Math.max(minLineLength, Math.round(value));
  const currentLength = Math.hypot(shape.w, shape.h);
  if (currentLength < 1) return { ...shape, w: nextLength, h: 0 };
  const scale = nextLength / currentLength;
  return {
    ...shape,
    h: Math.round(shape.h * scale),
    w: Math.round(shape.w * scale)
  };
}

function getShapesInBox(shapes: CanvasShape[], box: SelectionBox) {
  const boxX1 = Math.min(box.x, box.x + box.w);
  const boxY1 = Math.min(box.y, box.y + box.h);
  const boxX2 = Math.max(box.x, box.x + box.w);
  const boxY2 = Math.max(box.y, box.y + box.h);
  return shapes.filter((shape) => {
    if (shape.isHidden) return false;
    const bounds = getShapeBounds(shape);
    const shapeX2 = bounds.x + bounds.w;
    const shapeY2 = bounds.y + bounds.h;
    return bounds.x >= boxX1 && bounds.y >= boxY1 && shapeX2 <= boxX2 && shapeY2 <= boxY2;
  });
}

function getTextEditorStyle(shape: CanvasShape, viewport: CanvasViewport) {
  const bounds = getShapeBounds(shape);
  const fontSize = getCanvasFontSize(shape) * viewport.zoom;
  const fontFamily = shape.font === "mono" ? "var(--mono)" : shape.font === "serif" ? "Georgia, serif" : "var(--sans)";

  return {
    color: shape.type === "note" ? "#18181b" : colorHex[shape.color],
    fontFamily,
    fontSize,
    fontWeight: 650,
    height: Math.max(36, bounds.h * viewport.zoom),
    left: viewport.panX + bounds.x * viewport.zoom,
    lineHeight: `${fontSize * canvasTextLineHeightRatio}px`,
    opacity: shape.opacity,
    padding: `${canvasTextPaddingY * viewport.zoom}px ${canvasTextPaddingX * viewport.zoom}px`,
    textAlign: shape.textAlign,
    top: viewport.panY + bounds.y * viewport.zoom,
    width: Math.max(80, bounds.w * viewport.zoom)
  } satisfies CSSProperties;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isCanvasPresencePointer(value: unknown): value is CanvasPresencePointer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasPresencePointer>;
  return typeof candidate.canvasId === "string" && typeof candidate.x === "number" && Number.isFinite(candidate.x) && typeof candidate.y === "number" && Number.isFinite(candidate.y) && typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt);
}

function isCanvasPresenceSelection(value: unknown): value is CanvasPresenceSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasPresenceSelection>;
  return typeof candidate.canvasId === "string" && Array.isArray(candidate.selectedShapeIds) && candidate.selectedShapeIds.every((id) => typeof id === "string") && typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt);
}

function projectPagePointToViewport(point: CanvasPoint, viewport: CanvasViewport) {
  return {
    x: viewport.panX + point.x * viewport.zoom,
    y: viewport.panY + point.y * viewport.zoom
  };
}

function shapeMetadata(shape: CanvasShape): CanvasShapeMetadata {
  return {
    clientId: shape.clientId,
    revision: shape.revision,
    updatedAt: shape.updatedAt
  };
}

function isShapeNewer(left: CanvasShapeMetadata, right: CanvasShapeMetadata) {
  if (left.revision !== right.revision) return left.revision > right.revision;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt;
  return left.clientId > right.clientId;
}

function shapePayloadChanged(left: CanvasShape, right: CanvasShape) {
  return (
    left.color !== right.color ||
    left.dash !== right.dash ||
    left.fill !== right.fill ||
    left.font !== right.font ||
    left.h !== right.h ||
    left.isHidden !== right.isHidden ||
    left.isLocked !== right.isLocked ||
    left.name !== right.name ||
    left.opacity !== right.opacity ||
    left.size !== right.size ||
    left.text !== right.text ||
    left.textAlign !== right.textAlign ||
    left.type !== right.type ||
    left.w !== right.w ||
    left.x !== right.x ||
    left.y !== right.y
  );
}

function withChangedShapeMetadata(nextDocument: CanvasDocument, currentDocument: CanvasDocument, clientId: string) {
  const currentShapes = new Map(currentDocument.shapes.map((shape) => [shape.id, shape]));
  const now = Date.now();
  const shapes = nextDocument.shapes.map((shape) => {
    const currentShape = currentShapes.get(shape.id);
    if (currentShape && !shapePayloadChanged(shape, currentShape)) return shape;
    return {
      ...shape,
      clientId,
      revision: (currentShape?.revision ?? shape.revision ?? 0) + 1,
      updatedAt: now
    };
  });
  const nextShapeIds = new Set(shapes.map((shape) => shape.id));
  const shapeTombstones = { ...nextDocument.shapeTombstones };

  for (const currentShape of currentDocument.shapes) {
    if (nextShapeIds.has(currentShape.id)) continue;
    const currentMetadata = shapeMetadata(currentShape);
    shapeTombstones[currentShape.id] = {
      clientId,
      revision: currentMetadata.revision + 1,
      updatedAt: now
    };
  }

  return {
    ...nextDocument,
    shapeTombstones,
    shapes
  };
}

function reconcileCanvasDocuments(localDocument: CanvasDocument, remoteDocument: CanvasDocument) {
  const shapesById = new Map<string, CanvasShape>();
  const shapeTombstones = { ...localDocument.shapeTombstones };

  for (const [id, remoteTombstone] of Object.entries(remoteDocument.shapeTombstones)) {
    const localTombstone = shapeTombstones[id];
    if (!localTombstone || isShapeNewer(remoteTombstone, localTombstone)) {
      shapeTombstones[id] = remoteTombstone;
    }
  }

  for (const shape of localDocument.shapes) {
    shapesById.set(shape.id, shape);
  }

  for (const remoteShape of remoteDocument.shapes) {
    const localShape = shapesById.get(remoteShape.id);
    const tombstone = shapeTombstones[remoteShape.id];
    if (tombstone && isShapeNewer(tombstone, shapeMetadata(remoteShape))) {
      shapesById.delete(remoteShape.id);
      continue;
    }
    if (!localShape || isShapeNewer(shapeMetadata(remoteShape), shapeMetadata(localShape))) {
      shapesById.set(remoteShape.id, remoteShape);
    }
  }

  for (const [shapeId, shape] of shapesById.entries()) {
    const tombstone = shapeTombstones[shapeId];
    if (tombstone && isShapeNewer(tombstone, shapeMetadata(shape))) {
      shapesById.delete(shapeId);
    }
  }

  const order = new Map(remoteDocument.shapes.map((shape, index) => [shape.id, index]));
  const shapes = Array.from(shapesById.values()).sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.updatedAt - right.updatedAt || left.id.localeCompare(right.id);
  });

  return {
    ...remoteDocument,
    shapeTombstones,
    shapes,
    viewport: localDocument.viewport
  };
}

function documentsEqual(left: CanvasDocument, right: CanvasDocument) {
  return JSON.stringify({ ...left, viewport: undefined }) === JSON.stringify({ ...right, viewport: undefined });
}

export function CollaborativeCanvas({ canvasId, initialState, onStateChange, onPresenceChange, onRealtimeStatusChange, readOnly, roomName, title, user }: CollaborativeCanvasProps) {
  const roomKey = useMemo(() => `slate:room:${roomName}:canvas:${canvasId}`, [canvasId, roomName]);
  const [document, setDocument] = useState<CanvasDocument>(() => normalizeDocument(initialState));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeToolId, setActiveToolId] = useState<CanvasToolId>("select");
  const [cursors, setCursors] = useState<LiveCursor[]>([]);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreview | null>(null);
  const [editingText, setEditingText] = useState<EditingTextState | null>(null);
  const [history, setHistory] = useState<CanvasDocument[]>([]);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [remoteSelections, setRemoteSelections] = useState<RemoteSelection[]>([]);
  const [redoHistory, setRedoHistory] = useState<CanvasDocument[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const applyingRemoteRef = useRef(false);
  const clipboardRef = useRef<CanvasShape[]>([]);
  const dragPreviewFrameRef = useRef<number | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const documentRef = useRef(document);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const onPresenceChangeRef = useRef(onPresenceChange);
  const realtimeStatusChangeRef = useRef(onRealtimeStatusChange);
  const pointerPublishTimerRef = useRef<number | null>(null);
  const pointerStateRef = useRef<CanvasPresencePointer | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const snapshotMapRef = useRef<Y.Map<unknown> | null>(null);
  const textEditCancelledRef = useRef(false);

  const selectedShapes = document.shapes.filter((shape) => selectedIds.includes(shape.id));
  const selectedShape = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const renderedShapes = useMemo(() => {
    if (!dragPreview) return document.shapes;
    if (dragPreview.type === "resize") return document.shapes.map((shape) => dragPreview.shapes[shape.id] ?? shape);
    const movingIds = new Set(dragPreview.ids);
    return document.shapes.map((shape) => movingIds.has(shape.id) ? { ...shape, x: shape.x + dragPreview.dx, y: shape.y + dragPreview.dy } : shape);
  }, [document.shapes, dragPreview]);
  const renderedSelectedShapes = renderedShapes.filter((shape) => selectedIds.includes(shape.id));
  const renderedSelectedShape = renderedSelectedShapes.length === 1 ? renderedSelectedShapes[0] : null;
  const selectedBounds = getSelectedBounds(selectedShapes);
  const stats: CanvasStats = {
    activeToolId,
    gridSize: document.gridSize,
    selectedBoundsText: selectedBounds ? `${Math.round(selectedBounds.w)} x ${Math.round(selectedBounds.h)}` : "No selection",
    selectedCount: selectedShapes.length,
    selectedType: selectedShapes.length === 0 ? "page" : selectedShapes.length === 1 ? selectedShapes[0].type : "mixed",
    shapeCount: document.shapes.length,
    snapToGrid: document.snapToGrid,
    zoomPercent: Math.round(document.viewport.zoom * 100)
  };

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    onPresenceChangeRef.current = onPresenceChange;
  }, [onPresenceChange]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    realtimeStatusChangeRef.current = onRealtimeStatusChange;
  }, [onRealtimeStatusChange]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const states = Array.from(provider.awareness.getStates().values());
    const now = Date.now();
    setCursors(states.flatMap((state) => {
      if (!state.user?.id || state.user.canvasId !== canvasId || !isCanvasPresencePointer(state.pointer)) return [];
      if (now - state.pointer.updatedAt > stalePresenceMs) return [];
      const projectedPoint = projectPagePointToViewport(state.pointer, document.viewport);
      return [{ mode: "pixel" as const, x: projectedPoint.x, y: projectedPoint.y, user: state.user }];
    }));
  }, [canvasId, document.viewport]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    provider.awareness.setLocalStateField("selection", {
      canvasId,
      selectedShapeIds: selectedIds,
      updatedAt: Date.now()
    });
  }, [canvasId, selectedIds]);

  useEffect(() => {
    const doc = new Y.Doc();
    const snapshotMap = doc.getMap<unknown>("canvas");
    const provider = new WebsocketProvider(syncUrl, roomKey, doc, { maxBackoffTime: 2500, resyncInterval: 5000 });
    const localUser = {
      canvasId,
      color: user.color,
      id: user.id,
      initials: user.initials,
      name: user.name,
      role: user.role
    };
    snapshotMapRef.current = snapshotMap;
    providerRef.current = provider;
    const unwatchRealtimeConnection = watchRealtimeConnection(provider, (status) => realtimeStatusChangeRef.current(status));
    provider.awareness.setLocalStateField("user", localUser);
    provider.awareness.setLocalStateField("selection", {
      canvasId,
      selectedShapeIds: [],
      updatedAt: Date.now()
    });

    const publish = (nextDocument: CanvasDocument) => {
      if (applyingRemoteRef.current) return;
      snapshotMap.set("snapshot", nextDocument);
    };

    const applyRemoteSnapshot = () => {
      const snapshot = snapshotMap.get("snapshot");
      if (!isCanvasDocument(snapshot)) return;
      const normalizedSnapshot = normalizeDocument(snapshot);
      const nextDocument = reconcileCanvasDocuments(documentRef.current, normalizedSnapshot);
      if (documentsEqual(nextDocument, documentRef.current)) return;
      applyingRemoteRef.current = true;
      documentRef.current = nextDocument;
      setDocument(nextDocument);
      setSelectedIds((current) => current.filter((id) => nextDocument.shapes.some((shape) => shape.id === id)));
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    };

    const updatePresence = () => {
      const states = Array.from(provider.awareness.getStates().values());
      const now = Date.now();
      const users = states
        .filter((state) => state.user?.canvasId === canvasId)
        .map((state) => state.user)
        .filter((presenceUser): presenceUser is LiveCursorUser => {
          return Boolean(presenceUser?.id && presenceUser?.name && presenceUser?.initials && presenceUser?.color && presenceUser?.role);
        });

      onPresenceChangeRef.current(Array.from(new Map(users.map((presenceUser) => [presenceUser.id, presenceUser])).values()));
      setCursors(states.flatMap((state) => {
        if (!state.user?.id || state.user.canvasId !== canvasId || !isCanvasPresencePointer(state.pointer)) return [];
        if (now - state.pointer.updatedAt > stalePresenceMs) return [];
        const projectedPoint = projectPagePointToViewport(state.pointer, documentRef.current.viewport);
        return [{ mode: "pixel" as const, x: projectedPoint.x, y: projectedPoint.y, user: state.user }];
      }));
      setRemoteSelections(states.flatMap((state) => {
        if (!state.user?.id || state.user.id === user.id || state.user.canvasId !== canvasId || !isCanvasPresenceSelection(state.selection)) return [];
        if (now - state.selection.updatedAt > stalePresenceMs) return [];
        const selectedSet = new Set(state.selection.selectedShapeIds);
        const selectedShapes = documentRef.current.shapes.filter((shape) => selectedSet.has(shape.id) && !shape.isHidden);
        const bounds = getSelectedBounds(selectedShapes);
        if (!bounds) return [];
        return [{ bounds, selectedShapeIds: state.selection.selectedShapeIds, user: state.user }];
      }));
    };

    snapshotMap.observe(applyRemoteSnapshot);
    provider.awareness.on("change", updatePresence);
    provider.on("sync", () => {
      const snapshot = snapshotMap.get("snapshot");
      if (isCanvasDocument(snapshot)) {
        applyRemoteSnapshot();
        return;
      }
      publish(documentRef.current);
    });
    window.setTimeout(updatePresence, 0);
    const stalePresenceTimer = window.setInterval(updatePresence, 1000);

    return () => {
      clearDragPreview(false);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (pointerPublishTimerRef.current) window.clearTimeout(pointerPublishTimerRef.current);
      window.clearInterval(stalePresenceTimer);
      onStateChangeRef.current(documentRef.current);
      snapshotMap.unobserve(applyRemoteSnapshot);
      provider.awareness.off("change", updatePresence);
      unwatchRealtimeConnection();
      provider.destroy();
      doc.destroy();
      providerRef.current = null;
      snapshotMapRef.current = null;
      onPresenceChangeRef.current([]);
    };
  }, [canvasId, onRealtimeStatusChange, roomKey, user.color, user.id, user.initials, user.name, user.role]);

  function commitDocument(nextDocument: CanvasDocument, recordHistory = true) {
    const stampedDocument = withChangedShapeMetadata(nextDocument, documentRef.current, user.id);
    documentRef.current = stampedDocument;
    setDocument((currentDocument) => {
      if (recordHistory) {
        setHistory((current) => [...current.slice(-39), currentDocument]);
        setRedoHistory([]);
      }
      return stampedDocument;
    });

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      snapshotMapRef.current?.set("snapshot", documentRef.current);
      onStateChangeRef.current(documentRef.current);
    }, 350);
  }

  function applyDraftDocument(nextDocument: CanvasDocument) {
    documentRef.current = nextDocument;
    setDocument(nextDocument);
  }

  function scheduleDragPreview(preview: DragPreview) {
    dragPreviewRef.current = preview;
    if (dragPreviewFrameRef.current) return;
    dragPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      setDragPreview(dragPreviewRef.current);
    });
  }

  function clearDragPreview(updateState = true) {
    if (dragPreviewFrameRef.current) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current);
      dragPreviewFrameRef.current = null;
    }
    dragPreviewRef.current = null;
    if (updateState) setDragPreview(null);
  }

  function commitDragPreview(dragState: Extract<DragState, { type: "move" | "resize" }>, recordHistory: boolean) {
    const preview = dragPreviewRef.current;
    if (!preview) return;
    const changedShapes = dragState.type === "move" && preview.type === "move"
      ? Object.fromEntries(moveSelectedShapes(dragState.document.shapes, dragState.ids, { x: preview.dx, y: preview.dy }, dragState.document, preview.snapDisabled).filter((shape) => preview.ids.includes(shape.id)).map((shape) => [shape.id, shape]))
      : preview.type === "resize" ? preview.shapes : {};
    if (Object.keys(changedShapes).length === 0) return;
    const nextDocument = {
      ...documentRef.current,
      shapes: documentRef.current.shapes.map((shape) => changedShapes[shape.id] ?? shape)
    };
    clearDragPreview();
    commitDocument(nextDocument, recordHistory);
  }

  function updatePointerPresence(event: PointerEvent<HTMLDivElement>) {
    const provider = providerRef.current;
    if (!provider) return;
    const point = getPointerPoint(event, documentRef.current.viewport);
    pointerStateRef.current = {
      canvasId,
      updatedAt: Math.round(performance.timeOrigin + event.timeStamp),
      x: point.x,
      y: point.y
    };

    if (pointerPublishTimerRef.current) return;
    pointerPublishTimerRef.current = window.setTimeout(() => {
      pointerPublishTimerRef.current = null;
      const pointer = pointerStateRef.current;
      if (pointer) provider.awareness.setLocalStateField("pointer", pointer);
    }, pointerThrottleMs);
  }

  function selectTool(toolId: CanvasToolId) {
    setActiveToolId(toolId);
  }

  function addShape(type: CanvasShapeType, point: CanvasPoint, snapDisabled = false) {
    if (readOnly) return;
    const nextShape = createShape(type, snapPoint(point, document, snapDisabled), { name: getNextShapeName(document.shapes, type) });
    commitDocument({ ...document, shapes: [...document.shapes, nextShape] });
    setSelectedIds([nextShape.id]);
    setActiveToolId("select");
  }

  function copySelectedShapes() {
    const selectedSet = new Set(selectedIds);
    clipboardRef.current = document.shapes.filter((shape) => selectedSet.has(shape.id));
  }

  function pasteShapes() {
    if (readOnly || clipboardRef.current.length === 0) return;
    const pastedShapes = clipboardRef.current.map((shape) => ({
      ...shape,
      id: createShapeId(),
      name: `${shape.name} copy`,
      x: snapNumber(shape.x + 24, document),
      y: snapNumber(shape.y + 24, document)
    }));
    commitDocument({ ...document, shapes: [...document.shapes, ...pastedShapes] });
    clipboardRef.current = pastedShapes;
    setSelectedIds(pastedShapes.map((shape) => shape.id));
  }

  function cutSelectedShapes() {
    if (readOnly || selectedIds.length === 0) return;
    copySelectedShapes();
    const selectedSet = new Set(selectedIds);
    commitDocument({ ...document, shapes: document.shapes.filter((shape) => !selectedSet.has(shape.id) || shape.isLocked) });
    setSelectedIds((current) => current.filter((id) => document.shapes.some((shape) => shape.id === id && shape.isLocked)));
  }

  function startTextEditing(shape: CanvasShape) {
    if (readOnly || shape.isLocked || shape.type === "arrow" || shape.type === "line") return;
    textEditCancelledRef.current = false;
    setEditingText({ id: shape.id, text: shape.text });
  }

  function finishTextEditing(commit: boolean) {
    if (!editingText) return;
    if (!commit) {
      textEditCancelledRef.current = true;
      setEditingText(null);
      return;
    }
    if (textEditCancelledRef.current) {
      textEditCancelledRef.current = false;
      setEditingText(null);
      return;
    }
    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => {
        if (shape.id !== editingText.id || shape.isLocked) return shape;
        return { ...shape, text: editingText.text };
      })
    });
    setEditingText(null);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isEditableTarget(event.target)) return;
    clearDragPreview();
    updatePointerPresence(event);
    const point = getPointerPoint(event, document.viewport);

    if (readOnly) {
      return;
    }

    if (activeToolId !== "select" && activeToolId !== "hand") {
      const type = activeToolId === "rectangle" ? "rectangle" : activeToolId === "ellipse" ? "ellipse" : activeToolId === "line" ? "line" : activeToolId === "arrow" ? "arrow" : activeToolId === "note" ? "note" : "text";
      addShape(type, point, event.altKey);
      return;
    }

    if (activeToolId === "select" && selectedShape && !selectedShape.isLocked && isConnectableShape(selectedShape)) {
      const connectionHandle = getConnectionHandleAtPoint(selectedShape, point, document.viewport);
      if (connectionHandle) {
        const start = getConnectionHandlePoints(selectedShape)[connectionHandle];
        dragStateRef.current = { document, sourceId: selectedShape.id, start, target: point, type: "connect", viewport: document.viewport };
        setConnectionPreview({ source: start, target: point });
        return;
      }
    }

    if (activeToolId === "select" && selectedShape && !selectedShape.isLocked && resizableShapeTypes.has(selectedShape.type)) {
      const handle = getResizeHandleAtPoint(selectedShape, point, document.viewport, cornerResizeHandleOrder);
      if (handle) {
        dragStateRef.current = { document, handle, id: selectedShape.id, origin: point, type: "resize", viewport: document.viewport };
        return;
      }
    }

    const targetShape = getShapeAtPoint(document.shapes, point);
    if (!targetShape) {
      setSelectedIds([]);
      setEditingText(null);
      dragStateRef.current = activeToolId === "hand"
        ? { document, origin: { x: event.clientX, y: event.clientY }, type: "pan", viewport: document.viewport }
        : { document, origin: point, type: "select", viewport: document.viewport };
      return;
    }

    if (event.detail >= 2) {
      setSelectedIds([targetShape.id]);
      startTextEditing(targetShape);
      dragStateRef.current = null;
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelectedIds = additive
      ? selectedIds.includes(targetShape.id)
        ? selectedIds.filter((id) => id !== targetShape.id)
        : [...selectedIds, targetShape.id]
      : selectedIds.includes(targetShape.id)
        ? selectedIds
        : [targetShape.id];
    setSelectedIds(nextSelectedIds);
    dragStateRef.current = { document, ids: nextSelectedIds, origin: point, type: "move", viewport: document.viewport };
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || isEditableTarget(event.target) || readOnly) return;
    const point = getPointerPoint(event, document.viewport);
    const targetShape = getShapeAtPoint(document.shapes, point);
    if (!targetShape) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragPreview();
    dragStateRef.current = null;
    setSelectedIds([targetShape.id]);
    startTextEditing(targetShape);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    updatePointerPresence(event);
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const point = getPointerPoint(event, dragState.viewport);

    if (dragState.type === "pan") {
      const nextViewport = {
        ...dragState.viewport,
        panX: dragState.viewport.panX + event.clientX - dragState.origin.x,
        panY: dragState.viewport.panY + event.clientY - dragState.origin.y
      };
      applyDraftDocument({ ...dragState.document, viewport: nextViewport });
      return;
    }

    if (dragState.type === "connect") {
      const target = getConnectionTargetPoint(documentRef.current.shapes, dragState.sourceId, point, dragState.viewport) ?? point;
      setConnectionPreview({ source: dragState.start, target });
      dragStateRef.current = { ...dragState, target };
      return;
    }

    if (dragState.type === "select") {
      const nextBox = {
        h: point.y - dragState.origin.y,
        w: point.x - dragState.origin.x,
        x: dragState.origin.x,
        y: dragState.origin.y
      };
      setSelectionBox(nextBox);
      setSelectedIds(getShapesInBox(document.shapes, nextBox).map((shape) => shape.id));
      return;
    }

    if (dragState.type === "resize") {
      const delta = { x: point.x - dragState.origin.x, y: point.y - dragState.origin.y };
      const resizedShape = dragState.document.shapes.find((shape) => shape.id === dragState.id);
      if (resizedShape) scheduleDragPreview({ shapes: { [dragState.id]: resizeShape(resizedShape, dragState.handle, delta) }, type: "resize" });
      return;
    }

    const delta = { x: point.x - dragState.origin.x, y: point.y - dragState.origin.y };
    scheduleDragPreview({ dx: delta.x, dy: delta.y, ids: dragState.ids, snapDisabled: event.altKey, type: "move" });
  }

  function handlePointerUp() {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    dragStateRef.current = null;
    setSelectionBox(null);
    if (dragState.type === "connect") {
      setConnectionPreview(null);
      if (Math.hypot(dragState.target.x - dragState.start.x, dragState.target.y - dragState.start.y) < minLineLength) return;
      const arrowShape = createShape("arrow", dragState.start, {
        color: "blue",
        dash: "solid",
        h: Math.round(dragState.target.y - dragState.start.y),
        name: getNextShapeName(documentRef.current.shapes, "arrow"),
        size: defaultLineSize,
        w: Math.round(dragState.target.x - dragState.start.x)
      });
      commitDocument({ ...documentRef.current, shapes: [...documentRef.current.shapes, arrowShape] });
      setSelectedIds([arrowShape.id]);
      return;
    }
    if (dragState.type === "select") return;
    if (dragState.type === "move" || dragState.type === "resize") {
      commitDragPreview(dragState, true);
      return;
    }
    if (documentRef.current !== dragState.document) commitDocument(documentRef.current, dragState.type !== "pan");
  }

  function runEditorAction(action: CanvasEditorAction) {
    if (action === "undo" && history.length > 0) {
      const previous = history[history.length - 1];
      setRedoHistory((current) => [document, ...current.slice(0, 39)]);
      setHistory((current) => current.slice(0, -1));
      commitDocument(previous, false);
    }

    if (action === "redo" && redoHistory.length > 0) {
      const next = redoHistory[0];
      setHistory((current) => [...current.slice(-39), document]);
      setRedoHistory((current) => current.slice(1));
      commitDocument(next, false);
    }

    if (action === "zoomIn") commitDocument({ ...document, viewport: { ...document.viewport, zoom: Math.min(2.5, document.viewport.zoom + 0.1) } }, false);
    if (action === "zoomOut") commitDocument({ ...document, viewport: { ...document.viewport, zoom: Math.max(0.3, document.viewport.zoom - 0.1) } }, false);
    if (action === "zoomReset") commitDocument({ ...document, viewport: { ...document.viewport, panX: 120, panY: 80, zoom: 1 } }, false);
    if (action === "fit") commitDocument({ ...document, viewport: { panX: 120, panY: 80, zoom: 1 } }, false);
    if (action === "exportSvg") downloadCanvasSvg(document, title);
    if (action === "exportPng") void downloadCanvasPng(document, title);
  }

  function runContextAction(action: CanvasContextAction, point: CanvasPoint | null) {
    if (action === "resetZoom") runEditorAction("zoomReset");
    if (action === "selectAll") setSelectedIds(document.shapes.filter((shape) => !shape.isHidden).map((shape) => shape.id));
    if (!point && (action === "addRectangle" || action === "addText")) return;
    if (action === "addRectangle" && point) addShape("rectangle", point);
    if (action === "addText" && point) addShape("text", point);
    if (action === "bringForward") runInspectorAction("bringForward");
    if (action === "delete") runInspectorAction("delete");
    if (action === "duplicate") runInspectorAction("duplicate");
    if (action === "sendBackward") runInspectorAction("sendBackward");
  }

  function runInspectorAction(action: CanvasInspectorAction) {
    if (readOnly || selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);

    if (action === "delete") {
      commitDocument({ ...document, shapes: document.shapes.filter((shape) => !selectedSet.has(shape.id) || shape.isLocked) });
      setSelectedIds(document.shapes.filter((shape) => selectedSet.has(shape.id) && shape.isLocked).map((shape) => shape.id));
      return;
    }

    if (action === "duplicate") {
      const duplicates = document.shapes.filter((shape) => selectedSet.has(shape.id)).map((shape) => ({ ...shape, id: createShapeId(), name: `${shape.name} copy`, x: snapNumber(shape.x + 24, document), y: snapNumber(shape.y + 24, document) }));
      commitDocument({ ...document, shapes: [...document.shapes, ...duplicates] });
      setSelectedIds(duplicates.map((shape) => shape.id));
      return;
    }

    if (action === "bringForward") {
      commitDocument({ ...document, shapes: [...document.shapes.filter((shape) => !selectedSet.has(shape.id)), ...document.shapes.filter((shape) => selectedSet.has(shape.id))] });
      return;
    }

    if (action === "sendBackward") {
      commitDocument({ ...document, shapes: [...document.shapes.filter((shape) => selectedSet.has(shape.id)), ...document.shapes.filter((shape) => !selectedSet.has(shape.id))] });
      return;
    }

    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => {
        if (!selectedSet.has(shape.id)) return shape;
        if (action === "lock") return { ...shape, isLocked: true };
        if (action === "unlock") return { ...shape, isLocked: false };
        return { ...shape, color: "blue", dash: "solid", fill: shape.type === "text" || shape.type === "line" || shape.type === "arrow" ? "none" : "semi", font: "sans", opacity: 1, size: shape.type === "line" || shape.type === "arrow" ? defaultLineSize : defaultCanvasSize, textAlign: "left" };
      })
    });
  }

  function updateShapeNumber(shapeId: string, key: CanvasNumberKey, value: number) {
    if (readOnly || !Number.isFinite(value)) return;
    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => {
        if (shape.id !== shapeId || shape.isLocked) return shape;
        if (key === "length" && (shape.type === "line" || shape.type === "arrow")) return resizeLineToLength(shape, value);
        if (key === "length") return shape;
        const nextValue = key === "w" || key === "h" ? Math.max(8, Math.round(value)) : snapNumber(value, document);
        return { ...shape, [key]: nextValue };
      })
    });
  }

  function updateStyle(key: CanvasStyleKey, value: string) {
    if (readOnly) return;
    const selectedSet = new Set(selectedIds);
    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => {
        if (!selectedSet.has(shape.id) || shape.isLocked) return shape;
        if (key === "opacity") return { ...shape, opacity: Math.max(0, Math.min(100, Number(value))) / 100 };
        if (key === "color") return { ...shape, color: value as CanvasColor };
        if (key === "dash") return { ...shape, dash: value as CanvasDash };
        if (key === "fill") return { ...shape, fill: value as CanvasFill };
        if (key === "font") return { ...shape, font: value as CanvasFont };
        if (key === "size") return { ...shape, size: shape.type === "line" || shape.type === "arrow" ? normalizeLineSize(value) : normalizeCanvasSize(value) };
        return { ...shape, textAlign: value as CanvasTextAlign };
      })
    });
  }

  function runLayerAction(shapeId: string, action: CanvasLayerAction) {
    if (readOnly) return;
    const targetShape = document.shapes.find((shape) => shape.id === shapeId);
    if (!targetShape) return;
    const targetSet = new Set([shapeId]);

    if (action === "bringForward") {
      commitDocument({ ...document, shapes: [...document.shapes.filter((shape) => !targetSet.has(shape.id)), targetShape] });
      return;
    }

    if (action === "sendBackward") {
      commitDocument({ ...document, shapes: [targetShape, ...document.shapes.filter((shape) => !targetSet.has(shape.id))] });
      return;
    }

    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => {
        if (shape.id !== shapeId) return shape;
        if (action === "hide") return { ...shape, isHidden: true };
        if (action === "show") return { ...shape, isHidden: false };
        if (action === "lock") return { ...shape, isLocked: true };
        return { ...shape, isLocked: false };
      })
    });
    if (action === "hide") setSelectedIds((current) => current.filter((id) => id !== shapeId));
  }

  function renameLayer(shapeId: string, name: string) {
    if (readOnly) return;
    commitDocument({
      ...document,
      shapes: document.shapes.map((shape) => shape.id === shapeId ? { ...shape, name: sanitizeShapeName(shape, name) } : shape)
    });
  }

  function toggleSnap() {
    if (readOnly) return;
    commitDocument({ ...document, snapToGrid: !document.snapToGrid }, false);
  }

  function selectShape(shapeId: string, additive = false) {
    setSelectedIds((current) => {
      if (!additive) return [shapeId];
      return current.includes(shapeId) ? current.filter((id) => id !== shapeId) : [...current, shapeId];
    });
  }

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const commandKey = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        if (editingText) {
          event.preventDefault();
          finishTextEditing(false);
          return;
        }
        setSelectedIds([]);
        setSelectionBox(null);
      }

      if (readOnly) return;

      if ((event.key === "Backspace" || event.key === "Delete") && selectedIds.length > 0) {
        event.preventDefault();
        runInspectorAction("delete");
      }

      if (commandKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(document.shapes.filter((shape) => !shape.isHidden).map((shape) => shape.id));
      }

      if (commandKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedShapes();
      }

      if (commandKey && event.key.toLowerCase() === "x") {
        event.preventDefault();
        cutSelectedShapes();
      }

      if (commandKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteShapes();
      }

      if (commandKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        runInspectorAction("duplicate");
      }

      if (commandKey && event.key === "]" && selectedIds.length > 0) {
        event.preventDefault();
        runInspectorAction("bringForward");
      }

      if (commandKey && event.key === "[" && selectedIds.length > 0) {
        event.preventDefault();
        runInspectorAction("sendBackward");
      }

      if (commandKey && event.key.toLowerCase() === "l" && selectedIds.length > 0) {
        event.preventDefault();
        runInspectorAction(selectedShapes.every((shape) => shape.isLocked) ? "unlock" : "lock");
      }

      if (commandKey && event.shiftKey && event.key.toLowerCase() === "r" && selectedIds.length > 0) {
        event.preventDefault();
        runInspectorAction("resetStyle");
      }

      if (commandKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        runEditorAction(event.shiftKey ? "redo" : "undo");
      }

      if (commandKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        runEditorAction("redo");
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  useEffect(() => {
    function handleCanvasCommand(event: Event) {
      const detail = (event as CustomEvent<{ canvasId?: string; command?: string }>).detail;
      if (detail?.canvasId !== canvasId) return;
      if (detail.command === "toggleSnap") toggleSnap();
    }

    window.addEventListener("slate:canvas-command", handleCanvasCommand);
    return () => window.removeEventListener("slate:canvas-command", handleCanvasCommand);
  });

  const movePreview = dragPreview?.type === "move" ? dragPreview : null;
  const movePreviewIds = new Set(movePreview?.ids ?? []);
  const editingShape = editingText ? renderedShapes.find((shape) => shape.id === editingText.id) ?? document.shapes.find((shape) => shape.id === editingText.id) ?? null : null;

  return (
    <CanvasEditorShell activeToolId={activeToolId} onContextAction={runContextAction} onEditorAction={runEditorAction} onLayerAction={runLayerAction} onLayerRename={renameLayer} onNumberChange={updateShapeNumber} onSelectShape={selectShape} onSelectTool={selectTool} onSnapToggle={toggleSnap} onStyleChange={updateStyle} readOnly={readOnly} selectedShape={renderedSelectedShape} selectedShapes={renderedSelectedShapes} shapes={renderedShapes} stats={stats} viewport={document.viewport}>
      <div className="real-canvas-host realtime-document-host" onDoubleClick={handleDoubleClick} onPointerDown={handlePointerDown} onPointerLeave={handlePointerUp} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} ref={hostRef}>
        <svg className="native-canvas">
          <g transform={`translate(${document.viewport.panX} ${document.viewport.panY}) scale(${document.viewport.zoom})`}>
            <rect className="native-canvas-page" height={canvasHeight} width={canvasWidth} x="0" y="0" />
            {renderedShapes.filter((shape) => !shape.isHidden && !movePreviewIds.has(shape.id)).map((shape) => (
              <CanvasShapeNode editingShapeId={editingText?.id ?? null} key={shape.id} selected={selectedIds.includes(shape.id)} shape={shape} />
            ))}
            {movePreview && (
              <g className="native-canvas-drag-preview" transform={`translate(${movePreview.dx} ${movePreview.dy})`}>
                {document.shapes.filter((shape) => !shape.isHidden && movePreviewIds.has(shape.id)).map((shape) => (
                  <CanvasShapeNode editingShapeId={editingText?.id ?? null} key={shape.id} selected={selectedIds.includes(shape.id)} shape={shape} />
                ))}
              </g>
            )}
            {remoteSelections.map((selection) => (
              <RemoteSelectionNode key={selection.user.id} selection={selection} />
            ))}
            {selectionBox && <rect className="native-canvas-box-selection" fill="rgba(82, 169, 255, 0.1)" height={selectionBox.h} stroke="#52a9ff" width={selectionBox.w} x={selectionBox.x} y={selectionBox.y} />}
            {connectionPreview && <CanvasConnectionPreview preview={connectionPreview} />}
            {!editingText && !readOnly && activeToolId === "select" && renderedSelectedShape && !renderedSelectedShape.isLocked && isConnectableShape(renderedSelectedShape) && (
              <CanvasConnectionHandles shape={renderedSelectedShape} zoom={document.viewport.zoom} />
            )}
            {!editingText && !readOnly && activeToolId === "select" && renderedSelectedShape && !renderedSelectedShape.isLocked && resizableShapeTypes.has(renderedSelectedShape.type) && (
              <CanvasResizeHandles shape={renderedSelectedShape} zoom={document.viewport.zoom} />
            )}
          </g>
        </svg>
        {editingText && editingShape && (
          <textarea
            autoFocus
            className="native-canvas-text-editor"
            onBlur={() => finishTextEditing(true)}
            onChange={(event) => setEditingText({ id: editingText.id, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finishTextEditing(false);
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                finishTextEditing(true);
              }
            }}
            style={getTextEditorStyle(editingShape, document.viewport)}
            value={editingText.text}
          />
        )}
        <LiveCursors cursors={cursors} localUserId={user.id} />
      </div>
    </CanvasEditorShell>
  );
}

function RemoteSelectionNode({ selection }: { selection: RemoteSelection }) {
  return (
    <g className="native-canvas-remote-selection" pointerEvents="none">
      <rect fill="transparent" height={selection.bounds.h} stroke={selection.user.color} strokeDasharray="7 5" width={selection.bounds.w} x={selection.bounds.x} y={selection.bounds.y} />
      <foreignObject height="28" width="160" x={selection.bounds.x} y={selection.bounds.y - 30}>
        <div className="native-canvas-remote-selection-label" style={{ background: selection.user.color }}>
          {selection.user.name}
        </div>
      </foreignObject>
    </g>
  );
}

function CanvasShapeNode({ editingShapeId, selected, shape }: { editingShapeId: string | null; selected: boolean; shape: CanvasShape }) {
  if (shape.isHidden) return null;
  const stroke = colorHex[shape.color];
  const strokeWidth = getCanvasStrokeWidth(shape);
  const commonProps = {
    opacity: shape.opacity,
    stroke,
    strokeDasharray: getStrokeDash(shape),
    strokeWidth
  };
  const bounds = getShapeBounds(shape);
  const textAnchor = shape.textAlign === "center" ? "middle" : shape.textAlign === "right" ? "end" : "start";
  const textX = shape.textAlign === "center" ? bounds.x + bounds.w / 2 : shape.textAlign === "right" ? bounds.x + bounds.w - canvasTextPaddingX : bounds.x + canvasTextPaddingX;
  const textY = bounds.y + Math.min(bounds.h - canvasTextPaddingY, getCanvasFontSize(shape) + canvasTextPaddingY);
  const textLines = getWrappedCanvasTextLines(shape);

  return (
    <g className={selected ? "native-canvas-shape selected" : "native-canvas-shape"}>
      {shape.type === "rectangle" && <rect fill={getFill(shape)} height={shape.h} rx="8" {...commonProps} width={shape.w} x={shape.x} y={shape.y} />}
      {shape.type === "ellipse" && <ellipse cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2} fill={getFill(shape)} rx={Math.abs(shape.w / 2)} ry={Math.abs(shape.h / 2)} {...commonProps} />}
      {shape.type === "note" && <rect fill={getFill({ ...shape, fill: shape.fill === "none" ? "solid" : shape.fill })} height={shape.h} rx="8" {...commonProps} width={shape.w} x={shape.x} y={shape.y} />}
      {(shape.type === "line" || shape.type === "arrow") && <line x1={shape.x} x2={shape.x + shape.w} y1={shape.y} y2={shape.y + shape.h} {...commonProps} />}
      {shape.type === "arrow" && <ArrowHead shape={shape} />}
      {shape.type === "text" && <rect fill="transparent" height={shape.h} stroke="transparent" width={shape.w} x={shape.x} y={shape.y} />}
      {editingShapeId !== shape.id && (shape.text || shape.type === "text" || shape.type === "note") && (
        <text fill={shape.type === "note" ? "#18181b" : stroke} fontFamily={shape.font === "mono" ? "var(--mono)" : shape.font === "serif" ? "Georgia, serif" : "var(--sans)"} fontSize={getCanvasFontSize(shape)} fontWeight="650" opacity={shape.opacity} textAnchor={textAnchor} x={textX} y={textY}>
          {textLines.map((line, index) => (
            <tspan dy={index === 0 ? 0 : getCanvasTextLineHeight(shape)} key={`${shape.id}-${index}`} x={textX}>{line}</tspan>
          ))}
        </text>
      )}
      {selected && <rect className="native-canvas-selection" fill="transparent" height={Math.max(1, shape.h)} width={Math.max(1, shape.w)} x={Math.min(shape.x, shape.x + shape.w)} y={Math.min(shape.y, shape.y + shape.h)} />}
    </g>
  );
}

function ArrowHead({ shape }: { shape: CanvasShape }) {
  const end = { x: shape.x + shape.w, y: shape.y + shape.h };
  const angle = Math.atan2(shape.h, shape.w);
  const length = 14 + getCanvasStrokeWidth(shape) * 2;
  const spread = Math.PI / 7;
  const left = {
    x: end.x - Math.cos(angle - spread) * length,
    y: end.y - Math.sin(angle - spread) * length
  };
  const right = {
    x: end.x - Math.cos(angle + spread) * length,
    y: end.y - Math.sin(angle + spread) * length
  };
  return <path d={`M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`} fill="none" stroke={colorHex[shape.color]} strokeLinecap="round" strokeLinejoin="round" strokeWidth={getCanvasStrokeWidth(shape)} />;
}

function CanvasConnectionPreview({ preview }: { preview: ConnectionPreview }) {
  const shape = {
    clientId: "preview",
    color: "blue",
    dash: "dashed",
    fill: "none",
    font: "sans",
    h: preview.target.y - preview.source.y,
    id: "connection-preview",
    isHidden: false,
    isLocked: false,
    name: "Connection preview",
    opacity: 1,
    revision: 0,
    size: defaultLineSize,
    text: "",
    textAlign: "left",
    type: "arrow",
    updatedAt: 0,
    w: preview.target.x - preview.source.x,
    x: preview.source.x,
    y: preview.source.y
  } satisfies CanvasShape;
  return (
    <g className="native-canvas-connection-preview" pointerEvents="none">
      <line x1={shape.x} x2={shape.x + shape.w} y1={shape.y} y2={shape.y + shape.h} />
      <ArrowHead shape={shape} />
    </g>
  );
}

function CanvasConnectionHandles({ shape, zoom }: { shape: CanvasShape; zoom: number }) {
  const handlePoints = getConnectionHandlePoints(shape);
  const size = 9 / zoom;
  return (
    <g className="native-canvas-connection-handles">
      {(Object.keys(handlePoints) as ConnectionHandle[]).map((handle) => {
        const point = handlePoints[handle];
        return <circle className={`native-canvas-connection-handle native-canvas-connection-handle-${handle}`} cx={point.x} cy={point.y} key={handle} r={size / 2} />;
      })}
    </g>
  );
}

function CanvasResizeHandles({ shape, zoom }: { shape: CanvasShape; zoom: number }) {
  const handlePoints = getResizeHandlePoints(shape);
  const size = 8 / zoom;
  return (
    <>
      {cornerResizeHandleOrder.map((handle) => {
        const point = handlePoints[handle];
        return (
          <rect
            className={`native-canvas-resize-handle native-canvas-resize-handle-${handle}`}
            height={size}
            key={handle}
            width={size}
            x={point.x - size / 2}
            y={point.y - size / 2}
          />
        );
      })}
    </>
  );
}
