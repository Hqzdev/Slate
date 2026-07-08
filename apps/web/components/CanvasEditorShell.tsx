"use client";

import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type CanvasShapeType = "arrow" | "ellipse" | "line" | "note" | "rectangle" | "text";
export type CanvasToolId = "arrow" | "ellipse" | "hand" | "line" | "note" | "rectangle" | "select" | "text";
export type CanvasToolIconName = "arrow" | "backward" | "check" | "chevron" | "download" | "ellipse" | "eye" | "eyeOff" | "fit" | "forward" | "frame" | "hand" | "image" | "line" | "lock" | "minus" | "note" | "plus" | "pointer" | "rectangle" | "redo" | "text" | "undo" | "unlock";
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

export type CanvasStats = {
  activeToolId: CanvasToolId;
  gridSize: number;
  selectedBoundsText: string;
  selectedCount: number;
  selectedType: string;
  shapeCount: number;
  snapToGrid: boolean;
  zoomPercent: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasTool = {
  disabledInReadOnly?: boolean;
  icon: CanvasToolIconName;
  id: CanvasToolId;
  label: string;
};

export type CanvasEditorAction = "exportPng" | "exportSvg" | "fit" | "redo" | "undo" | "zoomIn" | "zoomOut" | "zoomReset";
export type CanvasContextAction = "addRectangle" | "addText" | "bringForward" | "delete" | "duplicate" | "resetZoom" | "selectAll" | "sendBackward";
export type CanvasInspectorAction = "bringForward" | "delete" | "duplicate" | "lock" | "resetStyle" | "sendBackward" | "unlock";
export type CanvasLayerAction = "bringForward" | "hide" | "lock" | "sendBackward" | "show" | "unlock";
export type CanvasNumberKey = "h" | "length" | "w" | "x" | "y";
type CanvasBoundsNumberKey = Exclude<CanvasNumberKey, "length">;
export type CanvasStyleKey = "color" | "dash" | "fill" | "font" | "opacity" | "size" | "textAlign";

type CanvasContextMenu = {
  pageX: number;
  pageY: number;
  x: number;
  y: number;
};

type CanvasEditorShellProps = {
  activeToolId: CanvasToolId;
  children: ReactNode;
  readOnly: boolean;
  selectedShape: CanvasShape | null;
  selectedShapes: CanvasShape[];
  shapes: CanvasShape[];
  stats: CanvasStats;
  viewport: CanvasViewport;
  onContextAction: (action: CanvasContextAction, point: CanvasPoint | null) => void;
  onEditorAction: (action: CanvasEditorAction) => void;
  onLayerAction: (shapeId: string, action: CanvasLayerAction) => void;
  onLayerRename: (shapeId: string, name: string) => void;
  onNumberChange: (shapeId: string, key: CanvasNumberKey, value: number) => void;
  onSelectShape: (shapeId: string, additive?: boolean) => void;
  onSelectTool: (toolId: CanvasToolId) => void;
  onSnapToggle: () => void;
  onStyleChange: (key: CanvasStyleKey, value: string) => void;
};

export type CanvasViewport = {
  panX: number;
  panY: number;
  zoom: number;
};

type CanvasSelectOption = {
  label: string;
  value: string;
};

const canvasTools: CanvasTool[] = [
  { icon: "pointer", id: "select", label: "Select" },
  { icon: "hand", id: "hand", label: "Hand" },
  { disabledInReadOnly: true, icon: "text", id: "text", label: "Text" },
  { disabledInReadOnly: true, icon: "rectangle", id: "rectangle", label: "Rectangle" },
  { disabledInReadOnly: true, icon: "ellipse", id: "ellipse", label: "Ellipse" },
  { disabledInReadOnly: true, icon: "line", id: "line", label: "Line" },
  { disabledInReadOnly: true, icon: "arrow", id: "arrow", label: "Arrow" },
  { disabledInReadOnly: true, icon: "note", id: "note", label: "Note" }
];

const colorOptions: CanvasColor[] = ["black", "grey", "blue", "light-blue", "violet", "light-violet", "green", "light-green", "yellow", "orange", "red", "light-red", "white"];
const fillOptions: CanvasFill[] = ["none", "semi", "solid"];
const dashOptions: CanvasDash[] = ["solid", "dashed", "long-dashed", "dotted", "dash-dot"];
const fontOptions: CanvasFont[] = ["sans", "serif", "mono"];
const textAlignOptions: CanvasTextAlign[] = ["left", "center", "right"];

const fillSelectOptions = fillOptions.map((value) => ({ label: formatInspectorLabel(value), value }));
const dashSelectOptions = dashOptions.map((value) => ({ label: formatInspectorLabel(value), value }));
const fontSelectOptions = fontOptions.map((value) => ({ label: formatInspectorLabel(value), value }));
const textAlignSelectOptions = textAlignOptions.map((value) => ({ label: formatInspectorLabel(value), value }));

const colorPreviewMap: Record<CanvasColor, string> = {
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

const minCanvasSize = 8;
const maxCanvasSize = 96;
const minLineSize = 1;
const maxLineSize = 16;
const minLineLength = 8;
const maxLineLength = 2000;

function formatInspectorLabel(value: string) {
  return value.replace(/-/g, " ");
}

function getSharedValue<T extends string | number>(selectedShapes: CanvasShape[], key: keyof CanvasShape, fallback: T) {
  if (selectedShapes.length === 0) return fallback;
  const firstValue = selectedShapes[0][key];
  return selectedShapes.every((shape) => shape[key] === firstValue) ? String(firstValue) : "mixed";
}

function CanvasToolIcon({ name }: { name: CanvasToolIconName }) {
  return (
    <svg aria-hidden="true" className="canvas-tool-icon" fill="none" focusable="false" viewBox="0 0 24 24">
      {name === "pointer" && <path d="M5.2 3.8 18.8 11l-5.7 1.8-2.7 6.3-2.1-.9 2.5-5.8L5.2 16V3.8Z" />}
      {name === "hand" && <path d="M8.4 11.2V6.7a1.4 1.4 0 0 1 2.8 0v4.1m0-.7V5.4a1.4 1.4 0 0 1 2.8 0v5.3m0-.8V7a1.4 1.4 0 0 1 2.8 0v6.1c0 4-2.2 6.4-6 6.4h-.7a5.7 5.7 0 0 1-4.2-2l-2.1-2.3a1.5 1.5 0 0 1 2.1-2.1l2.5 2.1" />}
      {name === "frame" && <><path d="M5 5h14v14H5V5Z" /><path d="M8.5 8.5h7v7h-7v-7Z" /></>}
      {name === "text" && <><path d="M6 6h12" /><path d="M12 6v12" /><path d="M9 18h6" /></>}
      {name === "rectangle" && <path d="M5 7h14v10H5V7Z" />}
      {name === "ellipse" && <path d="M4.8 12c0-3 3.2-5.4 7.2-5.4s7.2 2.4 7.2 5.4-3.2 5.4-7.2 5.4S4.8 15 4.8 12Z" />}
      {name === "line" && <path d="m6 17 12-10" />}
      {name === "arrow" && <><path d="M5 17 17 5" /><path d="M10 5h7v7" /></>}
      {name === "note" && <><path d="M6 5h12v14H6V5Z" /><path d="M9 9h6" /><path d="M9 13h4.5" /></>}
      {name === "undo" && <><path d="M8.4 7H5v3.4" /><path d="M5.4 10.4A6.8 6.8 0 1 0 8 5.8" /></>}
      {name === "redo" && <><path d="M15.6 7H19v3.4" /><path d="M18.6 10.4A6.8 6.8 0 1 1 16 5.8" /></>}
      {name === "minus" && <path d="M6 12h12" />}
      {name === "plus" && <><path d="M6 12h12" /><path d="M12 6v12" /></>}
      {name === "fit" && <><path d="M8 5H5v3" /><path d="M16 5h3v3" /><path d="M19 16v3h-3" /><path d="M8 19H5v-3" /><path d="M9 9h6v6H9V9Z" /></>}
      {name === "download" && <><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 18.5h14" /></>}
      {name === "image" && <><path d="M5 6h14v12H5V6Z" /><path d="m8 15 3-3 2.5 2.5 1.5-1.5 3 3" /><path d="M9 9.2h.1" /></>}
      {name === "chevron" && <path d="m8 10 4 4 4-4" />}
      {name === "check" && <path d="m5 12.5 4.2 4.2L19 6.8" />}
      {name === "eye" && <><path d="M3.8 12s3-5.2 8.2-5.2S20.2 12 20.2 12s-3 5.2-8.2 5.2S3.8 12 3.8 12Z" /><path d="M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /></>}
      {name === "eyeOff" && <><path d="m4 4 16 16" /><path d="M9.6 9.6A2.5 2.5 0 0 0 13.9 14" /><path d="M7.4 6.8A9.7 9.7 0 0 1 12 5.8c5.2 0 8.2 5.2 8.2 5.2a13.5 13.5 0 0 1-2.5 3.2" /><path d="M14.7 17A9.4 9.4 0 0 1 12 17.2C6.8 17.2 3.8 12 3.8 12a13.4 13.4 0 0 1 2-2.7" /></>}
      {name === "lock" && <><path d="M7 10V7.8a5 5 0 0 1 10 0V10" /><path d="M6 10h12v9H6v-9Z" /></>}
      {name === "unlock" && <><path d="M9 10V7.8a5 5 0 0 1 9.1-2.8" /><path d="M6 10h12v9H6v-9Z" /></>}
      {name === "forward" && <><path d="M12 5v14" /><path d="m7 10 5-5 5 5" /></>}
      {name === "backward" && <><path d="M12 19V5" /><path d="m7 14 5 5 5-5" /></>}
    </svg>
  );
}

function CanvasSelectControl({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: CanvasSelectOption[]; value: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const displayLabel = selectedOption?.label ?? "Mixed";

  useEffect(() => {
    if (!open) return;

    function closeFromPointer(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  function commitValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, nextValue: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitValue(nextValue);
    }
  }

  return (
    <div className="canvas-inspector-control">
      <span>{label}</span>
      <div className="canvas-select" data-open={open ? "true" : "false"} ref={rootRef}>
        <button aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={handleButtonKeyDown} ref={buttonRef} type="button">
          <strong>{displayLabel}</strong>
          <CanvasToolIcon name="chevron" />
        </button>
        {open && (
          <div className="canvas-select-menu" role="listbox">
            {options.map((option) => (
              <button aria-selected={option.value === value} className={option.value === value ? "active" : ""} key={option.value} onClick={() => commitValue(option.value)} onKeyDown={(event) => handleOptionKeyDown(event, option.value)} role="option" type="button">
                <span>{option.label}</span>
                {option.value === value && <CanvasToolIcon name="check" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CanvasEditorShell({ activeToolId, children, onContextAction, onEditorAction, onLayerAction, onLayerRename, onNumberChange, onSelectShape, onSelectTool, onSnapToggle, onStyleChange, readOnly, selectedShape, selectedShapes, shapes, stats, viewport }: CanvasEditorShellProps) {
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [layerNameDrafts, setLayerNameDrafts] = useState<Record<string, string>>({});
  const hasSelection = selectedShapes.length > 0;
  const selectedLineShape = selectedShape && (selectedShape.type === "line" || selectedShape.type === "arrow") ? selectedShape : null;
  const lineOnlySelection = selectedShapes.length > 0 && selectedShapes.every((shape) => shape.type === "line" || shape.type === "arrow");
  const selectedLineLength = selectedLineShape ? Math.round(Math.hypot(selectedLineShape.w, selectedLineShape.h)) : 0;
  const colorValue = getSharedValue(selectedShapes, "color", "black");
  const fillValue = getSharedValue(selectedShapes, "fill", "none");
  const dashValue = getSharedValue(selectedShapes, "dash", "solid");
  const sizeValue = getSharedValue(selectedShapes, "size", 18);
  const fontValue = getSharedValue(selectedShapes, "font", "sans");
  const textAlignValue = getSharedValue(selectedShapes, "textAlign", "left");
  const opacityValue = getSharedValue(selectedShapes, "opacity", 1);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [contextMenu]);

  function getPagePoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.panY) / viewport.zoom
    };
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const point = getPagePoint(event);
    setContextMenu({
      pageX: point.x,
      pageY: point.y,
      x: event.clientX,
      y: event.clientY
    });
  }

  function runContextAction(action: CanvasContextAction) {
    onContextAction(action, contextMenu ? { x: contextMenu.pageX, y: contextMenu.pageY } : null);
    setContextMenu(null);
  }

  function updateLayerName(shapeId: string, value: string) {
    setLayerNameDrafts((current) => ({ ...current, [shapeId]: value }));
  }

  function commitLayerName(shape: CanvasShape) {
    onLayerRename(shape.id, layerNameDrafts[shape.id] ?? shape.name);
    setLayerNameDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[shape.id];
      return nextDrafts;
    });
  }

  function handleLayerNameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, shape: CanvasShape) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      setLayerNameDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[shape.id];
        return nextDrafts;
      });
      event.currentTarget.blur();
    }
  }

  return (
    <section className="canvas-editor-shell">
      <div className="canvas-editor-workspace" onContextMenu={handleContextMenu}>
        <div className="canvas-engine-frame">
          {children}
        </div>

        <div className="canvas-floating-toolbar" aria-label="Canvas tools" onMouseDown={(event) => event.preventDefault()}>
          {canvasTools.map((tool) => (
            <button aria-label={tool.label} className={activeToolId === tool.id ? "active" : ""} disabled={readOnly && tool.disabledInReadOnly} key={tool.id} onClick={() => onSelectTool(tool.id)} title={tool.label} type="button">
              <CanvasToolIcon name={tool.icon} />
            </button>
          ))}
          <i />
          <button aria-label="Undo" disabled={readOnly} onClick={() => onEditorAction("undo")} title="Undo" type="button"><CanvasToolIcon name="undo" /></button>
          <button aria-label="Redo" disabled={readOnly} onClick={() => onEditorAction("redo")} title="Redo" type="button"><CanvasToolIcon name="redo" /></button>
          <i />
          <button aria-label="Zoom out" onClick={() => onEditorAction("zoomOut")} title="Zoom out" type="button"><CanvasToolIcon name="minus" /></button>
          <button aria-label="Reset zoom" onClick={() => onEditorAction("zoomReset")} title="Reset zoom" type="button">{stats.zoomPercent}%</button>
          <button aria-label="Zoom in" onClick={() => onEditorAction("zoomIn")} title="Zoom in" type="button"><CanvasToolIcon name="plus" /></button>
          <button aria-label="Fit to content" onClick={() => onEditorAction("fit")} title="Fit to content" type="button"><CanvasToolIcon name="fit" /></button>
          <i />
          <button aria-label="Export SVG" onClick={() => onEditorAction("exportSvg")} title="Export SVG" type="button"><CanvasToolIcon name="download" /></button>
          <button aria-label="Export PNG" onClick={() => onEditorAction("exportPng")} title="Export PNG" type="button"><CanvasToolIcon name="image" /></button>
        </div>

        {contextMenu && (
          <div className="canvas-context-menu" onPointerDown={(event) => event.stopPropagation()} style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => runContextAction("resetZoom")} type="button">Reset zoom</button>
            <button onClick={() => runContextAction("selectAll")} type="button">Select all</button>
            {!readOnly && (
              <>
                <i />
                <button onClick={() => runContextAction("addText")} type="button">Add text</button>
                <button onClick={() => runContextAction("addRectangle")} type="button">Add rectangle</button>
              </>
            )}
            {!readOnly && stats.selectedCount > 0 && (
              <>
                <i />
                <button onClick={() => runContextAction("duplicate")} type="button">Duplicate</button>
                <button onClick={() => runContextAction("bringForward")} type="button">Bring forward</button>
                <button onClick={() => runContextAction("sendBackward")} type="button">Send backward</button>
                <button className="danger" onClick={() => runContextAction("delete")} type="button">Delete</button>
              </>
            )}
          </div>
        )}
      </div>

      <aside className="canvas-inspector">
        <div className="canvas-inspector-section">
          <span>Selection</span>
          <strong>{stats.selectedCount === 0 ? "Page" : `${stats.selectedCount} selected`}</strong>
        </div>
        <div className="canvas-inspector-grid">
          <span>Type</span>
          <b>{stats.selectedType}</b>
          <span>Bounds</span>
          <b>{stats.selectedBoundsText}</b>
          <span>Objects</span>
          <b>{stats.shapeCount}</b>
          <span>Zoom</span>
          <b>{stats.zoomPercent}%</b>
        </div>

        {selectedShape && (
          <div className="canvas-inspector-panel">
            <div className="canvas-inspector-heading">
              <span>Position</span>
              <b>{selectedShape.isLocked ? "Locked" : "Editable"}</b>
            </div>
            <div className="canvas-inspector-field-grid">
              {(["x", "y", "w", "h"] as CanvasBoundsNumberKey[]).map((key) => (
                <label key={key}>
                  <span>{key.toUpperCase()}</span>
                  <input disabled={readOnly || selectedShape.isLocked} inputMode="numeric" onChange={(event) => onNumberChange(selectedShape.id, key, Number(event.target.value))} type="number" value={Math.round(selectedShape[key])} />
                </label>
              ))}
            </div>
          </div>
        )}

        {hasSelection ? (
          <div className="canvas-inspector-panel">
            <div className="canvas-inspector-heading">
              <span>Style</span>
              <b>{stats.selectedCount} selected</b>
            </div>

            <div className="canvas-inspector-control">
              <span>Color</span>
              <div className="canvas-color-row">
                {colorOptions.map((color) => (
                  <button aria-label={`Color ${color}`} className={colorValue === color ? "active" : ""} disabled={readOnly} key={color} onClick={() => onStyleChange("color", color)} style={{ background: colorPreviewMap[color] }} title={formatInspectorLabel(color)} type="button" />
                ))}
              </div>
            </div>

            {!lineOnlySelection && <CanvasSelectControl disabled={readOnly} label="Fill" onChange={(value) => onStyleChange("fill", value)} options={fillSelectOptions} value={fillValue} />}

            <CanvasSelectControl disabled={readOnly} label="Stroke" onChange={(value) => onStyleChange("dash", value)} options={dashSelectOptions} value={dashValue} />

            <label className="canvas-inspector-control">
              <span>{lineOnlySelection ? "Width" : "Size"}</span>
              <div className="canvas-number-row">
                <input disabled={readOnly} max={lineOnlySelection ? maxLineSize : maxCanvasSize} min={lineOnlySelection ? minLineSize : minCanvasSize} onChange={(event) => onStyleChange("size", event.target.value)} placeholder={sizeValue === "mixed" ? "Mixed" : undefined} step="1" type="number" value={sizeValue === "mixed" ? "" : sizeValue} />
                <b>px</b>
              </div>
            </label>

            {selectedLineShape && (
              <label className="canvas-inspector-control">
                <span>Length</span>
                <div className="canvas-number-row">
                  <input disabled={readOnly || selectedLineShape.isLocked} max={maxLineLength} min={minLineLength} onChange={(event) => onNumberChange(selectedLineShape.id, "length", Number(event.target.value))} step="1" type="number" value={selectedLineLength} />
                  <b>px</b>
                </div>
              </label>
            )}

            <label className="canvas-inspector-control">
              <span>Opacity</span>
              <div className="canvas-range-row">
                <input disabled={readOnly || opacityValue === "mixed"} max="100" min="0" onChange={(event) => onStyleChange("opacity", event.target.value)} type="range" value={opacityValue === "mixed" ? "100" : Math.round(Number(opacityValue) * 100).toString()} />
                <b>{opacityValue === "mixed" ? "Mixed" : `${Math.round(Number(opacityValue) * 100)}%`}</b>
              </div>
            </label>

            {!lineOnlySelection && (
              <>
                <div className="canvas-inspector-heading compact">
                  <span>Typography</span>
                </div>

                <CanvasSelectControl disabled={readOnly} label="Font" onChange={(value) => onStyleChange("font", value)} options={fontSelectOptions} value={fontValue} />

                <CanvasSelectControl disabled={readOnly} label="Text" onChange={(value) => onStyleChange("textAlign", value)} options={textAlignSelectOptions} value={textAlignValue} />
              </>
            )}
          </div>
        ) : (
          <div className="canvas-inspector-panel">
            <div className="canvas-inspector-heading">
              <span>Page</span>
              <b>{readOnly ? "View" : "Edit"}</b>
            </div>
            <div className="canvas-inspector-grid flush">
              <span>Tool</span>
              <b>{stats.activeToolId}</b>
              <span>Grid</span>
              <b>{stats.gridSize} px</b>
              <span>Snap</span>
              <b>{stats.snapToGrid ? "On" : "Off"}</b>
              <span>State</span>
              <b>Autosave</b>
            </div>
            <div className="canvas-inspector-actions single">
              <button disabled={readOnly} onClick={onSnapToggle} type="button">{stats.snapToGrid ? "Disable snap" : "Enable snap"}</button>
            </div>
          </div>
        )}

        {selectedShapes.length > 1 && (
          <div className="canvas-inspector-panel">
            <div className="canvas-inspector-heading">
              <span>Selection</span>
            </div>
            <div className="canvas-layer-list">
              {selectedShapes.map((shape) => (
                <button key={shape.id} onClick={() => onSelectShape(shape.id)} type="button">
                  <span>{shape.name}</span>
                  <b>{shape.id.slice(0, 6)}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="canvas-inspector-panel">
          <div className="canvas-inspector-heading">
            <span>Layers</span>
            <b>{shapes.length}</b>
          </div>
          <div className="canvas-layer-list full">
            {[...shapes].reverse().map((shape) => {
              const selected = selectedShapes.some((selectedShapeItem) => selectedShapeItem.id === shape.id);
              return (
                <div className={selected ? "canvas-layer-row selected" : "canvas-layer-row"} key={shape.id}>
                  <button className="canvas-layer-select" onClick={(event) => onSelectShape(shape.id, event.shiftKey || event.metaKey || event.ctrlKey)} type="button">
                    <span>{shape.name}</span>
                    <b>{shape.isHidden ? "Hidden" : shape.isLocked ? "Locked" : shape.id.slice(0, 6)}</b>
                  </button>
                  <input disabled={readOnly} onBlur={() => commitLayerName(shape)} onChange={(event) => updateLayerName(shape.id, event.target.value)} onKeyDown={(event) => handleLayerNameKeyDown(event, shape)} value={layerNameDrafts[shape.id] ?? shape.name} />
                  <div className="canvas-layer-actions">
                    <button aria-label={shape.isHidden ? "Show layer" : "Hide layer"} disabled={readOnly} onClick={() => onLayerAction(shape.id, shape.isHidden ? "show" : "hide")} title={shape.isHidden ? "Show" : "Hide"} type="button"><CanvasToolIcon name={shape.isHidden ? "eyeOff" : "eye"} /></button>
                    <button aria-label={shape.isLocked ? "Unlock layer" : "Lock layer"} disabled={readOnly} onClick={() => onLayerAction(shape.id, shape.isLocked ? "unlock" : "lock")} title={shape.isLocked ? "Unlock" : "Lock"} type="button"><CanvasToolIcon name={shape.isLocked ? "lock" : "unlock"} /></button>
                    <button aria-label="Bring forward" disabled={readOnly} onClick={() => onLayerAction(shape.id, "bringForward")} title="Forward" type="button"><CanvasToolIcon name="forward" /></button>
                    <button aria-label="Send backward" disabled={readOnly} onClick={() => onLayerAction(shape.id, "sendBackward")} title="Backward" type="button"><CanvasToolIcon name="backward" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}
