const shapeTypes = new Set(["arrow", "diamond", "ellipse", "line", "note", "parallelogram", "rectangle", "text", "trapezoid"]);
const colors = new Set(["black", "blue", "green", "grey", "light-blue", "light-green", "light-red", "light-violet", "orange", "red", "violet", "white", "yellow"]);
const dashes = new Set(["dash-dot", "dashed", "dotted", "long-dashed", "solid"]);
const fills = new Set(["none", "semi", "solid"]);
const fonts = new Set(["mono", "sans", "serif"]);
const textAlignments = new Set(["center", "left", "right"]);
const maximumGridSize = 512;
const maximumZoom = 2.5;
const minimumGridSize = 1;
const minimumZoom = 0.3;
export const maximumCanvasStateBytes = 524_288;

export class CanvasStateValidator {
  createDefault() {
    return {
      gridSize: 24,
      shapeTombstones: {},
      shapes: [],
      snapToGrid: true,
      version: 1,
      viewport: { panX: 120, panY: 80, zoom: 1 }
    };
  }

  isValid(value) {
    if (!this.isJsonValue(value, new Set()) || !this.isRecord(value)) return false;
    if (!this.isWithinSizeLimit(value)) return false;
    if (value.version !== 1 || typeof value.snapToGrid !== "boolean" || !this.isBoundedNumber(value.gridSize, minimumGridSize, maximumGridSize)) return false;
    if (!this.isViewport(value.viewport) || !Array.isArray(value.shapes) || !value.shapes.every((shape) => this.isShape(shape))) return false;
    return this.isShapeTombstones(value.shapeTombstones);
  }

  clone(value) {
    if (!this.isValid(value)) return null;
    return JSON.parse(JSON.stringify(value));
  }

  isShape(value) {
    return this.isRecord(value)
      && this.isSafeString(value.id)
      && this.isSafeString(value.clientId)
      && shapeTypes.has(value.type)
      && colors.has(value.color)
      && dashes.has(value.dash)
      && fills.has(value.fill)
      && fonts.has(value.font)
      && textAlignments.has(value.textAlign)
      && this.isSafeString(value.text)
      && this.isSafeString(value.name)
      && typeof value.isHidden === "boolean"
      && typeof value.isLocked === "boolean"
      && this.isBoundedNumber(value.opacity, 0, 1)
      && this.isNonNegativeInteger(value.revision)
      && this.isShapeSize(value.type, value.size)
      && [value.h, value.updatedAt, value.w, value.x, value.y].every((entry) => this.isFiniteNumber(entry));
  }

  isShapeTombstones(value) {
    if (!this.isRecord(value)) return false;
    return Object.entries(value).every(([id, metadata]) => (
      id.length > 0
      && this.isSafeString(id)
      && this.isRecord(metadata)
      && this.isSafeString(metadata.clientId)
      && this.isNonNegativeInteger(metadata.revision)
      && this.isFiniteNumber(metadata.updatedAt)
    ));
  }

  isViewport(value) {
    return this.isRecord(value)
      && this.isFiniteNumber(value.panX)
      && this.isFiniteNumber(value.panY)
      && this.isBoundedNumber(value.zoom, minimumZoom, maximumZoom);
  }

  isJsonValue(value, ancestors) {
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return this.isFiniteNumber(value);
    if (typeof value === "string") return this.isSafeString(value);
    if (typeof value !== "object" || ancestors.has(value)) return false;
    if (Array.isArray(value)) {
      ancestors.add(value);
      const valid = value.every((entry) => this.isJsonValue(entry, ancestors));
      ancestors.delete(value);
      return valid;
    }
    if (!this.isRecord(value)) return false;
    ancestors.add(value);
    const valid = Object.entries(value).every(([key, entry]) => this.isSafeString(key) && this.isJsonValue(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }

  isRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  isBoundedNumber(value, minimum, maximum) {
    return this.isFiniteNumber(value) && value >= minimum && value <= maximum;
  }

  isNonNegativeInteger(value) {
    return this.isFiniteNumber(value) && value >= 0 && Number.isInteger(value);
  }

  isShapeSize(type, value) {
    if (!Number.isInteger(value)) return false;
    return type === "arrow" || type === "line"
      ? value >= 1 && value <= 16
      : value >= 8 && value <= 96;
  }

  isSafeString(value) {
    if (typeof value !== "string" || value.includes("\u0000")) return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 >= value.length) return false;
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return false;
      }
    }
    return true;
  }

  isWithinSizeLimit(value) {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8") <= maximumCanvasStateBytes;
    } catch {
      return false;
    }
  }
}

export const canvasStateValidator = new CanvasStateValidator();
