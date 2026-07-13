"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardGithubIcon } from "@/components/Icons";

type RepositoryStatus = { branch: string; canManage: boolean; changedFiles: number; installationReady: boolean; remoteHeadSha: string | null; repository: { defaultBranch: string; fullName: string; lastRemoteCommitSha: string | null } | null; trackedFiles: number };
type AvailableRepository = { defaultBranch: string; id: string; name: string; owner: string; private: boolean };
type RemoteChangePreview = { changes: { conflict: boolean; kind: "added" | "deleted" | "updated"; path: string }[]; conflicts: number; remoteHeadSha: string; summary: { added: number; deleted: number; updated: number } };

async function readResponse(response: Response) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "GitHub request failed");
  return body;
}

export function GitHubRepositoryCard({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [repositories, setRepositories] = useState<AvailableRepository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [branch, setBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("chore: update Slate workspace");
  const [remotePreview, setRemotePreview] = useState<RemoteChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const body = await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github`, { cache: "no-store" })) as RepositoryStatus;
      setStatus(body);
      setError(null);
    } catch (loadError) {
      setStatus(null);
      setError(loadError instanceof Error ? loadError.message : "GitHub status is unavailable");
    }
  }, [workspaceId]);

  const loadRepositories = useCallback(async () => {
    try {
      const body = await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/repositories`, { cache: "no-store" })) as { repositories?: AvailableRepository[] };
      const nextRepositories = Array.isArray(body.repositories) ? body.repositories : [];
      setRepositories(nextRepositories);
      const selected = nextRepositories[0] ?? null;
      if (selected) {
        setSelectedRepositoryId((current) => current || selected.id);
        setBranch((current) => current || selected.defaultBranch);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "GitHub repositories are unavailable");
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 30_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    if (status?.installationReady && !status.repository && status.canManage) void loadRepositories();
  }, [loadRepositories, status?.canManage, status?.installationReady, status?.repository]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setPending(true);
    try {
      await operation();
      await loadStatus();
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "GitHub operation failed");
    } finally {
      setPending(false);
    }
  }, [loadStatus]);

  const connect = useCallback(() => void run(async () => {
    const body = await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/connect`, { method: "POST" })) as { url?: unknown };
    if (typeof body.url !== "string") throw new Error("GitHub connection URL is unavailable");
    window.location.assign(body.url);
  }), [run, workspaceId]);

  const selectRepository = useCallback(() => void run(async () => {
    await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/repositories`, { body: JSON.stringify({ branch, repositoryId: selectedRepositoryId }), headers: { "content-type": "application/json" }, method: "PUT" }));
  }), [branch, run, selectedRepositoryId, workspaceId]);

  const importRepository = useCallback(() => void run(async () => {
    await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/import`, { method: "POST" }));
  }), [run, workspaceId]);

  const checkRemoteChanges = useCallback(() => void run(async () => {
    const preview = await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/refresh`, { cache: "no-store" })) as RemoteChangePreview;
    setRemotePreview(preview);
  }), [run, workspaceId]);

  const applyRemoteChanges = useCallback(() => void run(async () => {
    if (!remotePreview) throw new Error("Check GitHub changes before applying updates");
    await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/refresh`, { body: JSON.stringify({ expectedHeadSha: remotePreview.remoteHeadSha }), headers: { "content-type": "application/json" }, method: "POST" }));
    setRemotePreview(null);
  }), [remotePreview, run, workspaceId]);

  const commit = useCallback(() => void run(async () => {
    if (!status?.remoteHeadSha) throw new Error("Refresh GitHub status before committing");
    await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github/commit`, { body: JSON.stringify({ expectedHeadSha: status.remoteHeadSha, message: commitMessage }), headers: { "content-type": "application/json" }, method: "POST" }));
  }), [commitMessage, run, status?.remoteHeadSha, workspaceId]);

  const disconnect = useCallback(() => void run(async () => {
    await readResponse(await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/github`, { method: "DELETE" }));
    setRepositories([]);
    setSelectedRepositoryId("");
    setBranch("");
    setRemotePreview(null);
  }), [run, workspaceId]);

  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId) ?? null;

  return (
    <article className="workspace-dashboard-card dashboard-card-github-repository">
      <div className="workspace-dashboard-card-heading"><div><span>GitHub repository</span><small>Private repositories through GitHub App</small></div><DashboardGithubIcon /></div>
      {!status ? <div className="workspace-github-repository-content unavailable"><strong>GitHub is unavailable</strong><small>{error ?? "Checking GitHub App status…"}</small></div> : !status.installationReady ? (
        <div className="workspace-github-repository-content"><strong>Connect a private repository</strong><small>GitHub App access is scoped to repositories you select.</small>{status.canManage ? <button disabled={pending} onClick={connect} type="button">Connect GitHub</button> : <small>Only the workspace owner can connect GitHub.</small>}</div>
      ) : !status.repository ? (
        <div className="workspace-github-repository-content"><strong>Choose a repository</strong>{status.canManage ? <><select disabled={pending || repositories.length === 0} onChange={(event) => { const repository = repositories.find((item) => item.id === event.target.value) ?? null; setSelectedRepositoryId(event.target.value); if (repository) setBranch(repository.defaultBranch); }} value={selectedRepositoryId}>{repositories.length === 0 ? <option>Loading repositories…</option> : repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.owner}/{repository.name}{repository.private ? " · private" : ""}</option>)}</select><input disabled={pending || !selectedRepository} onChange={(event) => setBranch(event.target.value)} placeholder="Branch" value={branch} /><button disabled={pending || !selectedRepository || !branch.trim()} onClick={selectRepository} type="button">Link repository</button></> : <small>Only the workspace owner can choose a repository.</small>}</div>
      ) : (
        <div className="workspace-github-repository-content"><strong>{status.repository.fullName}</strong><small>{status.branch} · {status.trackedFiles} tracked {status.trackedFiles === 1 ? "file" : "files"}</small>{status.trackedFiles === 0 ? (status.canManage ? <button disabled={pending} onClick={importRepository} type="button">Import repository</button> : <small>The owner must import the repository.</small>) : <><small>{status.changedFiles === 0 ? "No tracked workspace changes" : `${status.changedFiles} tracked ${status.changedFiles === 1 ? "change" : "changes"}`}</small>{status.canManage && <><button disabled={pending} onClick={checkRemoteChanges} type="button">Check GitHub changes</button>{remotePreview && (remotePreview.changes.length === 0 ? <small>GitHub is up to date</small> : <div className="workspace-github-refresh-controls"><small>{remotePreview.summary.added} added · {remotePreview.summary.updated} updated · {remotePreview.summary.deleted} deleted</small>{remotePreview.conflicts > 0 ? <small>{remotePreview.conflicts} local {remotePreview.conflicts === 1 ? "change conflicts" : "changes conflict"}. Push or resolve them first.</small> : <button disabled={pending} onClick={applyRemoteChanges} type="button">Apply GitHub changes</button>}</div>)}</>}{status.canManage && <div className="workspace-github-commit-controls"><input disabled={pending} maxLength={160} onChange={(event) => setCommitMessage(event.target.value)} value={commitMessage} /><button disabled={pending || status.changedFiles === 0 || !status.remoteHeadSha} onClick={commit} type="button">Commit & push</button></div>}</>}{status.canManage && <button className="workspace-github-disconnect" disabled={pending} onClick={disconnect} type="button">Disconnect GitHub</button>}</div>
      )}
      {error && status && <p className="workspace-github-repository-error">{error}</p>}
    </article>
  );
}
