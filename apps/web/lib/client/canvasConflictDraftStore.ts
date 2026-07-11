import { isCanvasDocumentV1, type CanvasDocumentV1 } from "../canvas/canvasDocumentSchema";

const storageKeyPrefix = "slate:canvas-conflict:";

function storageKeyFor(documentId: string) {
  return `${storageKeyPrefix}${documentId}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export class CanvasConflictDraftStore {
  read(documentId: string): CanvasDocumentV1 | null {
    try {
      const raw = window.localStorage.getItem(storageKeyFor(documentId));
      if (!raw) return null;
      const value = JSON.parse(raw) as unknown;
      return isCanvasDocumentV1(value) ? value : null;
    } catch {
      return null;
    }
  }

  write(documentId: string, document: unknown) {
    if (!isCanvasDocumentV1(document)) return false;
    try {
      window.localStorage.setItem(storageKeyFor(documentId), JSON.stringify(document));
      return true;
    } catch {
      return false;
    }
  }

  matchesPersisted(documentId: string, persistedState: unknown) {
    if (!isCanvasDocumentV1(persistedState)) return false;
    const draft = this.read(documentId);
    return Boolean(draft && canonicalJson(draft) === canonicalJson(persistedState));
  }

  clearIfPersisted(documentId: string, persistedState: unknown) {
    if (!this.matchesPersisted(documentId, persistedState)) return false;
    try {
      window.localStorage.removeItem(storageKeyFor(documentId));
      return true;
    } catch {
      return false;
    }
  }
}

export const canvasConflictDraftStore = new CanvasConflictDraftStore();
