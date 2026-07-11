import { truncateDatabaseSafeText } from "../databaseSafeText";

export type CanvasDiagramNodeKind = "data" | "decision" | "note" | "process" | "terminal";

export type CanvasDiagramNode = {
  key: string;
  kind: CanvasDiagramNodeKind;
  label: string;
};

export type CanvasDiagramEdge = {
  from: string;
  label: string | null;
  to: string;
};

export type CanvasDiagramPayload = {
  edges: CanvasDiagramEdge[];
  nodes: CanvasDiagramNode[];
  parentId: string | null;
  title: string;
};

type CanvasShapeType = "arrow" | "diamond" | "ellipse" | "note" | "parallelogram" | "rectangle";
type CanvasColor = "blue" | "green" | "grey" | "orange" | "violet" | "yellow";
type CanvasFill = "none" | "semi" | "solid";

type CanvasShape = {
  clientId: string;
  color: CanvasColor;
  dash: "solid";
  fill: CanvasFill;
  font: "sans";
  h: number;
  id: string;
  isHidden: boolean;
  isLocked: boolean;
  name: string;
  opacity: number;
  revision: number;
  size: number;
  text: string;
  textAlign: "center";
  type: CanvasShapeType;
  updatedAt: number;
  w: number;
  x: number;
  y: number;
};

export type GeneratedCanvasDocumentV1 = {
  gridSize: number;
  shapeTombstones: Record<string, never>;
  shapes: CanvasShape[];
  snapToGrid: boolean;
  version: 1;
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
  };
};

type NodeStyle = {
  color: CanvasColor;
  fill: CanvasFill;
  type: Exclude<CanvasShapeType, "arrow">;
};

const nodeStyles: Record<CanvasDiagramNodeKind, NodeStyle> = {
  data: { color: "orange", fill: "semi", type: "parallelogram" },
  decision: { color: "violet", fill: "semi", type: "diamond" },
  note: { color: "yellow", fill: "solid", type: "note" },
  process: { color: "blue", fill: "semi", type: "rectangle" },
  terminal: { color: "green", fill: "semi", type: "ellipse" }
};

const columns = 5;
const nodeWidth = 220;
const nodeHeight = 104;
const horizontalStep = 300;
const verticalStep = 200;
const originX = 120;
const originY = 120;

function createNodeShape(node: CanvasDiagramNode, index: number): CanvasShape {
  const style = nodeStyles[node.kind];
  return {
    clientId: "ai-draft",
    color: style.color,
    dash: "solid",
    fill: style.fill,
    font: "sans",
    h: nodeHeight,
    id: `node_${index + 1}`,
    isHidden: false,
    isLocked: false,
    name: truncateDatabaseSafeText(node.label, 80),
    opacity: 1,
    revision: 0,
    size: 18,
    text: node.label,
    textAlign: "center",
    type: style.type,
    updatedAt: 0,
    w: nodeWidth,
    x: originX + (index % columns) * horizontalStep,
    y: originY + Math.floor(index / columns) * verticalStep
  };
}

function shapeCenter(shape: CanvasShape) {
  return {
    x: shape.x + shape.w / 2,
    y: shape.y + shape.h / 2
  };
}

function boundaryPoint(source: CanvasShape, target: CanvasShape) {
  const sourceCenter = shapeCenter(source);
  const targetCenter = shapeCenter(target);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  const scale = 1 / Math.max(Math.abs(deltaX) / (source.w / 2), Math.abs(deltaY) / (source.h / 2));
  return {
    x: Math.round(sourceCenter.x + deltaX * scale),
    y: Math.round(sourceCenter.y + deltaY * scale)
  };
}

function createEdgeShape(edge: CanvasDiagramEdge, index: number, shapesByKey: Map<string, CanvasShape>): CanvasShape {
  const source = shapesByKey.get(edge.from);
  const target = shapesByKey.get(edge.to);

  if (!source || !target) {
    throw new Error("Canvas edge references an unknown node");
  }

  const start = boundaryPoint(source, target);
  const end = boundaryPoint(target, source);
  return {
    clientId: "ai-draft",
    color: "grey",
    dash: "solid",
    fill: "none",
    font: "sans",
    h: end.y - start.y,
    id: `edge_${index + 1}`,
    isHidden: false,
    isLocked: false,
    name: edge.label ?? `Connection ${index + 1}`,
    opacity: 1,
    revision: 0,
    size: 2,
    text: edge.label ?? "",
    textAlign: "center",
    type: "arrow",
    updatedAt: 0,
    w: end.x - start.x,
    x: start.x,
    y: start.y
  };
}

export function compileCanvasDiagram(payload: CanvasDiagramPayload): GeneratedCanvasDocumentV1 {
  const nodeShapes = payload.nodes.map(createNodeShape);
  const shapesByKey = new Map(payload.nodes.map((node, index) => [node.key, nodeShapes[index]]));
  const edgeShapes = payload.edges.map((edge, index) => createEdgeShape(edge, index, shapesByKey));

  return {
    gridSize: 24,
    shapeTombstones: {},
    shapes: [...edgeShapes, ...nodeShapes],
    snapToGrid: true,
    version: 1,
    viewport: {
      panX: 80,
      panY: 80,
      zoom: 1
    }
  };
}
