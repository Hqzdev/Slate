import type { CanvasColor, CanvasDash, CanvasFill, CanvasFont, CanvasShape, CanvasShapeType, CanvasSize, CanvasTextAlign, CanvasViewport } from "@/components/CanvasEditorShell";

export type CanvasDocumentV1 = {
  gridSize: number;
  shapeTombstones: Record<string, {
    clientId: string;
    revision: number;
    updatedAt: number;
  }>;
  shapes: CanvasShape[];
  snapToGrid: boolean;
  version: 1;
  viewport: CanvasViewport;
};

export type AnyCanvasDocument = CanvasDocumentV1;

export const CURRENT_CANVAS_VERSION = 1;
const defaultGridSize = 24;

const canvasShapeTypes = new Set<CanvasShapeType>(["arrow", "ellipse", "line", "note", "rectangle", "text"]);
const canvasColors = new Set<CanvasColor>(["black", "blue", "green", "grey", "light-blue", "light-green", "light-red", "light-violet", "orange", "red", "violet", "white", "yellow"]);
const canvasDashes = new Set<CanvasDash>(["dash-dot", "dashed", "dotted", "long-dashed", "solid"]);
const canvasFills = new Set<CanvasFill>(["none", "semi", "solid"]);
const canvasFonts = new Set<CanvasFont>(["mono", "sans", "serif"]);
const canvasTextAligns = new Set<CanvasTextAlign>(["center", "left", "right"]);
const defaultCanvasSize = 18;
const defaultLineSize = 2;
const minCanvasSize = 8;
const maxCanvasSize = 96;
const minLineSize = 1;
const maxLineSize = 16;
const legacyCanvasSizes: Record<string, CanvasSize> = {
  l: 24,
  m: 18,
  s: 14,
  xl: 32
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampCanvasSize(value: number): CanvasSize {
  return Math.max(minCanvasSize, Math.min(maxCanvasSize, Math.round(value)));
}

function clampLineSize(value: number): CanvasSize {
  return Math.max(minLineSize, Math.min(maxLineSize, Math.round(value)));
}

function normalizeCanvasSize(value: unknown): CanvasSize | null {
  if (isFiniteNumber(value)) return clampCanvasSize(value);
  if (typeof value !== "string") return null;
  if (value in legacyCanvasSizes) return legacyCanvasSizes[value];
  const parsedValue = Number(value);
  return isFiniteNumber(parsedValue) ? clampCanvasSize(parsedValue) : null;
}

function normalizeShapeSize(type: CanvasShapeType, value: unknown): CanvasSize | null {
  if (type !== "arrow" && type !== "line") return normalizeCanvasSize(value);
  if (typeof value === "string" && value in legacyCanvasSizes) return clampLineSize(legacyCanvasSizes[value] / 8);
  if (!isFiniteNumber(value)) {
    if (typeof value !== "string") return null;
    const parsedValue = Number(value);
    if (!isFiniteNumber(parsedValue)) return null;
    return clampLineSize(parsedValue);
  }
  return value > maxLineSize ? clampLineSize(value / 8) : clampLineSize(value);
}

function normalizeShapeMetadata(candidate: Partial<CanvasShape>) {
  return {
    clientId: typeof candidate.clientId === "string" && candidate.clientId ? candidate.clientId : "legacy",
    revision: isFiniteNumber(candidate.revision) ? Math.max(0, Math.round(candidate.revision)) : 0,
    updatedAt: isFiniteNumber(candidate.updatedAt) ? candidate.updatedAt : Date.now()
  };
}

export function isCanvasShape(value: unknown): value is CanvasShape {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasShape>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.clientId === "string" &&
    typeof candidate.type === "string" &&
    canvasShapeTypes.has(candidate.type as CanvasShapeType) &&
    typeof candidate.color === "string" &&
    canvasColors.has(candidate.color as CanvasColor) &&
    typeof candidate.dash === "string" &&
    canvasDashes.has(candidate.dash as CanvasDash) &&
    typeof candidate.fill === "string" &&
    canvasFills.has(candidate.fill as CanvasFill) &&
    typeof candidate.font === "string" &&
    canvasFonts.has(candidate.font as CanvasFont) &&
    isFiniteNumber(candidate.size) &&
    normalizeShapeSize(candidate.type as CanvasShapeType, candidate.size) === candidate.size &&
    typeof candidate.textAlign === "string" &&
    canvasTextAligns.has(candidate.textAlign as CanvasTextAlign) &&
    typeof candidate.text === "string" &&
    typeof candidate.isHidden === "boolean" &&
    typeof candidate.isLocked === "boolean" &&
    typeof candidate.name === "string" &&
    isFiniteNumber(candidate.opacity) &&
    isFiniteNumber(candidate.revision) &&
    isFiniteNumber(candidate.updatedAt) &&
    isFiniteNumber(candidate.h) &&
    isFiniteNumber(candidate.w) &&
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y)
  );
}

