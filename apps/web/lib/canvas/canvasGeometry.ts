import type { CanvasPoint, CanvasShape, CanvasViewport } from "@/components/CanvasEditorShell";

export type ResizeHandle = "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w";

export const resizeHandleOrder: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const cornerResizeHandleOrder: ResizeHandle[] = ["nw", "ne", "se", "sw"];
const minShapeSize = 8;
const handleHitRadiusPx = 8;

function getShapeBounds(shape: CanvasShape) {
  return {
    x1: Math.min(shape.x, shape.x + shape.w),
    x2: Math.max(shape.x, shape.x + shape.w),
    y1: Math.min(shape.y, shape.y + shape.h),
    y2: Math.max(shape.y, shape.y + shape.h)
  };
}

export function getResizeHandlePoints(shape: CanvasShape): Record<ResizeHandle, CanvasPoint> {
  const { x1, x2, y1, y2 } = getShapeBounds(shape);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return {
    e: { x: x2, y: midY },
    n: { x: midX, y: y1 },
    ne: { x: x2, y: y1 },
    nw: { x: x1, y: y1 },
    s: { x: midX, y: y2 },
    se: { x: x2, y: y2 },
    sw: { x: x1, y: y2 },
    w: { x: x1, y: midY }
  };
}

export function getResizeHandleAtPoint(shape: CanvasShape, point: CanvasPoint, viewport: CanvasViewport, handles: ResizeHandle[] = resizeHandleOrder): ResizeHandle | null {
  const handlePoints = getResizeHandlePoints(shape);
  const hitRadius = handleHitRadiusPx / viewport.zoom;

  for (const handle of handles) {
    const handlePoint = handlePoints[handle];
    if (Math.abs(point.x - handlePoint.x) <= hitRadius && Math.abs(point.y - handlePoint.y) <= hitRadius) {
      return handle;
    }
  }

  return null;
}

export function resizeShape(shape: CanvasShape, handle: ResizeHandle, delta: CanvasPoint): CanvasShape {
  const { x1, x2, y1, y2 } = getShapeBounds(shape);
  let nextX1 = x1;
  let nextX2 = x2;
  let nextY1 = y1;
  let nextY2 = y2;

  if (handle.includes("w")) nextX1 = Math.min(x1 + delta.x, x2 - minShapeSize);
  if (handle.includes("e")) nextX2 = Math.max(x2 + delta.x, x1 + minShapeSize);
  if (handle.includes("n")) nextY1 = Math.min(y1 + delta.y, y2 - minShapeSize);
  if (handle.includes("s")) nextY2 = Math.max(y2 + delta.y, y1 + minShapeSize);

  return {
    ...shape,
    h: Math.round(nextY2 - nextY1),
    w: Math.round(nextX2 - nextX1),
    x: Math.round(nextX1),
    y: Math.round(nextY1)
  };
}
