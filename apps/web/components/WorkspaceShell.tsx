"use client";

import dynamic from "next/dynamic";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/BrandMark";
import { CanvasIcon, CodeIcon, CollapseIcon, CommandIcon, CopyIcon, FileIcon, FilePlusIcon, FolderIcon, FolderPlusIcon, NoteIcon, PanelHideIcon, PanelShowIcon, PlayIcon, RefreshIcon, RenameIcon, SettingsIcon, ShareIcon, TrashIcon, UsersIcon } from "@/components/Icons";
import { DocumentHistoryPanel } from "@/components/DocumentHistoryPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { DocumentSaveQueue, TerminalSaveError } from "@/lib/client/documentSaveQueue";
import { type RealtimeConnectionStatus, getRealtimeStatusDetail, getRealtimeStatusText, isRealtimeRecovering } from "@/lib/client/realtimeConnection";

type PanelTab = "Output" | "Activity" | "Comments" | "AI";
type ExecutionEnvironmentId = "dry-run" | "node-container" | "node-syntax-check";
type JobRunStatus = "completed" | "failed" | "pending" | "running";
type RunState = "idle" | "running" | "done" | "failed";
type SyncState = "offline" | "saved" | "saving";
type WorkspaceTheme = "dark" | "light";
type WorkspaceRole = "owner" | "editor" | "viewer";
type WorkspaceTabType = "code" | "note" | "canvas";
type StarterDocument = {
  description: string;
  fileName: string;
  label: string;
  type: WorkspaceTabType;
};
type RealtimeConnectionSnapshot = {
  documentId: string | null;
  status: RealtimeConnectionStatus;
};
type CommandPaletteItem = {
  disabled?: boolean;
  group: "Commands" | "Search";
  icon: WorkspaceTabType | "command" | "invite" | "run" | "theme";
  id: string;
  label: string;
  meta: string;
  run: () => void;
};

type WorkspaceDocument = {
  canvasState: unknown;
  content: string;
  id: string;
  language: string | null;
  position: number;
  title: string;
  type: WorkspaceTabType;
  updatedAt: string;
};

type WorkspaceMember = {
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
  role: WorkspaceRole;
};

type WorkspaceJobRun = {
  createdAt: string;
  documentTitle: string | null;
  error: string | null;
  id: string;
  kind: string;
  output: string;
  status: JobRunStatus;
};

type ActivityEvent = {
  actorName: string | null;
  createdAt: string;
  documentTitle: string | null;
  id: string;
  metadata: unknown;
  type: string;
};

type DocumentComment = {
  authorName: string;
  body: string;
  createdAt: string;
  documentId: string;
  fileNodeId: string | null;
  id: string;
  resolvedAt: string | null;
  shapeId: string | null;
  updatedAt: string;
};

type WorkspaceFileNode = {
  documentId: string | null;
  id: string;
  kind: "document" | "folder";
  name: string;
  parentId: string | null;
  position: number;
};

type FileCreationDraft = {
  kind: "document" | "folder";
  name: string;
  parentId: string | null;
};

type FileContextMenu = {
  fileNodeId: string;
  x: number;
  y: number;
};

type AccountContextMenu = {
  x: number;
  y: number;
};

type FileDropTarget = {
  fileNodeId: string;
  mode: "after" | "before" | "inside";
};

type WorkspaceSummary = {
  documentCount: number;
  id: string;
  members: WorkspaceMember[];
  name: string;
  slug: string;
};

type WorkspacePayload = {
  activeUser: {
    color: string;
    email: string;
    id: string;
    initials: string;
    name: string;
  };
  activeWorkspace: {
    documents: WorkspaceDocument[];
    fileNodes: WorkspaceFileNode[];
    id: string;
    jobRuns: WorkspaceJobRun[];
    invites: {
      acceptedAt: string | null;
      createdAt: string;
      email: string | null;
      expiresAt: string;
      id: string;
      role: "editor" | "owner" | "viewer";
    }[];
    members: WorkspaceMember[];
    name: string;
    slug: string;
  } | null;
  workspaces: WorkspaceSummary[];
};

const CollaborativeEditor = dynamic(() => import("@/components/CollaborativeEditor").then((module) => module.CollaborativeEditor), {
  ssr: false
});

const CollaborativeCanvas = dynamic(() => import("@/components/CollaborativeCanvas").then((module) => module.CollaborativeCanvas), {
  ssr: false
});

const CollaborativeNote = dynamic(() => import("@/components/CollaborativeNote").then((module) => module.CollaborativeNote), {
  ssr: false
});

const awarenessColors: Record<string, string> = {
  blue: "#3b82f6",
  gray: "#64748b",
  teal: "#14b8a6",
  violet: "#8b5cf6"
};

const executionEnvironments: { id: ExecutionEnvironmentId; label: string }[] = [
  { id: "dry-run", label: "Dry run" },
  { id: "node-container", label: "Node container" },
  { id: "node-syntax-check", label: "Node syntax check" }
];

const starterDocuments: StarterDocument[] = [
  {
    description: "Start from runnable source and keep execution history attached.",
    fileName: "new-file.ts",
    label: "Code",
    type: "code"
  },
  {
    description: "Capture decisions that explain the implementation beside it.",
    fileName: "new-note.md",
    label: "Note",
    type: "note"
  },
  {
    description: "Map flows, ownership, and open questions without leaving the room.",
    fileName: "new-canvas.canvas",
    label: "Canvas",
    type: "canvas"
  }
];

function subscribeWorkspaceClientState(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("storage", callback);
  };
}

function getWorkspaceIdSnapshot() {
  return new URLSearchParams(window.location.search).get("workspaceId");
}

function getServerWorkspaceIdSnapshot() {
  return null;
}

function getThemeSnapshot(): WorkspaceTheme {
  return window.localStorage.getItem("slate-workspace-theme") === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): WorkspaceTheme {
  return "dark";
}

function getCanvasSearchText(canvasState: unknown) {
  if (!canvasState || typeof canvasState !== "object") return "";
  const shapes = (canvasState as { shapes?: unknown }).shapes;
  if (!Array.isArray(shapes)) return "";
  return shapes.flatMap((shape) => {
    if (!shape || typeof shape !== "object") return [];
    const candidate = shape as { name?: unknown; text?: unknown };
    return [candidate.name, candidate.text].filter((value): value is string => typeof value === "string");
  }).join(" ");
}

function runBadgeClass(status: JobRunStatus | RunState) {
  if (status === "completed") return "done";
  if (status === "pending") return "pending";
  return status;
}

function fileNameToDocumentType(fileName: string): WorkspaceTabType {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".canvas")) return "canvas";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) return "note";
  return "code";
}

