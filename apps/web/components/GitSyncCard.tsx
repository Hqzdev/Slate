"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardGithubIcon } from "@/components/Icons";

type GitSyncRepository = {
  autoSync: boolean;
  branch: string;
  changedFiles: string[];
  id: string;
  lastError: string | null;
  lastSyncAt: string | null;
  remote: string;
  state: "changes_detected" | "needs_attention" | "synced" | "syncing";
};

type GitSyncResponse = {
  error?: string;
  repository?: GitSyncRepository;
};

const statusLabel: Record<GitSyncRepository["state"], string> = {
  changes_detected: "Changes detected",
  needs_attention: "Needs attention",
  synced: "Synced",
  syncing: "Syncing"
};

export function GitSyncCard() {
  const [repository, setRepository] = useState<GitSyncRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/git-sync", { cache: "no-store" });
    const body = await response.json().catch(() => null) as GitSyncResponse | null;
    if (!response.ok || !body?.repository) {
      setRepository(null);
      setError(body?.error ?? "Git Sync is unavailable");
      return;
    }
    setError(null);
    setRepository(body.repository);
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/git-sync", { method: "POST" });
      const body = await response.json().catch(() => null) as GitSyncResponse | null;
      if (!response.ok || !body?.repository) throw new Error(body?.error ?? "Git sync failed");
      setError(null);
      setRepository(body.repository);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Git sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <article className="workspace-dashboard-card dashboard-card-git-sync">
      <div className="workspace-dashboard-card-heading">
        <div><span>Git Sync</span><small>Local source and remote branch</small></div>
        <DashboardGithubIcon />
      </div>
      {repository ? (
        <div className="workspace-git-sync-content">
          <div className={`workspace-git-sync-state state-${repository.state}`}><i />{statusLabel[repository.state]}</div>
          <strong>{repository.branch}</strong>
          <small>{repository.changedFiles.length === 0 ? "Working tree is clean" : `${repository.changedFiles.length} changed ${repository.changedFiles.length === 1 ? "file" : "files"}`}</small>
          <button disabled={syncing || repository.state === "syncing" || repository.changedFiles.length === 0} onClick={() => void sync()} type="button">{syncing ? "Syncing…" : "Sync now"}</button>
          {repository.lastError && <p>{repository.lastError}</p>}
        </div>
      ) : (
        <div className="workspace-git-sync-content unavailable"><strong>Git Sync is not available</strong><small>{error ?? "Configure the local Git Bridge to connect this workspace."}</small></div>
      )}
    </article>
  );
}
