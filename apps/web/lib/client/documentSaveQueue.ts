export type DocumentSavePayload = {
  canvasState?: unknown;
  content?: string;
  title?: string;
};

export type DocumentSaveStatus = "blocked" | "offline" | "saved" | "saving";

type DocumentSaveQueueOptions = {
  onSaved: (documentId: string, document: unknown) => void;
  onStatusChange: (documentId: string, status: DocumentSaveStatus) => void;
  onTerminalError: (documentId: string, message: string) => void;
  onValidationError: (documentId: string, message: string | null) => void;
  send: (documentId: string, payload: DocumentSavePayload) => Promise<unknown>;
};

type PendingEntry = {
  attempt: number;
  blocked: boolean;
  payload: DocumentSavePayload;
  retryTimer: number | null;
};

export class TerminalSaveError extends Error {}
export class RecoverableSaveError extends Error {}

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
  private readonly terminalErrors = new Map<string, Error>();

  constructor(options: DocumentSaveQueueOptions) {
    this.options = options;
  }

  enqueue(documentId: string, payload: DocumentSavePayload) {
    this.terminalErrors.delete(documentId);
    this.options.onValidationError(documentId, null);
    const existing = this.pending.get(documentId);
    if (existing?.retryTimer) window.clearTimeout(existing.retryTimer);

    const mergedPayload = { ...existing?.payload, ...payload };
    this.pending.set(documentId, { attempt: 0, blocked: false, payload: mergedPayload, retryTimer: null });
    writeStoredPayload(documentId, mergedPayload);
    this.options.onStatusChange(documentId, "saving");
    this.schedule(documentId);
  }

  flush(documentId?: string) {
    const documentIds = documentId ? [documentId] : Array.from(this.pending.keys());
    for (const id of documentIds) {
      const entry = this.pending.get(id);
      if (!entry || entry.blocked) continue;
      if (entry.retryTimer) window.clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
      this.schedule(id);
    }
  }

  async flushAndWait(documentId: string) {
    const existingTerminalError = this.terminalErrors.get(documentId);
    if (existingTerminalError) throw existingTerminalError;
    this.flush(documentId);

    while (true) {
      const inFlight = this.inFlight.get(documentId);
      if (inFlight) await inFlight;
      const terminalError = this.terminalErrors.get(documentId);
      if (terminalError) throw terminalError;
      if (inFlight !== this.inFlight.get(documentId)) continue;
      if (!this.pending.has(documentId)) return;
      throw new Error("Document changes are not saved yet");
    }
  }

  retryFailedSave(documentId: string) {
    const entry = this.pending.get(documentId);
    if (!entry) return;
    if (entry.retryTimer) window.clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.attempt = 0;
    entry.blocked = false;
    this.terminalErrors.delete(documentId);
    this.options.onValidationError(documentId, null);
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
      this.terminalErrors.delete(documentId);
      this.pending.set(documentId, { attempt: 0, blocked: false, payload: storedPayload, retryTimer: null });
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
    if (!entry || entry.blocked) return;

    try {
      const document = await this.options.send(documentId, entry.payload);
      if (this.pending.get(documentId) === entry) {
        this.pending.delete(documentId);
        clearStoredPayload(documentId);
        this.options.onValidationError(documentId, null);
        this.options.onStatusChange(documentId, "saved");
        this.options.onSaved(documentId, document);
      }
    } catch (error) {
      if (this.pending.get(documentId) !== entry) return;

      if (error instanceof TerminalSaveError) {
        entry.blocked = true;
        this.terminalErrors.set(documentId, error);
        this.options.onStatusChange(documentId, "blocked");
        this.options.onValidationError(documentId, error.message);
        this.options.onTerminalError(documentId, error.message);
        return;
      }

      if (error instanceof RecoverableSaveError) {
        entry.blocked = true;
        this.terminalErrors.set(documentId, error);
        this.options.onStatusChange(documentId, "blocked");
        this.options.onValidationError(documentId, error.message);
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