function migrateCanvasShape(value: unknown): CanvasShape | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CanvasShape>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.type !== "string" ||
    !canvasShapeTypes.has(candidate.type as CanvasShapeType) ||
    typeof candidate.color !== "string" ||
    !canvasColors.has(candidate.color as CanvasColor) ||
    typeof candidate.dash !== "string" ||
    !canvasDashes.has(candidate.dash as CanvasDash) ||
    typeof candidate.fill !== "string" ||
    !canvasFills.has(candidate.fill as CanvasFill) ||
    typeof candidate.font !== "string" ||
    !canvasFonts.has(candidate.font as CanvasFont) ||
    normalizeShapeSize(candidate.type as CanvasShapeType, candidate.size) === null ||
    typeof candidate.textAlign !== "string" ||
    !canvasTextAligns.has(candidate.textAlign as CanvasTextAlign) ||
    typeof candidate.text !== "string" ||
    typeof candidate.isLocked !== "boolean" ||
    !isFiniteNumber(candidate.opacity) ||
    !isFiniteNumber(candidate.h) ||
    !isFiniteNumber(candidate.w) ||
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y)
  ) {
    return null;
  }
  const size = normalizeShapeSize(candidate.type as CanvasShapeType, candidate.size);
  if (size === null) return null;
  return {
    ...normalizeShapeMetadata(candidate),
    color: candidate.color as CanvasColor,
    dash: candidate.dash as CanvasDash,
    fill: candidate.fill as CanvasFill,
    font: candidate.font as CanvasFont,
    h: candidate.h,
    id: candidate.id,
    isHidden: Boolean(candidate.isHidden),
    isLocked: candidate.isLocked,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : getShapeTypeLabel(candidate.type as CanvasShapeType),
    opacity: candidate.opacity,
    size,
    text: candidate.text,
    textAlign: candidate.textAlign as CanvasTextAlign,
    type: candidate.type as CanvasShapeType,
    w: candidate.w,
    x: candidate.x,
    y: candidate.y
  };
}

function isCanvasViewport(value: unknown): value is CanvasViewport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasViewport>;
  return isFiniteNumber(candidate.panX) && isFiniteNumber(candidate.panY) && isFiniteNumber(candidate.zoom);
}

export function isCanvasDocumentV1(value: unknown): value is CanvasDocumentV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasDocumentV1>;
  return candidate.version === 1 && typeof candidate.snapToGrid === "boolean" && isFiniteNumber(candidate.gridSize) && Array.isArray(candidate.shapes) && candidate.shapes.every(isCanvasShape) && isCanvasViewport(candidate.viewport);
}

function normalizeShapeTombstones(value: unknown): CanvasDocumentV1["shapeTombstones"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const tombstones: CanvasDocumentV1["shapeTombstones"] = {};
  for (const [id, metadata] of Object.entries(value)) {
    if (!metadata || typeof metadata !== "object") continue;
    const candidate = metadata as Partial<CanvasShape>;
    if (typeof candidate.clientId !== "string" || !isFiniteNumber(candidate.revision) || !isFiniteNumber(candidate.updatedAt)) continue;
    tombstones[id] = {
      clientId: candidate.clientId,
      revision: Math.max(0, Math.round(candidate.revision)),
      updatedAt: candidate.updatedAt
    };
  }
  return tombstones;
}

function createShapeId() {
  return `shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createShape(type: CanvasShapeType, point: { x: number; y: number }, overrides: Partial<CanvasShape> = {}): CanvasShape {
  const now = Date.now();
  const baseShape: CanvasShape = {
    clientId: "system",
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

function getShapeTypeLabel(type: CanvasShapeType) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getNextShapeName(shapes: CanvasShape[], type: CanvasShapeType) {
  return `${getShapeTypeLabel(type)} ${shapes.filter((shape) => shape.type === type).length + 1}`;
}

export function createDefaultCanvasState(): CanvasDocumentV1 {
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

const canvasMigrations: Record<number, (raw: unknown) => AnyCanvasDocument | null> = {
  1: (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<CanvasDocumentV1>;
    if (!Array.isArray(candidate.shapes) || !isCanvasViewport(candidate.viewport)) return null;
    const shapes = candidate.shapes.map(migrateCanvasShape).filter((shape): shape is CanvasShape => Boolean(shape));
    const namedShapes = shapes.map((shape, index) => ({
      ...shape,
      name: shape.name.trim() && shape.name !== getShapeTypeLabel(shape.type) ? shape.name : getNextShapeName(shapes.slice(0, index), shape.type)
    }));
    return {
      gridSize: isFiniteNumber(candidate.gridSize) ? candidate.gridSize : defaultGridSize,
      shapeTombstones: normalizeShapeTombstones(candidate.shapeTombstones),
      shapes: namedShapes,
      snapToGrid: typeof candidate.snapToGrid === "boolean" ? candidate.snapToGrid : true,
      version: 1,
      viewport: candidate.viewport
    };
  }
};

export function migrateCanvasState(raw: unknown): AnyCanvasDocument {
  if (!raw || typeof raw !== "object") return createDefaultCanvasState();
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== "number") return createDefaultCanvasState();

  const migrate = canvasMigrations[version];
  const migrated = migrate ? migrate(raw) : null;
  return migrated ?? createDefaultCanvasState();
}

export function normalizeCanvasState(raw: unknown): AnyCanvasDocument {
  return migrateCanvasState(raw);
}