async function readActionError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export function WorkspaceShell() {
  const queryWorkspaceId = useSyncExternalStore(subscribeWorkspaceClientState, getWorkspaceIdSnapshot, getServerWorkspaceIdSnapshot);
  const storedTheme = useSyncExternalStore(subscribeWorkspaceClientState, getThemeSnapshot, getServerThemeSnapshot);
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<PanelTab>("Output");
  const [runState, setRunState] = useState<RunState>("idle");
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentPending, setCommentPending] = useState(false);
  const [commentActionPendingId, setCommentActionPendingId] = useState<string | null>(null);
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState<ExecutionEnvironmentId>("dry-run");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creationMenuOpen, setCreationMenuOpen] = useState(false);
  const [creationMenuPosition, setCreationMenuPosition] = useState({ left: 0, top: 0 });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteActionPendingId, setInviteActionPendingId] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [gitImportUrl, setGitImportUrl] = useState("");
  const [gitImportError, setGitImportError] = useState<string | null>(null);
  const [gitImportSummary, setGitImportSummary] = useState<string | null>(null);
  const [gitImportPending, setGitImportPending] = useState(false);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [memberActionPendingId, setMemberActionPendingId] = useState<string | null>(null);
  const [selectedFileNodeId, setSelectedFileNodeId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [fileCreationDraft, setFileCreationDraft] = useState<FileCreationDraft | null>(null);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileTreePending, setFileTreePending] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenu | null>(null);
  const [accountContextMenu, setAccountContextMenu] = useState<AccountContextMenu | null>(null);
  const [pendingDeleteFileNode, setPendingDeleteFileNode] = useState<WorkspaceFileNode | null>(null);
  const [draggedFileNodeId, setDraggedFileNodeId] = useState<string | null>(null);
  const [dropTargetFileNode, setDropTargetFileNode] = useState<FileDropTarget | null>(null);
  const [renamingFileNodeId, setRenamingFileNodeId] = useState<string | null>(null);
  const [fileNodeRenameDraft, setFileNodeRenameDraft] = useState("");
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteSelectedIndex, setCommandPaletteSelectedIndex] = useState(0);
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [confirmDeleteFiles, setConfirmDeleteFiles] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>("saved");
  const [realtimeConnection, setRealtimeConnection] = useState<RealtimeConnectionSnapshot>({ documentId: null, status: "idle" });
  const [selectedTheme, setSelectedTheme] = useState<WorkspaceTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const createDocumentButtonRef = useRef<HTMLButtonElement | null>(null);
  const documentSaveQueueRef = useRef<DocumentSaveQueue | null>(null);
  const recoveredWorkspaceIdRef = useRef<string | null>(null);
  if (documentSaveQueueRef.current == null) {
    documentSaveQueueRef.current = new DocumentSaveQueue({
      onSaved: (documentId, document) => {
        setPayload((current) => {
          if (!current?.activeWorkspace) return current;
          return {
            ...current,
            activeWorkspace: {
              ...current.activeWorkspace,
              documents: current.activeWorkspace.documents.map((existingDocument) => (
                existingDocument.id === documentId ? document as WorkspaceDocument : existingDocument
              ))
            }
          };
        });
      },
      onStatusChange: (_documentId, status) => setSyncState(status),
      onTerminalError: (_documentId, message) => {
        setError(message);
        setSyncState("offline");
      },
      send: async (documentId, input) => {
        const requestBody = JSON.stringify(input);
        const response = await fetch(`/api/documents/${documentId}`, {
          body: requestBody,
          headers: { "content-type": "application/json" },
          keepalive: requestBody.length < 60_000,
          method: "PATCH"
        });

        if (!response.ok) {
          const message = await response.text();
          if (response.status === 401 || response.status === 403) throw new TerminalSaveError(message);
          throw new Error(message);
        }

        const responseBody = (await response.json()) as { document: WorkspaceDocument };
        return responseBody.document;
      }
    });
  }

  const requestedWorkspaceId = activeWorkspaceId ?? queryWorkspaceId;
  const theme = selectedTheme ?? storedTheme;
  const activeWorkspace = payload?.activeWorkspace ?? null;
  const documents = useMemo(() => activeWorkspace?.documents ?? [], [activeWorkspace?.documents]);
  const fileNodes = useMemo(() => activeWorkspace?.fileNodes ?? [], [activeWorkspace?.fileNodes]);
  const openedDocuments = useMemo(() => {
    const openIds = new Set(openTabIds);
    return documents.filter((document) => openIds.has(document.id));
  }, [documents, openTabIds]);
  const activeTab = useMemo(() => openedDocuments.find((document) => document.id === activeTabId) ?? null, [activeTabId, openedDocuments]);
  const currentWorkspaceId = activeWorkspace?.id ?? null;
  const currentDocumentId = activeTab?.id ?? null;
  const jobRuns = useMemo(() => activeWorkspace?.jobRuns ?? [], [activeWorkspace?.jobRuns]);
  const selectedRun = useMemo(() => jobRuns.find((run) => run.id === selectedRunId) ?? jobRuns[0] ?? null, [jobRuns, selectedRunId]);
  const activeFileNode = useMemo(() => activeTab ? fileNodes.find((fileNode) => fileNode.documentId === activeTab.id) ?? null : null, [activeTab, fileNodes]);
  const selectedFileNode = useMemo(() => fileNodes.find((fileNode) => fileNode.id === selectedFileNodeId) ?? activeFileNode, [activeFileNode, fileNodes, selectedFileNodeId]);
  const selectedParentId = selectedFileNode?.kind === "folder" ? selectedFileNode.id : selectedFileNode?.parentId ?? null;
  const activePathParts = useMemo(() => {
    if (!activeTab) return [activeWorkspace?.name ?? "Workspace"];
    if (!activeFileNode) return [activeTab.title];

    const parts = [activeFileNode.name];
    let parentId = activeFileNode.parentId;

    while (parentId) {
      const parent = fileNodes.find((fileNode) => fileNode.id === parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }

    return parts;
  }, [activeFileNode, activeTab, activeWorkspace?.name, fileNodes]);
  const fileNodesByParentId = useMemo(() => {
    const nextNodes = new Map<string, WorkspaceFileNode[]>();
    for (const fileNode of fileNodes) {
      const parentKey = fileNode.parentId ?? "root";
      nextNodes.set(parentKey, [...nextNodes.get(parentKey) ?? [], fileNode]);
    }

    for (const [parentKey, childNodes] of nextNodes.entries()) {
      nextNodes.set(parentKey, childNodes.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)));
    }

    return nextNodes;
  }, [fileNodes]);
  const runBadge = runState === "running" ? "queued" : runState === "done" ? "created" : runState === "failed" ? "failed" : "idle";
  const activeMember = activeWorkspace?.members.find((member) => member.id === payload?.activeUser.id) ?? null;
  const canInvite = activeMember?.role === "owner";
  const canEdit = activeMember?.role === "owner" || activeMember?.role === "editor";
  const canManageMembers = activeMember?.role === "owner";
  const shouldAllowPanel = Boolean(activeTab);
  const shouldShowPanel = Boolean(!sidePanelCollapsed && shouldAllowPanel);
  const shouldUseCanvasWorkbench = activeTab?.type === "canvas";
  const statusText = syncState === "saving" ? "Saving" : syncState === "offline" ? "Offline" : "Saved";
  const statusDetail = syncState === "saving" ? "Writing to Postgres" : syncState === "offline" ? "Reconnect required" : "All changes persisted";
  const realtimeState: RealtimeConnectionStatus = realtimeConnection.documentId === currentDocumentId ? realtimeConnection.status : currentDocumentId ? "connecting" : "idle";
  const realtimeStatusText = getRealtimeStatusText(realtimeState);
  const realtimeStatusDetail = getRealtimeStatusDetail(realtimeState);
  const handleRealtimeStatusChange = useCallback((status: RealtimeConnectionStatus) => {
    setRealtimeConnection({ documentId: currentDocumentId, status });
  }, [currentDocumentId]);

  const loadWorkspace = useCallback(async (workspaceId: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const query = workspaceId ? `?workspaceId=${workspaceId}` : "";
      const response = await fetch(`/api/workspaces${query}`, { cache: "no-store" });

      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextPayload = (await response.json()) as WorkspacePayload;
      setPayload(nextPayload);
      setSyncState("saved");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workspace failed to load");
      setSyncState("offline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspace(requestedWorkspaceId);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadWorkspace, requestedWorkspaceId]);

  useEffect(() => {
    if (selectedTheme) {
      window.localStorage.setItem("slate-workspace-theme", selectedTheme);
    }
  }, [selectedTheme]);

  useEffect(() => {
    if (!activeWorkspace || recoveredWorkspaceIdRef.current === activeWorkspace.id) return;
    recoveredWorkspaceIdRef.current = activeWorkspace.id;
    documentSaveQueueRef.current?.recover(activeWorkspace.documents.map((document) => document.id));
  }, [activeWorkspace]);

  useEffect(() => {
    function flushPendingSaves() {
      documentSaveQueueRef.current?.flush();
    }

    window.addEventListener("pagehide", flushPendingSaves);
    return () => window.removeEventListener("pagehide", flushPendingSaves);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          openCommandPalette();
        }
      }

      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setShareOpen(false);
        setUsersOpen(false);
        setSettingsOpen(false);
        setWorkspaceSwitcherOpen(false);
        setCreationMenuOpen(false);
        setFileCreationDraft(null);
        setFileContextMenu(null);
        setAccountContextMenu(null);
        setPendingDeleteFileNode(null);
        setRenamingFileNodeId(null);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [commandPaletteOpen]);

  function openCommandPalette() {
    setCommandPaletteQuery("");
    setCommandPaletteSelectedIndex(0);
    setCommandPaletteOpen(true);
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId);
    setActiveTabId(null);
    setOpenTabIds([]);
    setSelectedFileNodeId(null);
    setOutputLines([]);
    setRunState("idle");
  }

  function selectDocument(tabId: string) {
    const fileNode = fileNodes.find((node) => node.documentId === tabId) ?? null;
    setOpenTabIds((current) => current.includes(tabId) ? current : [...current, tabId]);
    setActiveTabId(tabId);
    setSelectedFileNodeId(fileNode?.id ?? null);
    setOutputLines([]);
    setRunState("idle");
  }

  function closeDocumentTab(tabId: string) {
    const nextOpenTabIds = openTabIds.filter((openTabId) => openTabId !== tabId);
    setOpenTabIds(nextOpenTabIds);

    if (activeTabId !== tabId) return;

    const closedIndex = openTabIds.indexOf(tabId);
    const nextActiveTabId = nextOpenTabIds[closedIndex] ?? nextOpenTabIds[closedIndex - 1] ?? null;
    const nextFileNode = nextActiveTabId ? fileNodes.find((node) => node.documentId === nextActiveTabId) ?? null : null;
    setActiveTabId(nextActiveTabId);
    setSelectedFileNodeId(nextFileNode?.id ?? null);
    setOutputLines([]);
    setRunState("idle");
  }

  function toggleCreationMenu() {
    const rect = createDocumentButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      setCreationMenuOpen(false);
      return;
    }

    setCreationMenuPosition({ left: rect.left, top: rect.bottom + 4 });
    setCreationMenuOpen((open) => !open);
  }

  function selectFileNode(fileNode: WorkspaceFileNode) {
    setSelectedFileNodeId(fileNode.id);
    setFileTreeError(null);

    if (fileNode.kind === "folder") {
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        if (next.has(fileNode.id)) {
          next.delete(fileNode.id);
        } else {
          next.add(fileNode.id);
        }
        return next;
      });
      return;
    }

    if (fileNode.documentId) {
      selectDocument(fileNode.documentId);
    }
  }

  const ignoreDocumentPresence = useCallback(() => undefined, []);

  async function createWorkspace() {
    if (workspaceCreating) return;

    setWorkspaceCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces", { method: "POST" });

      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }

      if (!response.ok) {
        setError(await readActionError(response, "Workspace creation failed"));
        return;
      }

      const nextPayload = (await response.json()) as WorkspacePayload;
      const nextWorkspace = nextPayload.activeWorkspace;
      setPayload(nextPayload);
      setActiveWorkspaceId(nextWorkspace?.id ?? null);
      setActiveTabId(null);
      setOpenTabIds([]);
      setSelectedFileNodeId(null);
      setSyncState("saved");
      setCreationMenuOpen(false);
      setShareOpen(false);
    } catch (workspaceCreateError) {
      setError(workspaceCreateError instanceof Error ? workspaceCreateError.message : "Workspace creation failed");
      setSyncState("offline");
    } finally {
      setWorkspaceCreating(false);
    }
  }

  function beginFileCreation(kind: "document" | "folder", parentIdOverride?: string | null, initialName?: string) {
    if (!activeWorkspace || !canEdit || fileTreePending) return;

    const parentId = parentIdOverride === undefined ? selectedParentId : parentIdOverride;
    setFileCreationDraft({
      kind,
      name: initialName ?? (kind === "folder" ? "new-folder" : "new-file.ts"),
      parentId
    });
    setFileTreeError(null);
    setFileContextMenu(null);
    setCreationMenuOpen(false);

    if (parentId) {
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        next.add(parentId);
        return next;
      });
    }
  }

  async function createFileNode(kind: "document" | "folder", name: string, parentId: string | null) {
    if (!activeWorkspace || !canEdit || fileTreePending) return;

    setFileTreePending(true);
    setFileTreeError(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/file-nodes`, {
        body: JSON.stringify({
          kind,
          name,
          parentId
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        setFileTreeError(await readActionError(response, "File tree update failed"));
        return false;
      }

      const body = (await response.json()) as { document: WorkspaceDocument | null; fileNode: WorkspaceFileNode };
      const createdDocument = body.document;
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            documents: createdDocument ? [...current.activeWorkspace.documents, createdDocument] : current.activeWorkspace.documents,
            fileNodes: [...current.activeWorkspace.fileNodes, body.fileNode]
          },
          workspaces: current.workspaces.map((workspace) => (
            workspace.id === activeWorkspace.id && createdDocument ? { ...workspace, documentCount: workspace.documentCount + 1 } : workspace
          ))
        };
      });
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        if (body.fileNode.parentId) next.add(body.fileNode.parentId);
        return next;
      });
      setSelectedFileNodeId(body.fileNode.id);
      if (createdDocument) {
        setOpenTabIds((current) => current.includes(createdDocument.id) ? current : [...current, createdDocument.id]);
        setActiveTabId(createdDocument.id);
      }
      return true;
    } catch (fileTreeUpdateError) {
      setFileTreeError(fileTreeUpdateError instanceof Error ? fileTreeUpdateError.message : "File tree update failed");
      return false;
    } finally {
      setFileTreePending(false);
    }
  }

  async function commitFileCreation() {
    if (!fileCreationDraft || fileTreePending) return;

    const name = fileCreationDraft.name.trim();
    if (!name) {
      setFileCreationDraft(null);
      return;
    }

    const created = await createFileNode(fileCreationDraft.kind, name, fileCreationDraft.parentId);
    if (created) setFileCreationDraft(null);
  }

  function beginRenameFileNode(fileNode = selectedFileNode) {
    if (!fileNode || !canEdit) return;
    setSelectedFileNodeId(fileNode.id);
    setRenamingFileNodeId(fileNode.id);
    setFileNodeRenameDraft(fileNode.name);
    setFileTreeError(null);
    setFileContextMenu(null);
  }

  async function renameFileNode() {
    const fileNode = fileNodes.find((node) => node.id === renamingFileNodeId) ?? selectedFileNode;
    if (!fileNode || !canEdit || fileTreePending) return;

    setFileTreePending(true);
    setFileTreeError(null);

    try {
      const response = await fetch(`/api/file-nodes/${fileNode.id}`, {
        body: JSON.stringify({ name: fileNodeRenameDraft }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });

      if (!response.ok) {
        setFileTreeError(await readActionError(response, "Rename failed"));
        return;
      }

      const body = (await response.json()) as { document: WorkspaceDocument | null; fileNode: WorkspaceFileNode };
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            documents: body.document
              ? current.activeWorkspace.documents.map((document) => document.id === body.document?.id ? body.document : document)
              : current.activeWorkspace.documents,
            fileNodes: current.activeWorkspace.fileNodes.map((fileNode) => fileNode.id === body.fileNode.id ? body.fileNode : fileNode)
          }
        };
      });
      setRenamingFileNodeId(null);
      setFileNodeRenameDraft("");
    } catch (renameError) {
      setFileTreeError(renameError instanceof Error ? renameError.message : "Rename failed");
    } finally {
      setFileTreePending(false);
    }
  }

  function requestDeleteFileNode(fileNode = selectedFileNode) {
    if (!fileNode || !canEdit || fileTreePending) return;
    setFileContextMenu(null);
    if (confirmDeleteFiles) {
      setPendingDeleteFileNode(fileNode);
      return;
    }
    void confirmDeleteFileNode(fileNode);
  }

  async function confirmDeleteFileNode(fileNode = pendingDeleteFileNode) {
    if (!activeWorkspace || !fileNode || !canEdit || fileTreePending) return;

    const workspaceId = activeWorkspace.id;
    setFileTreePending(true);
    setFileTreeError(null);
    setFileContextMenu(null);

    try {
      const response = await fetch(`/api/file-nodes/${fileNode.id}`, { method: "DELETE" });

      if (!response.ok) {
        setFileTreeError(await readActionError(response, "Delete failed"));
        return;
      }

      const body = (await response.json()) as { documentIds: string[]; fileNodeIds: string[] };
      const deletedDocumentIds = new Set(body.documentIds);
      const deletedFileNodeIds = new Set(body.fileNodeIds);
      const remainingOpenTabIds = openTabIds.filter((tabId) => !deletedDocumentIds.has(tabId));
      const nextActiveTabId = activeTab && deletedDocumentIds.has(activeTab.id) ? remainingOpenTabIds[0] ?? null : activeTabId;
      const nextActiveFileNode = nextActiveTabId ? fileNodes.find((fileNode) => fileNode.documentId === nextActiveTabId) ?? null : null;
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            documents: current.activeWorkspace.documents.filter((document) => !deletedDocumentIds.has(document.id)),
            fileNodes: current.activeWorkspace.fileNodes.filter((fileNode) => !deletedFileNodeIds.has(fileNode.id))
          },
          workspaces: current.workspaces.map((workspace) => (
            workspace.id === workspaceId ? { ...workspace, documentCount: Math.max(0, workspace.documentCount - body.documentIds.length) } : workspace
          ))
        };
      });
      setOpenTabIds(remainingOpenTabIds);
      setSelectedFileNodeId(nextActiveFileNode?.id ?? null);
      setActiveTabId(nextActiveTabId);
      setPendingDeleteFileNode(null);
    } catch (deleteError) {
      setFileTreeError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setFileTreePending(false);
    }
  }

  function isFileNodeDescendant(fileNodeId: string, possibleDescendantId: string) {
    let current = fileNodes.find((fileNode) => fileNode.id === possibleDescendantId) ?? null;

    while (current?.parentId) {
      if (current.parentId === fileNodeId) return true;
      current = fileNodes.find((fileNode) => fileNode.id === current?.parentId) ?? null;
    }

    return false;
  }

  function getFileDropTarget(event: DragEvent<HTMLElement>, fileNode: WorkspaceFileNode): FileDropTarget {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const upper = rect.height * 0.32;
    const lower = rect.height * 0.68;

    if (y < upper) return { fileNodeId: fileNode.id, mode: "before" };
    if (y > lower) return { fileNodeId: fileNode.id, mode: "after" };
    return { fileNodeId: fileNode.id, mode: fileNode.kind === "folder" ? "inside" : "after" };
  }

  function canDropFileNode(draggedId: string | null, target: WorkspaceFileNode | null, mode: FileDropTarget["mode"]) {
    if (!draggedId || !target) return false;
    if (draggedId === target.id) return false;

    const draggedNode = fileNodes.find((fileNode) => fileNode.id === draggedId);
    if (!draggedNode) return false;
    if (mode === "inside" && target.kind !== "folder") return false;
    if (mode === "inside" && draggedNode.parentId === target.id) return false;
    if (mode === "before" && draggedNode.parentId === target.parentId && draggedNode.position + 1 === target.position) return false;
    if (mode === "after" && draggedNode.parentId === target.parentId && draggedNode.position === target.position + 1) return false;
    if (draggedNode.kind === "folder" && (mode === "inside" ? isFileNodeDescendant(draggedNode.id, target.id) : isFileNodeDescendant(draggedNode.id, target.parentId ?? ""))) return false;

    return true;
  }

  function fileNodePath(fileNode: WorkspaceFileNode) {
    const parts = [fileNode.name];
    let parentId = fileNode.parentId;

    while (parentId) {
      const parent = fileNodes.find((node) => node.id === parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }

    return parts.join("/");
  }

  async function copyFileNodePath(fileNode: WorkspaceFileNode) {
    await window.navigator.clipboard.writeText(fileNodePath(fileNode)).catch(() => undefined);
    setFileContextMenu(null);
  }

  async function moveFileNode(fileNodeId: string, parentId: string | null, position: number | null) {
    if (!canEdit || fileTreePending) return;

    setFileTreePending(true);
    setFileTreeError(null);

    try {
      const response = await fetch(`/api/file-nodes/${fileNodeId}`, {
        body: JSON.stringify({ parentId, position }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });

      if (!response.ok) {
        setFileTreeError(await readActionError(response, "Move failed"));
        return;
      }

      const body = (await response.json()) as { fileNode?: WorkspaceFileNode; fileNodes?: WorkspaceFileNode[] };
      const updatedFileNodes = body.fileNodes ?? (body.fileNode ? [body.fileNode] : []);
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        const updatedById = new Map(updatedFileNodes.map((fileNode) => [fileNode.id, fileNode]));
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            fileNodes: current.activeWorkspace.fileNodes.map((fileNode) => updatedById.get(fileNode.id) ?? fileNode)
          }
        };
      });
      const movedNode = updatedFileNodes.find((node) => node.id === fileNodeId);
      if (movedNode?.parentId) {
        setExpandedFolderIds((current) => {
          const next = new Set(current);
          if (movedNode.parentId) next.add(movedNode.parentId);
          return next;
        });
      }
    } catch (moveError) {
      setFileTreeError(moveError instanceof Error ? moveError.message : "Move failed");
    } finally {
      setFileTreePending(false);
      setDraggedFileNodeId(null);
      setDropTargetFileNode(null);
    }
  }

  function saveDocument(documentId: string, input: { canvasState?: unknown; content?: string; title?: string }) {
    if (!canEdit) return;
    documentSaveQueueRef.current?.enqueue(documentId, input);
  }

  async function refreshRunHistory(workspaceId: string) {
    const response = await fetch(`/api/jobs/runs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { runs: WorkspaceJobRun[] };
    setPayload((current) => {
      if (!current?.activeWorkspace || current.activeWorkspace.id !== workspaceId) return current;
      return {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          jobRuns: body.runs
        }
      };
    });
    return body.runs;
  }

  const refreshActivity = useCallback(async (workspaceId: string) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/activity`, { cache: "no-store" });
    if (!response.ok) {
      setActivityError(await readActionError(response, "Activity failed to load"));
      return;
    }
    const body = (await response.json()) as { events: ActivityEvent[] };
    setActivityEvents(body.events);
    setActivityError(null);
  }, []);

  const refreshComments = useCallback(async (documentId: string) => {
    const response = await fetch(`/api/documents/${documentId}/comments`, { cache: "no-store" });
    if (!response.ok) {
      setCommentError(await readActionError(response, "Comments failed to load"));
      return;
    }
    const body = (await response.json()) as { comments: DocumentComment[] };
    setComments(body.comments);
    setCommentError(null);
  }, []);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    const timer = window.setTimeout(() => {
      void refreshActivity(currentWorkspaceId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentWorkspaceId, refreshActivity]);

  useEffect(() => {
    if (!currentDocumentId) return;
    const timer = window.setTimeout(() => {
      void refreshComments(currentDocumentId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentDocumentId, refreshComments]);

  async function createComment() {
    if (!activeTab || !canEdit || commentPending) return;
    setCommentPending(true);
    setCommentError(null);

    try {
      const response = await fetch(`/api/documents/${activeTab.id}/comments`, {
        body: JSON.stringify({ body: commentDraft }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        setCommentError(await readActionError(response, "Comment creation failed"));
        return;
      }

      const body = (await response.json()) as { comment: DocumentComment };
      setComments((current) => [body.comment, ...current]);
      setCommentDraft("");
      if (activeWorkspace) void refreshActivity(activeWorkspace.id);
    } catch (commentCreateError) {
      setCommentError(commentCreateError instanceof Error ? commentCreateError.message : "Comment creation failed");
    } finally {
      setCommentPending(false);
    }
  }

  async function setCommentResolved(commentId: string, resolved: boolean) {
    if (!canEdit || commentActionPendingId) return;
    setCommentActionPendingId(commentId);
    setCommentError(null);

    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        body: JSON.stringify({ resolved }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });

      if (!response.ok) {
        setCommentError(await readActionError(response, "Comment update failed"));
        return;
      }

      const body = (await response.json()) as { comment: DocumentComment };
      setComments((current) => current.map((comment) => comment.id === body.comment.id ? body.comment : comment));
      if (activeWorkspace) void refreshActivity(activeWorkspace.id);
    } catch (commentUpdateError) {
      setCommentError(commentUpdateError instanceof Error ? commentUpdateError.message : "Comment update failed");
    } finally {
      setCommentActionPendingId(null);
    }
  }

  function applyRestoredDocument(restoredDocument: unknown) {
    setPayload((current) => {
      if (!current?.activeWorkspace) return current;
      const nextDocument = restoredDocument as WorkspaceDocument;
      return {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          documents: current.activeWorkspace.documents.map((document) => (
            document.id === nextDocument.id ? nextDocument : document
          ))
        }
      };
    });
  }

  async function copyInvite(link = inviteLink) {
    if (!link) return;
    await window.navigator.clipboard.writeText(link).catch(() => undefined);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1400);
  }

  function inviteTeammates() {
    setShareOpen(true);
    setUsersOpen(false);
  }

  async function createInvite() {
    if (!activeWorkspace || inviteSubmitting || !canInvite) return;
    setInviteSubmitting(true);
    setInviteError(null);

    const response = await fetch(`/api/workspaces/${activeWorkspace.id}/invites`, {
      body: JSON.stringify({
        email: inviteEmail,
        role: inviteRole
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    const body = await response.json().catch(() => ({ error: "Invite creation failed" }));

    if (!response.ok) {
      setInviteError(typeof body.error === "string" ? body.error : "Invite creation failed");
      setInviteSubmitting(false);
      return;
    }

    setInviteLink(body.url);
    setInviteEmail("");
    setPayload((current) => {
      if (!current?.activeWorkspace) return current;
      return {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          invites: [body.invite, ...current.activeWorkspace.invites]
        }
      };
    });
    await copyInvite(body.url);
    setInviteSubmitting(false);
  }

  async function revokeInvite(inviteId: string) {
    if (!activeWorkspace || !canInvite || inviteActionPendingId) return;
    setInviteActionPendingId(inviteId);
    setInviteError(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/invites/${inviteId}`, { method: "DELETE" });

      if (!response.ok) {
        setInviteError(await readActionError(response, "Invite revoke failed"));
        return;
      }

      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            invites: current.activeWorkspace.invites.filter((invite) => invite.id !== inviteId)
          }
        };
      });
    } catch (inviteRevokeError) {
      setInviteError(inviteRevokeError instanceof Error ? inviteRevokeError.message : "Invite revoke failed");
    } finally {
      setInviteActionPendingId(null);
    }
  }

  async function updateMemberRole(memberId: string, role: WorkspaceRole) {
    if (!activeWorkspace || !canManageMembers || memberActionPendingId) return;
    setMemberActionPendingId(memberId);
    setMemberActionError(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/members/${memberId}`, {
        body: JSON.stringify({ role }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });

      if (!response.ok) {
        setMemberActionError(await readActionError(response, "Member update failed"));
        return;
      }

      const body = (await response.json()) as { member: WorkspaceMember };
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            members: current.activeWorkspace.members.map((member) => member.id === body.member.id ? body.member : member)
          },
          workspaces: current.workspaces.map((workspace) => (
            workspace.id === activeWorkspace.id
              ? { ...workspace, members: workspace.members.map((member) => member.id === body.member.id ? body.member : member) }
              : workspace
          ))
        };
      });
    } catch (memberError) {
      setMemberActionError(memberError instanceof Error ? memberError.message : "Member update failed");
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!activeWorkspace || !canManageMembers || memberActionPendingId) return;

    const confirmed = window.confirm(`Remove ${member.name} from this workspace?`);
    if (!confirmed) return;

    setMemberActionPendingId(member.id);
    setMemberActionError(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/members/${member.id}`, { method: "DELETE" });

      if (!response.ok) {
        setMemberActionError(await readActionError(response, "Member removal failed"));
        return;
      }

      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            members: current.activeWorkspace.members.filter((workspaceMember) => workspaceMember.id !== member.id)
          },
          workspaces: current.workspaces.map((workspace) => (
            workspace.id === activeWorkspace.id
              ? { ...workspace, members: workspace.members.filter((workspaceMember) => workspaceMember.id !== member.id) }
              : workspace
          ))
        };
      });
    } catch (memberError) {
      setMemberActionError(memberError instanceof Error ? memberError.message : "Member removal failed");
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function importGitRepository() {
    if (!activeWorkspace || !canEdit || gitImportPending) return;

    setGitImportPending(true);
    setGitImportError(null);
    setGitImportSummary(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/imports/git`, {
        body: JSON.stringify({ url: gitImportUrl }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        setGitImportError(await readActionError(response, "Git import failed"));
        return;
      }

      const body = (await response.json()) as { documents: WorkspaceDocument[]; summary?: { importedFiles: number; scannedFiles: number; skippedFiles: number } };
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            documents: [...current.activeWorkspace.documents, ...body.documents]
          },
          workspaces: current.workspaces.map((workspace) => (
            workspace.id === activeWorkspace.id ? { ...workspace, documentCount: workspace.documentCount + body.documents.length } : workspace
          ))
        };
      });
      setActiveTabId(body.documents[0]?.id ?? activeTabId);
      if (body.summary) {
        setGitImportSummary(`${body.summary.importedFiles} imported · ${body.summary.skippedFiles} skipped · ${body.summary.scannedFiles} scanned`);
      }
      setGitImportUrl("");
      void loadWorkspace(activeWorkspace.id);
    } catch (importError) {
      setGitImportError(importError instanceof Error ? importError.message : "Git import failed");
    } finally {
      setGitImportPending(false);
    }
  }

  async function runActiveDocument() {
    if (!activeTab || !canEdit || runState === "running" || activeTab.type !== "code") return;
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) return;
    setActivePanel("Output");
    setRunState("running");
    setOutputLines([`$ slate run ${activeTab.title}`, `environment=${selectedExecutionEnvironmentId}`, "creating BullMQ job"]);

    const response = await fetch("/api/jobs/runs", {
      body: JSON.stringify({ documentId: activeTab.id, environmentId: selectedExecutionEnvironmentId }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      setRunState("failed");
      const message = await response.text();
      setOutputLines((current) => [...current, message]);
      return;
    }

    const body = (await response.json()) as { run: WorkspaceJobRun };
    setSelectedRunId(body.run.id);
    setOutputLines((current) => [...current, `job ${body.run.id} queued`, body.run.output]);
    let latestRuns = await refreshRunHistory(workspaceId);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const latestRun = latestRuns.find((run) => run.id === body.run.id);
      if (latestRun?.status === "completed" || latestRun?.status === "failed") break;
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      latestRuns = await refreshRunHistory(workspaceId);
    }

    const finalRun = latestRuns.find((run) => run.id === body.run.id);
    setRunState(finalRun?.status === "failed" ? "failed" : finalRun?.status === "completed" ? "done" : "idle");
  }

  function runCommand(action: () => void) {
    action();
    setCommandPaletteOpen(false);
  }

  function runPaletteItem(item: CommandPaletteItem | undefined) {
    if (!item || item.disabled) return;
    runCommand(item.run);
  }

  function renderCommandIcon(icon: CommandPaletteItem["icon"]) {
    if (icon === "canvas") return <CanvasIcon />;
    if (icon === "code") return <CodeIcon />;
    if (icon === "note") return <NoteIcon />;
    if (icon === "invite") return <UsersIcon />;
    if (icon === "run") return <PlayIcon />;
    return <CommandIcon />;
  }

  function documentTypeForFileNode(fileNode: WorkspaceFileNode) {
    const document = fileNode.documentId ? documents.find((candidate) => candidate.id === fileNode.documentId) ?? null : null;
    return document?.type ?? null;
  }

  function renderDocumentTypeIcon(type: WorkspaceTabType | null) {
    if (type === "canvas") return <CanvasIcon />;
    if (type === "code") return <CodeIcon />;
    if (type === "note") return <NoteIcon />;
    return <FileIcon />;
  }

  function renderStarterPreview(type: WorkspaceTabType) {
    if (type === "code") {
      return (
        <div className="starter-preview starter-preview-code">
          <span>const room = slate.workspace()</span>
          <span>await room.run(checkout.ts)</span>
          <span>history.attach(output)</span>
        </div>
      );
    }

    if (type === "note") {
      return (
        <div className="starter-preview starter-preview-note">
          <b>Decision</b>
          <span>Retry policy lives with gateway code.</span>
          <span>- owner: api</span>
          <span>- risk: duplicate charge</span>
        </div>
      );
    }

    return (
      <div className="starter-preview starter-preview-canvas">
        <i />
        <i />
        <i />
        <span />
      </div>
    );
  }

  function activityLabel(event: ActivityEvent) {
    const labels: Record<string, string> = {
      "document.created": "created a document",
      "document.deleted": "deleted a document",
      "document.renamed": "renamed a document",
      "document.restored": "restored a document",
      "comment.created": "commented on a document",
      "comment.reopened": "reopened a comment",
      "comment.resolved": "resolved a comment",
      "file.deleted": "deleted a file tree item",
      "file.folder_created": "created a folder",
      "file.moved": "moved a file tree item",
      "file.renamed": "renamed a file tree item",
      "git_import.completed": "completed a GitHub import",
      "invite.accepted": "accepted an invite",
      "invite.created": "created an invite",
      "invite.revoked": "revoked an invite",
      "member.removed": "removed a member",
      "member.role_changed": "changed a member role",
      "run.completed": "completed a run",
      "run.failed": "failed a run",
      "run.queued": "queued a run"
    };

    return labels[event.type] ?? event.type.replace(/\./g, " ");
  }

  function buildCommandPaletteItems() {
    const query = commandPaletteQuery.trim().toLowerCase();
    const items: CommandPaletteItem[] = [];

    if (canEdit) {
      items.push({ group: "Commands", icon: "note", id: "create-note", label: "Create note", meta: "Document", run: () => beginFileCreation("document", undefined, "new-note.md") });
      items.push({ group: "Commands", icon: "code", id: "create-code", label: "Create code file", meta: "Document", run: () => beginFileCreation("document", undefined, "new-file.ts") });
      items.push({ group: "Commands", icon: "canvas", id: "create-canvas", label: "Create canvas", meta: "Document", run: () => beginFileCreation("document", undefined, "new-canvas.canvas") });
    }

    items.push({ disabled: !activeWorkspace, group: "Commands", icon: "invite", id: "invite", label: "Invite teammate", meta: "Workspace", run: inviteTeammates });
    items.push({ group: "Commands", icon: "theme", id: "switch-theme", label: "Switch theme", meta: theme === "dark" ? "Light" : "Dark", run: toggleTheme });
    items.push({ disabled: !activeTab || !canEdit || activeTab.type !== "code" || runState === "running", group: "Commands", icon: "run", id: "run-current-file", label: "Run current file", meta: activeTab?.title ?? "No file", run: () => void runActiveDocument() });
    items.push({ disabled: !activeTab || activeTab.type !== "canvas" || !canEdit, group: "Commands", icon: "canvas", id: "toggle-canvas-snap", label: "Toggle snap", meta: activeTab?.type === "canvas" ? activeTab.title : "Canvas only", run: toggleActiveCanvasSnap });

    for (const document of documents) {
      const fileNode = fileNodes.find((node) => node.documentId === document.id) ?? null;
      const content = document.type === "canvas" ? getCanvasSearchText(document.canvasState) : document.content;
      const haystack = [document.title, fileNode?.name, content].filter(Boolean).join(" ").toLowerCase();
      if (query && !haystack.includes(query)) continue;
      items.push({
        group: "Search",
        icon: document.type,
        id: `open-${document.id}`,
        label: document.title,
        meta: fileNode ? fileNodePath(fileNode) : document.type,
        run: () => selectDocument(document.id)
      });
    }

    if (!query) return items;
    return items.filter((item) => `${item.label} ${item.meta} ${item.group}`.toLowerCase().includes(query) || item.group === "Search");
  }

  function toggleTheme() {
    setSelectedTheme((currentTheme) => {
      const currentResolvedTheme = currentTheme ?? storedTheme;
      return currentResolvedTheme === "dark" ? "light" : "dark";
    });
  }

  function toggleActiveCanvasSnap() {
    if (!activeTab || activeTab.type !== "canvas") return;
    window.dispatchEvent(new CustomEvent("slate:canvas-command", {
      detail: {
        canvasId: activeTab.id,
        command: "toggleSnap"
      }
    }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }

  function renderFileCreationDraft(parentId: string | null, depth: number) {
    if (fileCreationDraft?.parentId !== parentId) return null;
    const draftType = fileCreationDraft.kind === "folder" ? null : fileNameToDocumentType(fileCreationDraft.name);

    return (
      <div className={`tree-node-draft ${draftType ? `document-type-${draftType}` : ""}`} style={{ paddingLeft: 24 + depth * 14 }}>
        {fileCreationDraft.kind === "folder" ? <FolderIcon /> : renderDocumentTypeIcon(draftType)}
        <input
          aria-label={fileCreationDraft.kind === "folder" ? "New folder name" : "New file name"}
          autoFocus
          disabled={fileTreePending}
          onBlur={() => setFileCreationDraft(null)}
          onChange={(event) => setFileCreationDraft((current) => current ? { ...current, name: event.target.value } : current)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitFileCreation();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setFileCreationDraft(null);
            }
          }}
          spellCheck={false}
          value={fileCreationDraft.name}
        />
      </div>
    );
  }

  function renderFileNodes(parentId: string | null, depth = 0) {
    const childNodes = fileNodesByParentId.get(parentId ?? "root") ?? [];

    return (
      <>
        {renderFileCreationDraft(parentId, depth)}
        {childNodes.map((fileNode) => {
      const isSelected = selectedFileNode?.id === fileNode.id;
      const isActive = activeFileNode?.id === fileNode.id;
      const isExpanded = expandedFolderIds.has(fileNode.id);
      const documentType = fileNode.kind === "folder" ? null : documentTypeForFileNode(fileNode);
      const activeDropMode = dropTargetFileNode?.fileNodeId === fileNode.id ? dropTargetFileNode.mode : null;
      const isDropTarget = Boolean(activeDropMode && canDropFileNode(draggedFileNodeId, fileNode, activeDropMode));
      const label = fileNode.kind === "folder" ? (isExpanded ? "v" : ">") : ".";

      return (
        <div className="tree-node-group" key={fileNode.id}>
          {renamingFileNodeId === fileNode.id ? (
            <div className={`tree-node-draft ${documentType ? `document-type-${documentType}` : ""}`} style={{ paddingLeft: 24 + depth * 14 }}>
              {fileNode.kind === "folder" ? <FolderIcon /> : renderDocumentTypeIcon(documentType)}
              <input
                aria-label="Rename file node"
                autoFocus
                disabled={fileTreePending}
                onBlur={() => {
                  setRenamingFileNodeId(null);
                  setFileNodeRenameDraft("");
                }}
                onChange={(event) => setFileNodeRenameDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void renameFileNode();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingFileNodeId(null);
                    setFileNodeRenameDraft("");
                  }
                }}
                spellCheck={false}
                value={fileNodeRenameDraft}
              />
            </div>
          ) : (
            <button
              className={[
                "tree-node",
                documentType ? `document-type-${documentType}` : "",
                isSelected || isActive ? "active" : "",
                isDropTarget ? "drop-target" : "",
                isDropTarget && activeDropMode ? `drop-target-${activeDropMode}` : ""
              ].filter(Boolean).join(" ")}
              draggable={canEdit}
              onClick={() => selectFileNode(fileNode)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedFileNodeId(fileNode.id);
                setFileContextMenu({ fileNodeId: fileNode.id, x: event.clientX, y: event.clientY });
              }}
              onDragEnd={() => {
                setDraggedFileNodeId(null);
                setDropTargetFileNode(null);
              }}
              onDragEnter={(event) => {
                const target = getFileDropTarget(event, fileNode);
                if (!canDropFileNode(draggedFileNodeId, fileNode, target.mode)) return;
                event.preventDefault();
                setDropTargetFileNode(target);
              }}
              onDragOver={(event) => {
                const target = getFileDropTarget(event, fileNode);
                if (!canDropFileNode(draggedFileNodeId, fileNode, target.mode)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetFileNode(target);
              }}
              onDragStart={(event) => {
                if (!canEdit) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", fileNode.id);
                setDraggedFileNodeId(fileNode.id);
              }}
              onDrop={(event) => {
                const target = getFileDropTarget(event, fileNode);
                if (!canDropFileNode(draggedFileNodeId, fileNode, target.mode)) return;
                event.preventDefault();
                if (draggedFileNodeId) {
                  const parentId = target.mode === "inside" ? fileNode.id : fileNode.parentId;
                  const position = target.mode === "before" ? fileNode.position : target.mode === "after" ? fileNode.position + 1 : null;
                  void moveFileNode(draggedFileNodeId, parentId, position);
                }
              }}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <span>{label}</span>
              {fileNode.kind === "folder" ? <FolderIcon /> : renderDocumentTypeIcon(documentType)}
              <strong>{fileNode.name}</strong>
            </button>
          )}
          {fileNode.kind === "folder" && isExpanded && renderFileNodes(fileNode.id, depth + 1)}
        </div>
      );
        })}
      </>
    );
  }

  if (loading && !payload) {
    return (
      <main className="workspace-shell" data-theme={theme}>
        <section className="workspace-main">
          <div className="empty-room">
            <div className="empty-room-icon">...</div>
            <h1>Loading workspace</h1>
            <p>Connecting to Postgres-backed workspace data.</p>
          </div>
        </section>
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main className="workspace-shell" data-theme={theme}>
        <section className="workspace-main">
          <div className="empty-room">
            <div className="empty-room-icon">!</div>
            <h1>Workspace backend is not ready</h1>
            <p>{error}</p>
          </div>
        </section>
      </main>
    );
  }

  const contextFileNode = fileContextMenu ? fileNodes.find((fileNode) => fileNode.id === fileContextMenu.fileNodeId) ?? null : null;
  const contextParentId = contextFileNode?.kind === "folder" ? contextFileNode.id : contextFileNode?.parentId ?? null;
  const commandPaletteItems = buildCommandPaletteItems();
  const enabledCommandPaletteItems = commandPaletteItems.filter((item) => !item.disabled);
  const terminalLines = selectedRun?.output ? selectedRun.output.split(/\r?\n/) : outputLines;
  const panelTabs: PanelTab[] = activeTab?.type === "code" ? ["Output", "Activity", "Comments", "AI"] : ["Activity", "Comments", "AI"];
  const selectedPanel = panelTabs.includes(activePanel) ? activePanel : panelTabs[0];
  const canSwitchWorkspace = (payload?.workspaces.length ?? 0) > 1;

  return (
    <main className="workspace-shell" data-theme={theme}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand-row">
          <BrandMark href="/" />
          <button className="workspace-switcher" disabled={!canSwitchWorkspace} onClick={() => setWorkspaceSwitcherOpen((open) => canSwitchWorkspace ? !open : false)} title={canSwitchWorkspace ? "Switch workspace" : "No other workspaces available"} type="button">
            {activeWorkspace?.slug ?? "Switch workspace"}
          </button>
          {workspaceSwitcherOpen && canSwitchWorkspace && (
            <div className="workspace-switcher-menu">
              {payload?.workspaces.map((workspace) => (
                <button className={workspace.id === activeWorkspace?.id ? "active" : ""} key={workspace.id} onClick={() => { selectWorkspace(workspace.id); setWorkspaceSwitcherOpen(false); }}>
                  <span>{workspace.name}</span>
                  <small>{workspace.documentCount} docs</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <section className="sidebar-section file-section">
          <div className="explorer-header">
            <div className="explorer-actions">
              <div className="sidebar-document-create">
                <button aria-label="Create document" disabled={!activeWorkspace || !canEdit} onClick={toggleCreationMenu} ref={createDocumentButtonRef} title="Create document">
                  <FilePlusIcon />
                </button>
                {creationMenuOpen && (
                  <div className="create-menu" style={{ left: creationMenuPosition.left, top: creationMenuPosition.top }}>
                    <button aria-label="Create code tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-file.ts")}><CodeIcon />Code file</button>
                    <button aria-label="Create note tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-note.md")}><NoteIcon />Note</button>
                    <button aria-label="Create canvas tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-canvas.canvas")}><CanvasIcon />Canvas</button>
                  </div>
                )}
              </div>
              <button aria-label="New folder" disabled={!activeWorkspace || !canEdit || fileTreePending} onClick={() => beginFileCreation("folder")} title="New folder">
                <FolderPlusIcon />
              </button>
              <button aria-label="Refresh files" disabled={!activeWorkspace} onClick={() => activeWorkspace ? void loadWorkspace(activeWorkspace.id) : undefined} title="Refresh">
                <RefreshIcon />
              </button>
              <button aria-label="Collapse folders" disabled={expandedFolderIds.size === 0} onClick={() => setExpandedFolderIds(new Set())} title="Collapse all">
                <CollapseIcon />
              </button>
            </div>
          </div>
          {fileNodes.length === 0 && !fileCreationDraft ? (
            <div className="empty-sidebar">No files yet. Create a file or folder.</div>
          ) : (
            <div className="file-tree">
              {renderFileNodes(null)}
            </div>
          )}
          {fileTreeError && <strong className="file-tree-error file-tree-inline-error">{fileTreeError}</strong>}
        </section>
        {payload?.activeUser && (
          <button
            className="workspace-user"
            onContextMenu={(event) => {
              event.preventDefault();
              setAccountContextMenu({ x: event.clientX, y: event.clientY });
              setFileContextMenu(null);
            }}
          >
            <span className={`avatar avatar-${payload.activeUser.color}`}>{payload.activeUser.initials}</span>
            <div>
              <strong>{payload.activeUser.name}</strong>
              <small>{payload.activeUser.email}</small>
            </div>
          </button>
        )}
      </aside>

      <header className="workspace-topbar">
        <div className="breadcrumbs">
          {activeTab && (
            <span className={`breadcrumb-document-icon document-type-${activeTab.type}`}>
              {renderDocumentTypeIcon(activeTab.type)}
            </span>
          )}
          {activePathParts.map((part, index) => (
            <span className={index === activePathParts.length - 1 ? "breadcrumb-current" : ""} key={`${part}-${index}`}>
              {index > 0 && <span>/</span>}
              <strong>{part}</strong>
            </span>
          ))}
        </div>
        <DocumentHistoryPanel canEdit={canEdit} documentId={activeTab?.id ?? null} onRestore={applyRestoredDocument} />
        <div className="topbar-spacer" />
        <div className="users-wrap">
          <button className="presence-stack" disabled={!activeWorkspace} onClick={() => { setUsersOpen((open) => !open); setShareOpen(false); }}>
            {activeWorkspace?.members.map((member) => (
              <span className={`avatar avatar-${member.color}`} title={`${member.name} · ${member.role}`} key={member.id}>
                {member.initials}
              </span>
            ))}
          </button>
          {usersOpen && (
            <div className="users-menu">
              <strong>People</strong>
              <small>{activeWorkspace?.members.length ?? 0} in workspace</small>
              {activeWorkspace?.members.map((member) => (
                <div className="user-member" key={member.id}>
                  <span className={`avatar avatar-${member.color}`}>{member.initials}</span>
                  <div>
                    <b>{member.name}</b>
                    <small>{member.email}</small>
                  </div>
                  <select aria-label={`${member.name} role`} disabled={!canManageMembers || memberActionPendingId === member.id} onChange={(event) => void updateMemberRole(member.id, event.target.value as WorkspaceRole)} value={member.role}>
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className="danger-control" disabled={!canManageMembers || member.id === payload?.activeUser.id || memberActionPendingId === member.id} onClick={() => void removeMember(member)}>
                    Remove
                  </button>
                </div>
              ))}
              {memberActionError && <strong className="member-action-error">{memberActionError}</strong>}
              {!canManageMembers && <p>Only workspace owners can change roles.</p>}
            </div>
          )}
        </div>
        <div className="share-wrap">
          <button aria-label="Share" className="icon-control" disabled={!activeWorkspace} onClick={() => { setShareOpen((open) => !open); setUsersOpen(false); }} title={shareCopied ? "Link copied" : "Share"}>
            <ShareIcon />
          </button>
          {shareOpen && (
            <div className="share-menu">
              <strong>Share workspace</strong>
              <p>{canInvite ? "Create an invite link and keep roles explicit." : "Only workspace owners can invite teammates."}</p>
              {canInvite && (
                <div className="invite-form">
                  <input aria-label="Invite email" onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" type="email" value={inviteEmail} />
                  <div className="role-grid">
                    <button className={inviteRole === "viewer" ? "active" : ""} onClick={() => setInviteRole("viewer")}>Viewer</button>
                    <button className={inviteRole === "editor" ? "active" : ""} onClick={() => setInviteRole("editor")}>Editor</button>
                  </div>
                  <button className="primary-control" disabled={inviteSubmitting} onClick={createInvite}>
                    {inviteSubmitting ? "Creating..." : "Create invite link"}
                  </button>
                  {inviteLink && (
                    <button className="light-control invite-link-control" onClick={() => copyInvite()}>
                      {shareCopied ? "Copied" : "Copy latest link"}
                    </button>
                  )}
                  {inviteError && <strong className="auth-error">{inviteError}</strong>}
                </div>
              )}
              {activeWorkspace && activeWorkspace.invites.length > 0 && (
                <div className="pending-invites">
                  <span>Invites</span>
                  {activeWorkspace.invites.map((invite) => (
                    <div className="pending-invite" key={invite.id}>
                      <b>{invite.email ?? "Link invite"}</b>
                      <small>
                        {invite.acceptedAt
                          ? `${invite.role} · accepted ${new Date(invite.acceptedAt).toLocaleDateString()}`
                          : `${invite.role} · expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                      </small>
                      {!invite.acceptedAt && (
                        <button className="danger-control" disabled={inviteActionPendingId === invite.id} onClick={() => void revokeInvite(invite.id)}>
                          {inviteActionPendingId === invite.id ? "Revoking" : "Revoke"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <form className="git-import-form share-import-form" onSubmit={(event) => { event.preventDefault(); void importGitRepository(); }}>
                <span>Import Git</span>
                <input aria-label="GitHub repository URL" disabled={!canEdit || gitImportPending} onChange={(event) => setGitImportUrl(event.target.value)} placeholder="https://github.com/owner/repo" spellCheck={false} value={gitImportUrl} />
                <button disabled={!canEdit || gitImportPending || gitImportUrl.trim().length === 0} type="submit">
                  {gitImportPending ? "Importing" : "Import Git"}
                </button>
                {gitImportError && <strong>{gitImportError}</strong>}
                {gitImportSummary && <small>{gitImportSummary}</small>}
              </form>
            </div>
          )}
        </div>
        {shouldAllowPanel && (
          <button aria-label={sidePanelCollapsed ? "Show right sidebar" : "Hide right sidebar"} className="icon-control panel-topbar-toggle" onClick={() => setSidePanelCollapsed((collapsed) => !collapsed)} title={sidePanelCollapsed ? "Show panel" : "Hide panel"} type="button">
            {sidePanelCollapsed ? <PanelShowIcon /> : <PanelHideIcon />}
          </button>
        )}
        <button aria-label="Command palette" className="icon-control" onClick={openCommandPalette} title="Command">
          <CommandIcon />
        </button>
        {activeTab?.type === "code" && (
        <select className="environment-selector" disabled={!canEdit || runState === "running"} onChange={(event) => setSelectedExecutionEnvironmentId(event.target.value as ExecutionEnvironmentId)} value={selectedExecutionEnvironmentId} aria-label="Execution environment">
          {executionEnvironments.map((environment) => (
            <option key={environment.id} value={environment.id}>{environment.label}</option>
          ))}
        </select>
        )}
        {activeTab?.type === "code" && (
        <button className="run-control" disabled={!activeTab || !canEdit || runState === "running" || activeTab.type !== "code"} onClick={runActiveDocument}>
          <PlayIcon />
          {runState === "running" ? "Queueing" : "Run"}
        </button>
        )}
      </header>

      <section className={`${shouldShowPanel ? "workspace-main" : "workspace-main workspace-main-collapsed"}${shouldUseCanvasWorkbench ? " workspace-main-canvas" : ""}`}>
        {!activeWorkspace || !activeTab ? (
          <section className="workspace-start">
            <div className="workspace-start-copy">
              <span>{activeWorkspace ? "Start anywhere" : "Slate workspace"}</span>
              <h1>{activeWorkspace ? "Code, notes, and canvas share the same room." : "Create the room before you add the work."}</h1>
              <p>{activeWorkspace ? "Pick the first surface. Runs, comments, history, and teammates will stay attached as the work moves between modes." : "A workspace gives Slate one place to keep source, decisions, sketches, invites, and execution history."}</p>
              {!activeWorkspace && (
                <div className="empty-actions">
                  <button className="primary-control" disabled={workspaceCreating} onClick={() => void createWorkspace()}>
                    {workspaceCreating ? "Creating" : "Create workspace"}
                  </button>
                </div>
              )}
            </div>
            {activeWorkspace && (
              <div className="starter-grid">
                {starterDocuments.map((starter) => (
                  <button className={`starter-card document-type-${starter.type}`} disabled={!canEdit} key={starter.type} onClick={() => beginFileCreation("document", undefined, starter.fileName)} type="button">
                    <div className="starter-card-top">
                      <span>{renderDocumentTypeIcon(starter.type)}</span>
                      <strong>{starter.label}</strong>
                    </div>
                    {renderStarterPreview(starter.type)}
                    <p>{starter.description}</p>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="workbench-surface">
            <div className="document-tabbar">
              <div className="document-tabs">
                {openedDocuments.map((document) => (
                  <div className={`${document.id === activeTab.id ? "document-tab active" : "document-tab"} document-type-${document.type}`} key={document.id}>
                    <button className="document-tab-main" onClick={() => selectDocument(document.id)} type="button">
                      <span className="document-tab-icon">
                        {renderDocumentTypeIcon(document.type)}
                      </span>
                      <strong>{document.title}</strong>
                    </button>
                    <button aria-label={`Close ${document.title}`} className="document-tab-close" onClick={() => closeDocumentTab(document.id)} type="button">×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="document-stage">
              {activeTab.type === "code" && (
                <CollaborativeEditor documentId={activeTab.id} fileName={activeTab.title} initialValue={activeTab.content} language={activeTab.language ?? "plaintext"} onContentChange={(content) => saveDocument(activeTab.id, { content })} onPresenceChange={ignoreDocumentPresence} onRealtimeStatusChange={handleRealtimeStatusChange} readOnly={!canEdit} roomName={activeWorkspace.id} theme={theme} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
              {activeTab.type === "note" && (
                <CollaborativeNote documentId={activeTab.id} initialValue={activeTab.content} onContentChange={(content) => saveDocument(activeTab.id, { content })} onPresenceChange={ignoreDocumentPresence} onRealtimeStatusChange={handleRealtimeStatusChange} readOnly={!canEdit} roomName={activeWorkspace.id} title={activeTab.title} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
              {activeTab.type === "canvas" && (
                <CollaborativeCanvas canvasId={activeTab.id} initialState={activeTab.canvasState} onPresenceChange={ignoreDocumentPresence} onRealtimeStatusChange={handleRealtimeStatusChange} onStateChange={(canvasState) => saveDocument(activeTab.id, { canvasState })} readOnly={!canEdit} roomName={activeWorkspace.id} theme={theme} title={activeTab.title} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
            </div>
          </section>
        )}
        {shouldShowPanel && (
        <aside className="workspace-panel">
          <div className="panel-tabs">
            {panelTabs.map((tab) => (
              <button className={tab === selectedPanel ? "active" : ""} key={tab} onClick={() => setActivePanel(tab)}>
                {tab}
              </button>
            ))}
            <button aria-label="Hide right sidebar" className="panel-collapse-toggle" onClick={() => setSidePanelCollapsed(true)} title="Hide panel" type="button">
              <PanelHideIcon />
            </button>
          </div>
          {selectedPanel === "Output" && (
            <div className="output-panel">
              <div className="output-header">
                <span>{selectedRun ? selectedRun.kind : selectedExecutionEnvironmentId}</span>
                <b className={`run-badge run-badge-${runBadgeClass(selectedRun?.status ?? runState)}`}>{selectedRun?.status ?? runBadge}</b>
                <button onClick={() => { setOutputLines([]); setSelectedRunId(null); setRunState("idle"); }}>Clear</button>
              </div>
              <div className="terminal">
                {terminalLines.length === 0 ? (
                  <p>{activeTab ? `No runs yet. Press Run to create a BullMQ job for ${activeTab.title}.` : "No runs yet."}</p>
                ) : (
                  terminalLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
                )}
              </div>
            </div>
          )}
          {selectedPanel === "Activity" && (
            <div className="activity-panel">
              {activityEvents.length === 0 ? (
                <div className="activity-item">
                  <span className="avatar avatar-gray">DB</span>
                  <div>
                    <p>No activity yet</p>
                    <small>Workspace events will appear here</small>
                  </div>
                </div>
              ) : (
                activityEvents.map((event) => (
                  <div className="activity-item" key={event.id}>
                    <span className="avatar avatar-gray">{event.actorName ? event.actorName.slice(0, 1).toUpperCase() : "S"}</span>
                    <div>
                      <p>{event.actorName ?? "System"} {activityLabel(event)}</p>
                      <small>{event.documentTitle ? `${event.documentTitle} · ` : ""}{new Date(event.createdAt).toLocaleString()}</small>
                    </div>
                  </div>
                ))
              )}
              {activityError && <strong className="panel-error">{activityError}</strong>}
            </div>
          )}
          {selectedPanel === "Comments" && (
            <div className="comments-panel">
              {canEdit && (
                <form className="comment-form" onSubmit={(event) => { event.preventDefault(); void createComment(); }}>
                  <textarea aria-label="New comment" onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment" value={commentDraft} />
                  <button disabled={commentPending || commentDraft.trim().length === 0} type="submit">{commentPending ? "Adding" : "Add comment"}</button>
                </form>
              )}
              {commentError && <strong className="panel-error">{commentError}</strong>}
              {comments.length === 0 ? (
                <div className="comment-empty">No comments on this document.</div>
              ) : (
                comments.map((comment) => (
                  <article className={comment.resolvedAt ? "comment-item resolved" : "comment-item"} key={comment.id}>
                    <div className="comment-meta">
                      <span className="avatar avatar-gray">{comment.authorName.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{comment.authorName}</strong>
                        <small>{new Date(comment.createdAt).toLocaleString()}</small>
                      </div>
                    </div>
                    <p>{comment.body}</p>
                    {canEdit && (
                      <button disabled={commentActionPendingId === comment.id} onClick={() => void setCommentResolved(comment.id, !comment.resolvedAt)}>
                        {comment.resolvedAt ? "Reopen" : "Resolve"}
                      </button>
                    )}
                  </article>
                ))
              )}
              {comments.length > 0 && <div className="comment-end">No more comments</div>}
            </div>
          )}
          {selectedPanel === "AI" && (
            <div className="ai-panel">
              <div>AI</div>
              <h2>Room-aware assistant</h2>
              <p>It will use persisted documents, canvas snapshots, and run history once the assistant service is connected.</p>
            </div>
          )}
        </aside>
        )}
      </section>

      <footer className="workspace-status">
        <span title={statusDetail}><i /> {statusText.toLowerCase()}</span>
        <span className={isRealtimeRecovering(realtimeState) ? "workspace-status-warning" : ""} title={realtimeStatusDetail}><i /> {realtimeStatusText.toLowerCase()}</span>
        <span>{documents.length} documents</span>
        <span>{activeMember?.role ?? "guest"}</span>
      </footer>
      {commandPaletteOpen && (
        <div className="command-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandPaletteSelectedIndex((index) => Math.min(enabledCommandPaletteItems.length - 1, index + 1));
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCommandPaletteSelectedIndex((index) => Math.max(0, index - 1));
              }

              if (event.key === "Enter") {
                event.preventDefault();
                runPaletteItem(enabledCommandPaletteItems[commandPaletteSelectedIndex]);
              }
            }}
          >
            <div className="command-search">
              <CommandIcon />
              <input
                aria-label="Search commands and workspace"
                autoFocus
                onChange={(event) => {
                  setCommandPaletteQuery(event.target.value);
                  setCommandPaletteSelectedIndex(0);
                }}
                placeholder="Search files, content, or commands"
                value={commandPaletteQuery}
              />
            </div>
            {commandPaletteItems.length === 0 ? (
              <div className="command-empty">No results</div>
            ) : (
              commandPaletteItems.map((item) => {
                const enabledIndex = enabledCommandPaletteItems.findIndex((enabledItem) => enabledItem.id === item.id);
                const active = enabledIndex === commandPaletteSelectedIndex && !item.disabled;
                return (
                  <button className={active ? "active" : ""} disabled={item.disabled} key={item.id} onClick={() => runPaletteItem(item)}>
                    {renderCommandIcon(item.icon)}
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.group} · {item.meta}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
      {fileContextMenu && contextFileNode && (
        <div className="file-context-layer" onClick={() => setFileContextMenu(null)}>
          <div className="file-context-menu" onClick={(event) => event.stopPropagation()} style={{ left: fileContextMenu.x, top: fileContextMenu.y }}>
            <button disabled={!canEdit || fileTreePending} onClick={() => beginRenameFileNode(contextFileNode)}>
              <RenameIcon />
              <span>Rename</span>
            </button>
            <button onClick={() => void copyFileNodePath(contextFileNode)}>
              <CopyIcon />
              <span>Copy path</span>
            </button>
            <i />
            <button disabled={!canEdit || fileTreePending} onClick={() => beginFileCreation("document", contextParentId)}>
              <FilePlusIcon />
              <span>New file</span>
            </button>
            <button disabled={!canEdit || fileTreePending} onClick={() => beginFileCreation("folder", contextParentId)}>
              <FolderPlusIcon />
              <span>New folder</span>
            </button>
            <i />
            <button className="danger-control" disabled={!canEdit || fileTreePending} onClick={() => requestDeleteFileNode(contextFileNode)}>
              <TrashIcon />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
      {pendingDeleteFileNode && (
        <div className="confirm-layer" onClick={() => setPendingDeleteFileNode(null)}>
          <section className="confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-file-title">
            <div className="confirm-icon danger">
              <TrashIcon />
            </div>
            <strong id="delete-file-title">Delete {pendingDeleteFileNode.name}?</strong>
            <p>This removes the file from the workspace for everyone. This action cannot be undone.</p>
            <div className="confirm-actions">
              <button disabled={fileTreePending} onClick={() => setPendingDeleteFileNode(null)} type="button">Cancel</button>
              <button className="danger-control" disabled={fileTreePending} onClick={() => void confirmDeleteFileNode()} type="button">Delete</button>
            </div>
          </section>
        </div>
      )}
      {accountContextMenu && (
        <div className="file-context-layer" onClick={() => setAccountContextMenu(null)}>
          <div className="account-context-menu" onClick={(event) => event.stopPropagation()} style={{ left: accountContextMenu.x, top: accountContextMenu.y }}>
            <button onClick={() => { setSettingsOpen(true); setAccountContextMenu(null); }}>
              <SettingsIcon />
              Settings
            </button>
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          activeMemberRole={activeMember?.role ?? "guest"}
          activeUser={payload?.activeUser ?? null}
          confirmDeleteFiles={confirmDeleteFiles}
          theme={theme}
          workspace={activeWorkspace}
          workspacesCount={payload?.workspaces.length ?? 0}
          onClose={() => setSettingsOpen(false)}
          onConfirmDeleteFilesChange={setConfirmDeleteFiles}
          onLogout={logout}
          onThemeChange={setSelectedTheme}
        />
      )}
    </main>
  );
}
