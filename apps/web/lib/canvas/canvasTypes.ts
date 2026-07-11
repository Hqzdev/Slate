export type CanvasShapeType = "arrow" | "diamond" | "ellipse" | "line" | "note" | "parallelogram" | "rectangle" | "text" | "trapezoid";
export type CanvasColor = "black" | "blue" | "green" | "grey" | "light-blue" | "light-green" | "light-red" | "light-violet" | "orange" | "red" | "violet" | "white" | "yellow";
export type CanvasFill = "none" | "semi" | "solid";
export type CanvasDash = "dash-dot" | "dashed" | "dotted" | "long-dashed" | "solid";
export type CanvasSize = number;
export type CanvasFont = "mono" | "sans" | "serif";
export type CanvasTextAlign = "center" | "left" | "right";

export type CanvasShape = {
  clientId: string;
  color: CanvasColor;
  dash: CanvasDash;
  fill: CanvasFill;
  font: CanvasFont;
  h: number;
  id: string;
  isHidden: boolean;
  isLocked: boolean;
  name: string;
  opacity: number;
  revision: number;
  size: CanvasSize;
  text: string;
  textAlign: CanvasTextAlign;
  type: CanvasShapeType;
  updatedAt: number;
  w: number;
  x: number;
  y: number;
};

export type CanvasViewport = {
  panX: number;
  panY: number;
  zoom: number;
};
