"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshIcon } from "@/components/Icons";

type DocumentSnapshotSummary = {
  createdAt: string;
  id: string;
  label: string | null;
};

type DocumentHistoryPanelProps = {
  canEdit: boolean;
  documentId: string | null;
  onRestore: (document: unknown) => void;
};

function formatRelativeTime(isoDate: string) {
  const elapsedMs = Date.now() - new Date(isoDate).getTime();
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function DocumentHistoryPanel({ canEdit, documentId, onRestore }: DocumentHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<DocumentSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const loadSnapshots = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/snapshots`);
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { snapshots: DocumentSnapshotSummary[] };
      setSnapshots(body.snapshots);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "History failed to load");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadSnapshots(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSnapshots, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function saveVersion() {
    if (!documentId) return;
    setSavingLabel(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/snapshots`, {
        body: JSON.stringify({ label: labelDraft.trim() || "Manual save" }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await response.text());
      setLabelDraft("");
      await loadSnapshots();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Version failed to save");
    } finally {
      setSavingLabel(false);
    }
  }

  async function confirmRestore(snapshotId: string) {
    if (!documentId) return;
    setRestoring(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/snapshots/${snapshotId}/restore`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { document: unknown };
      onRestore(body.document);
      setPendingRestoreId(null);
      setOpen(false);
      await loadSnapshots();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  const pendingSnapshot = snapshots.find((snapshot) => snapshot.id === pendingRestoreId) ?? null;

  return (
    <div className="history-wrap">
      <button aria-label="Document versions" className="icon-control history-control" disabled={!documentId} onClick={() => setOpen((current) => !current)} title="Document versions">
        <RefreshIcon />
      </button>
      {open && (
        <div className="history-menu">
          <strong>Document history</strong>
          {canEdit && (
            <div className="history-save-form">
              <input aria-label="Version label" onChange={(event) => setLabelDraft(event.target.value)} placeholder="Version label (optional)" value={labelDraft} />
              <button className="primary-control" disabled={savingLabel} onClick={() => void saveVersion()} type="button">
                {savingLabel ? "Saving..." : "Save version"}
              </button>
            </div>
          )}
          {loading && <p>Loading...</p>}
          {error && <strong className="auth-error">{error}</strong>}
          {!loading && snapshots.length === 0 && <p>No saved versions yet.</p>}
          <div className="history-list">
            {snapshots.map((snapshot) => (
              <div className="history-row" key={snapshot.id}>
                <div>
                  <b>{snapshot.label ?? "Autosave"}</b>
                  <small>{formatRelativeTime(snapshot.createdAt)}</small>
                </div>
                {canEdit && (
                  <button disabled={restoring} onClick={() => setPendingRestoreId(snapshot.id)} type="button">
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {pendingSnapshot && (
        <div className="confirm-layer" onClick={() => setPendingRestoreId(null)}>
          <section aria-labelledby="restore-snapshot-title" aria-modal="true" className="confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="confirm-icon danger">
              <RefreshIcon />
            </div>
            <strong id="restore-snapshot-title">Restore {pendingSnapshot.label ?? "this version"}?</strong>
            <p>Unsaved changes since your last version are not recoverable after this.</p>
            <div className="confirm-actions">
              <button disabled={restoring} onClick={() => setPendingRestoreId(null)} type="button">Cancel</button>
              <button className="danger-control" disabled={restoring} onClick={() => void confirmRestore(pendingSnapshot.id)} type="button">Restore</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
