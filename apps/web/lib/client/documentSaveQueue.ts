export type DocumentSavePayload = {
  canvasState?: unknown;
  content?: string;
  title?: string;
};

export type DocumentSaveStatus = "offline" | "saved" | "saving";

type DocumentSaveQueueOptions = {
  onSaved: (documentId: string, document: unknown) => void;
  onStatusChange: (documentId: string, status: DocumentSaveStatus) => void;
  onTerminalError: (documentId: string, message: string) => void;
  send: (documentId: string, payload: DocumentSavePayload) => Promise<unknown>;
};

type PendingEntry = {
  attempt: number;
  payload: DocumentSavePayload;
  retryTimer: number | null;
};

export class TerminalSaveError extends Error {}

const storageKeyPrefix = "slate:autosave:";
const retryDelaysMs = [1000, 3000, 9000, 27000];

function storageKeyFor(documentId: string) {
  return `${storageKeyPrefix}${documentId}`;
}

function readStoredPayload(documentId: string): DocumentSavePayload | null {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(documentId));
    return raw ? (JSON.parse(raw) as DocumentSavePayload) : null;
  } catch {
    return null;
  }
}

function writeStoredPayload(documentId: string, payload: DocumentSavePayload) {
  try {
    window.localStorage.setItem(storageKeyFor(documentId), JSON.stringify(payload));
  } catch {
    return;
  }
}

function clearStoredPayload(documentId: string) {
  try {
    window.localStorage.removeItem(storageKeyFor(documentId));
  } catch {
    return;
  }
}

export class DocumentSaveQueue {
  private readonly options: DocumentSaveQueueOptions;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: DocumentSaveQueueOptions) {
    this.options = options;
  }

  enqueue(documentId: string, payload: DocumentSavePayload) {
    const existing = this.pending.get(documentId);
    if (existing?.retryTimer) window.clearTimeout(existing.retryTimer);

    const mergedPayload = { ...existing?.payload, ...payload };
    this.pending.set(documentId, { attempt: 0, payload: mergedPayload, retryTimer: null });
    writeStoredPayload(documentId, mergedPayload);
    this.options.onStatusChange(documentId, "saving");
    this.schedule(documentId);
  }

  flush(documentId?: string) {
    const documentIds = documentId ? [documentId] : Array.from(this.pending.keys());
    for (const id of documentIds) {
      const entry = this.pending.get(id);
      if (!entry) continue;
      if (entry.retryTimer) window.clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
      this.schedule(id);
    }
  }

  retryFailedSave(documentId: string) {
    const entry = this.pending.get(documentId);
    if (!entry) return;
    if (entry.retryTimer) window.clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.attempt = 0;
    this.schedule(documentId);
  }

  recover(knownDocumentIds: string[]) {
    const knownSet = new Set(knownDocumentIds);
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(storageKeyPrefix)) continue;
      const documentId = key.slice(storageKeyPrefix.length);
      if (!knownSet.has(documentId) || this.pending.has(documentId)) continue;
      const storedPayload = readStoredPayload(documentId);
      if (!storedPayload) continue;
      this.pending.set(documentId, { attempt: 0, payload: storedPayload, retryTimer: null });
      this.options.onStatusChange(documentId, "saving");
      this.schedule(documentId);
    }
  }

  private schedule(documentId: string) {
    const previousSend = this.inFlight.get(documentId) ?? Promise.resolve();
    const nextSend = previousSend.catch(() => undefined).then(() => this.send(documentId));
    this.inFlight.set(documentId, nextSend);
  }

  private async send(documentId: string) {
    const entry = this.pending.get(documentId);
    if (!entry) return;

    try {
      const document = await this.options.send(documentId, entry.payload);
      if (this.pending.get(documentId) === entry) {
        this.pending.delete(documentId);
        clearStoredPayload(documentId);
        this.options.onStatusChange(documentId, "saved");
        this.options.onSaved(documentId, document);
      }
    } catch (error) {
      if (this.pending.get(documentId) !== entry) return;

      if (error instanceof TerminalSaveError) {
        this.pending.delete(documentId);
        clearStoredPayload(documentId);
        this.options.onTerminalError(documentId, error.message);
        return;
      }

      this.options.onStatusChange(documentId, "offline");
      if (entry.attempt >= retryDelaysMs.length) return;

      const delay = retryDelaysMs[entry.attempt];
      entry.attempt += 1;
      entry.retryTimer = window.setTimeout(() => this.schedule(documentId), delay);
    }
  }
}
