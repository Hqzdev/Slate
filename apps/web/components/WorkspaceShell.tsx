"use client";

import dynamic from "next/dynamic";
import { type DragEvent, type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIcon, AiIcon, BellIcon, CanvasIcon, ChevronDownIcon, CodeIcon, CollapseIcon, CommandIcon, CopyIcon, DashboardIcon, FileIcon, FilePlusIcon, FolderIcon, FolderPlusIcon, GithubIcon, NoteIcon, PlayIcon, PlusIcon, RefreshIcon, RenameIcon, SearchIcon, SidebarActivityIcon, SidebarAiIcon, SidebarCommandIcon, SidebarDashboardIcon, SidebarPlusIcon, SidebarRefreshIcon, SidebarSettingsIcon, SidebarSupportIcon, SidebarToggleIcon, TrashIcon, UsersIcon } from "@/components/Icons";
import { DocumentHistoryPanel } from "@/components/DocumentHistoryPanel";
import { ContextualErrorPage, type ErrorPageVariant } from "@/components/ContextualErrorPage";
import { SettingsModal } from "@/components/SettingsModal";
import { WorkspaceLoadingShell } from "@/components/WorkspaceLoadingShell";
import { WorkspaceGuide } from "@/components/WorkspaceGuide";
import { WorkspaceAiPanel, type WorkspaceAiApplyResult } from "@/components/WorkspaceAiPanel";
import { WorkspaceMessengerPage } from "@/components/messenger/WorkspaceMessengerPage";
import { useMessengerUnread } from "@/components/messenger/useMessengerUnread";
import { useMessengerRealtime } from "@/components/messenger/useMessengerRealtime";
import { DocumentSaveQueue, RecoverableSaveError, TerminalSaveError } from "@/lib/client/documentSaveQueue";
import { type RealtimeConnectionStatus, getRealtimeStatusDetail, getRealtimeStatusText, isRealtimeRecovering } from "@/lib/client/realtimeConnection";
import { applyTheme, getResolvedTheme, getServerThemeSnapshot as getServerResolvedThemeSnapshot, setThemePreference, subscribeThemeChange } from "@/lib/client/theme";
import { createWorkspaceNavigationUrl, readWorkspaceNavigation, repairWorkspaceNavigationUrl, WorkspaceAiRouteMemory, type WorkspaceNavigationView } from "@/lib/client/workspaceNavigation";

type ExecutionEnvironmentId = "dry-run" | "node-container" | "node-syntax-check";
type JobRunStatus = "cancelled" | "completed" | "failed" | "pending" | "running";
type RunState = "idle" | "running" | "done" | "failed";
type SyncState = "blocked" | "offline" | "saved" | "saving";
type WorkspaceTheme = "dark" | "light";
type WorkspaceRole = "owner" | "editor" | "viewer";
type WorkspaceTabType = "code" | "note" | "canvas";
type WorkspaceView = WorkspaceNavigationView;
type WorkspaceLoadErrorVariant = Exclude<ErrorPageVariant, "public">;
type ActivityFilter = "all" | "documents" | "runs" | "members" | "ai";
type CommentFilter = "all" | "open" | "resolved";
type EditorCommentSelection = { endLine: number; startLine: number };
type CanvasCommentSelection = { id: string; name: string };
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
  disabledReason?: string;
  group: "Commands" | "Search";
  icon: WorkspaceTabType | "command" | "github" | "invite" | "run" | "theme";
  id: string;
  label: string;
  meta: string;
  run: () => void;
  shortcut?: string;
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

type WorkspaceBlockedUser = {
  blockedAt: string;
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
};

type UserNotification = {
  createdAt: string;
  id: string;
  invite: {
    acceptedAt: string | null;
    declinedAt: string | null;
    expiresAt: string;
    id: string;
    revokedAt: string | null;
    role: "editor" | "viewer";
  };
  inviterName: string;
  readAt: string | null;
  type: "workspace_invite";
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

type WorkspaceSettings = {
  allowEditorFileDelete: boolean;
  allowEditorInvites: boolean;
  allowViewerComments: boolean;
  autoSaveEnabled: boolean;
  defaultInviteRole: WorkspaceRole;
  description: string;
  exportIncludesActivity: boolean;
  fileTreeSortMode: string;
  retentionDays: number;
  showCollaboratorPresence: boolean;
  showDocumentActivity: boolean;
};

type WorkspaceJobRun = {
  createdAt: string;
  documentId: string | null;
  documentTitle: string | null;
  error: string | null;
  id: string;
  kind: string;
  output: string;
  status: JobRunStatus;
  updatedAt: string;
};

type ActivityEvent = {
  actorName: string | null;
  createdAt: string;
  documentTitle: string | null;
  id: string;
  metadata: unknown;
  type: string;
};

type DocumentComment = { authorName: string; body: string; createdAt: string; documentId: string; fileNodeId: string | null; id: string; lineEnd: number | null; lineStart: number | null; resolvedAt: string | null; shapeId: string | null; updatedAt: string };

type WorkspaceFileNode = {
  documentId: string | null;
  id: string;
  kind: "document" | "folder";
  name: string;
  parentId: string | null;
  position: number;
};

type WorkspacePresenceUser = {
  color: string;
  id: string;
  initials: string;
  name: string;
  role: string;
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

type FileDropTarget = {
  fileNodeId: string;
  mode: "after" | "before" | "inside";
};

type WorkspaceSummary = {
  abbreviation: string;
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
    abbreviation: string;
    blockedUsers: WorkspaceBlockedUser[];
    documents: WorkspaceDocument[];
    fileNodes: WorkspaceFileNode[];
    id: string;
    jobRuns: WorkspaceJobRun[];
    invites: {
      acceptedAt: string | null;
      createdAt: string;
      declinedAt: string | null;
      email: string | null;
      expiresAt: string;
      id: string;
      revokedAt: string | null;
      role: "editor" | "owner" | "viewer";
    }[];
    members: WorkspaceMember[];
    name: string;
    settings: WorkspaceSettings;
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
  green: "#22c55e",
  gray: "#64748b",
  orange: "#f97316",
  pink: "#ec4899",
  teal: "#14b8a6",
  violet: "#8b5cf6"
};

const executionEnvironments: { id: ExecutionEnvironmentId; label: string }[] = [
  { id: "node-container", label: "Node sandbox" },
  { id: "node-syntax-check", label: "Node syntax" },
  { id: "dry-run", label: "Preview only" }
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

const pendingDefaultWorkspaceId = "pending:default";

function subscribeWorkspaceClientState(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("storage", callback);
  };
}

function getWorkspaceIdSnapshot() {
  return readWorkspaceNavigation(window.location).workspaceId;
}

function getServerWorkspaceIdSnapshot() {
  return null;
}

function getAiConversationIdSnapshot() {
  return readWorkspaceNavigation(window.location).aiConversationId;
}

function getServerAiConversationIdSnapshot() {
  return null;
}

function getWorkspaceViewSnapshot(): WorkspaceView {
  return readWorkspaceNavigation(window.location).view;
}

function getServerWorkspaceViewSnapshot(): WorkspaceView {
  return "dashboard";
}

function getConversationIdSnapshot() {
  return readWorkspaceNavigation(window.location).conversationId;
}

function getServerConversationIdSnapshot() {
  return null;
}

function getDocumentIdSnapshot() {
  return readWorkspaceNavigation(window.location).documentId;
}

function getServerDocumentIdSnapshot() {
  return null;
}

function getThemeSnapshot(): WorkspaceTheme {
  return getResolvedTheme();
}

function getServerThemeSnapshot(): WorkspaceTheme {
  return getServerResolvedThemeSnapshot();
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

function formatRelativeTime(isoDate: string) {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return "";
  const elapsedMinutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getCanvasCommentShapeName(canvasState: unknown, shapeId: string) {
  if (!canvasState || typeof canvasState !== "object") return null;
  const shapes = (canvasState as { shapes?: unknown }).shapes;
  if (!Array.isArray(shapes)) return null;
  const shape = shapes.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === shapeId) as { name?: unknown; type?: unknown } | undefined;
  if (typeof shape?.name === "string" && shape.name.trim()) return shape.name.trim();
  return typeof shape?.type === "string" && shape.type ? `${shape.type.slice(0, 1).toUpperCase()}${shape.type.slice(1)}` : null;
}

function formatCommentLineRange(lineStart: number | null, lineEnd: number | null) {
  return lineStart === null || lineEnd === null ? null : lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}–${lineEnd}`;
}

async function readActionError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

class WorkspaceRequestError extends Error {
  constructor(public readonly variant: WorkspaceLoadErrorVariant, message: string) {
    super(message);
  }
}

export function WorkspaceShell({ standaloneMessenger = false }: { standaloneMessenger?: boolean }) {
  const queryWorkspaceId = useSyncExternalStore(subscribeWorkspaceClientState, getWorkspaceIdSnapshot, getServerWorkspaceIdSnapshot);
  const queryWorkspaceView = useSyncExternalStore(subscribeWorkspaceClientState, getWorkspaceViewSnapshot, getServerWorkspaceViewSnapshot);
  const queryConversationId = useSyncExternalStore(subscribeWorkspaceClientState, getConversationIdSnapshot, getServerConversationIdSnapshot);
  const queryDocumentId = useSyncExternalStore(subscribeWorkspaceClientState, getDocumentIdSnapshot, getServerDocumentIdSnapshot);
  const queryAiConversationId = useSyncExternalStore(subscribeWorkspaceClientState, getAiConversationIdSnapshot, getServerAiConversationIdSnapshot);
  const storedTheme = useSyncExternalStore(subscribeThemeChange, getThemeSnapshot, getServerThemeSnapshot);
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [, setActivePanel] = useState<"Comments" | "Output">("Comments");
  const [, setSidePanelCollapsed] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [workspaceComments, setWorkspaceComments] = useState<DocumentComment[]>([]);
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("all");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentLineSelection, setCommentLineSelection] = useState<EditorCommentSelection | null>(null);
  const [commentShapeSelection, setCommentShapeSelection] = useState<CanvasCommentSelection | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentPending, setCommentPending] = useState(false);
  const [commentActionPendingId, setCommentActionPendingId] = useState<string | null>(null);
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState<ExecutionEnvironmentId>("node-container");
  const [executionEnvironmentOpen, setExecutionEnvironmentOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [gitImportError, setGitImportError] = useState<string | null>(null);
  const [gitImportOpen, setGitImportOpen] = useState(false);
  const [gitImportPending, setGitImportPending] = useState(false);
  const [gitImportUrl, setGitImportUrl] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationActionPendingId, setNotificationActionPendingId] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creationMenuOpen, setCreationMenuOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviteActionPendingId, setInviteActionPendingId] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [memberActionPendingId, setMemberActionPendingId] = useState<string | null>(null);
  const [memberRoleMenuOpenId, setMemberRoleMenuOpenId] = useState<string | null>(null);
  const [membersManageOpen, setMembersManageOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFileNodeId, setSelectedFileNodeId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [fileCreationDraft, setFileCreationDraft] = useState<FileCreationDraft | null>(null);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileTreePending, setFileTreePending] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenu | null>(null);
  const [pendingDeleteFileNode, setPendingDeleteFileNode] = useState<WorkspaceFileNode | null>(null);
  const [draggedFileNodeId, setDraggedFileNodeId] = useState<string | null>(null);
  const [dropTargetFileNode, setDropTargetFileNode] = useState<FileDropTarget | null>(null);
  const [renamingFileNodeId, setRenamingFileNodeId] = useState<string | null>(null);
  const [fileNodeRenameDraft, setFileNodeRenameDraft] = useState("");
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceCreateError, setWorkspaceCreateError] = useState<string | null>(null);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("northbridge-prod");
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(queryWorkspaceView);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteSelectedIndex, setCommandPaletteSelectedIndex] = useState(0);
  const [documentPresenceById, setDocumentPresenceById] = useState<Record<string, WorkspacePresenceUser[]>>({});
  const [documentValidationErrors, setDocumentValidationErrors] = useState<Record<string, string>>({});
  const [settingsFocusAccount, setSettingsFocusAccount] = useState(false);
  const [confirmDeleteFiles, setConfirmDeleteFiles] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>("saved");
  const [realtimeConnection, setRealtimeConnection] = useState<RealtimeConnectionSnapshot>({ documentId: null, status: "idle" });
  const [selectedTheme, setSelectedTheme] = useState<WorkspaceTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoadingMessage, setShowLoadingMessage] = useState(false);
  const [showLoadingShell, setShowLoadingShell] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceErrorVariant, setWorkspaceErrorVariant] = useState<WorkspaceLoadErrorVariant | null>(null);
  const createDocumentButtonRef = useRef<HTMLButtonElement | null>(null);
  const aiRouteMemoryRef = useRef<WorkspaceAiRouteMemory | null>(null);
  const canvasLocalBlockedIdsRef = useRef<Set<string>>(new Set());
  const documentFlushesRef = useRef<Map<string, () => void>>(new Map());
  const documentSaveQueueRef = useRef<DocumentSaveQueue | null>(null);
  const documentSyncStatesRef = useRef<Map<string, SyncState>>(new Map());
  const executionEnvironmentRef = useRef<HTMLDivElement | null>(null);
  const membersCardRef = useRef<HTMLElement | null>(null);
  const resolvedWorkspaceIdRef = useRef<string | null>(null);
  const workspaceSyncStateRef = useRef<Exclude<SyncState, "blocked">>("saved");
  const recoveredWorkspaceIdRef = useRef<string | null>(null);
  const requestedWorkspaceIdRef = useRef<string | null>(null);
  const shortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const workspaceLoadControllerRef = useRef<AbortController | null>(null);
  const workspaceLoadSequenceRef = useRef(0);
  if (aiRouteMemoryRef.current === null) aiRouteMemoryRef.current = new WorkspaceAiRouteMemory();
  const refreshSyncState = useCallback((workspaceState?: Exclude<SyncState, "blocked">) => {
    if (workspaceState) workspaceSyncStateRef.current = workspaceState;
    const documentStates = Array.from(documentSyncStatesRef.current.values());
    const nextState = canvasLocalBlockedIdsRef.current.size > 0 || documentStates.includes("blocked")
      ? "blocked"
      : workspaceSyncStateRef.current === "offline" || documentStates.includes("offline")
        ? "offline"
        : workspaceSyncStateRef.current === "saving" || documentStates.includes("saving")
          ? "saving"
          : "saved";
    setSyncState(nextState);
  }, []);
  const handleCanvasLocalSaveBlockedChange = useCallback((documentId: string, blocked: boolean) => {
    if (blocked) {
      canvasLocalBlockedIdsRef.current.add(documentId);
    } else {
      canvasLocalBlockedIdsRef.current.delete(documentId);
    }
    refreshSyncState();
  }, [refreshSyncState]);
  if (documentSaveQueueRef.current == null) {
    documentSaveQueueRef.current = new DocumentSaveQueue({
      onSaved: (documentId, document) => {
        setDocumentValidationErrors((current) => {
          if (!(documentId in current)) return current;
          const next = { ...current };
          delete next[documentId];
          return next;
        });
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
      onStatusChange: (documentId, status) => {
        if (status === "saved") {
          documentSyncStatesRef.current.delete(documentId);
        } else {
          documentSyncStatesRef.current.set(documentId, status);
        }
        refreshSyncState();
      },
      onTerminalError: (_documentId, message) => {
        setError(message);
        refreshSyncState();
      },
      onValidationError: (documentId, message) => {
        setDocumentValidationErrors((current) => {
          if (!message) {
            if (!(documentId in current)) return current;
            const next = { ...current };
            delete next[documentId];
            return next;
          }
          return { ...current, [documentId]: message };
        });
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
          const message = await readActionError(response, "Document update failed");
          if (response.status === 413) throw new RecoverableSaveError(message);
          if (response.status === 401 || response.status === 403) throw new TerminalSaveError(message);
          throw new Error(message);
        }

        const responseBody = (await response.json()) as { document: WorkspaceDocument };
        return responseBody.document;
      }
    });
  }

  const requestedWorkspaceId = queryWorkspaceId;
  const theme = selectedTheme ?? storedTheme;
  const activeWorkspace = payload?.activeWorkspace ?? null;
  const documents = useMemo(() => activeWorkspace?.documents ?? [], [activeWorkspace?.documents]);
  const fileNodes = useMemo(() => activeWorkspace?.fileNodes ?? [], [activeWorkspace?.fileNodes]);
  const openedDocuments = useMemo(() => {
    const openIds = new Set(openTabIds);
    return documents.filter((document) => openIds.has(document.id));
  }, [documents, openTabIds]);
  const activeTab = useMemo(() => openedDocuments.find((document) => document.id === activeTabId) ?? null, [activeTabId, openedDocuments]);
  const aiContextDocument = useMemo(() => {
    if (activeTab) return activeTab;
    return documents.reduce<WorkspaceDocument | null>((latest, document) => {
      if (!latest || Date.parse(document.updatedAt) > Date.parse(latest.updatedAt)) return document;
      return latest;
    }, null);
  }, [activeTab, documents]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!loading || payload) {
      setShowLoadingShell(false);
      setShowLoadingMessage(false);
      return;
    }

    const shellTimer = window.setTimeout(() => setShowLoadingShell(true), 200);
    const messageTimer = window.setTimeout(() => setShowLoadingMessage(true), 2000);
    return () => {
      window.clearTimeout(shellTimer);
      window.clearTimeout(messageTimer);
    };
  }, [loading, payload]);

  useEffect(() => {
    const timer = window.setTimeout(() => setWorkspaceView(queryWorkspaceView), 0);
    return () => window.clearTimeout(timer);
  }, [queryWorkspaceView]);

  useEffect(() => {
    if (queryWorkspaceView === "ai" && queryWorkspaceId && queryAiConversationId) {
      aiRouteMemoryRef.current?.remember(queryWorkspaceId, queryAiConversationId);
    }
  }, [queryAiConversationId, queryWorkspaceId, queryWorkspaceView]);

  const currentWorkspaceId = activeWorkspace?.id ?? null;
  const activeWorkspaceIsSettled = Boolean(
    activeWorkspace
    && queryWorkspaceId
    && resolvedWorkspaceId === activeWorkspace.id
    && queryWorkspaceId === activeWorkspace.id
  );

  useEffect(() => {
    if (queryWorkspaceView !== "files" || !activeWorkspaceIsSettled || !queryDocumentId) return;
    const requestedDocument = documents.find((document) => document.id === queryDocumentId);
    if (!requestedDocument) {
      setError("Document not found");
      setWorkspaceErrorVariant("document");
      return;
    }

    setError((current) => workspaceErrorVariant === "document" ? null : current);
    setWorkspaceErrorVariant((current) => current === "document" ? null : current);
    setOpenTabIds((current) => current.includes(requestedDocument.id) ? current : [...current, requestedDocument.id]);
    setActiveTabId(requestedDocument.id);
  }, [activeWorkspaceIsSettled, documents, queryDocumentId, queryWorkspaceView, workspaceErrorVariant]);

  const navigateWorkspaceView = useCallback((
    nextView: WorkspaceView,
    options: {
      conversationId?: string | null;
      documentId?: string | null;
      historyMode?: "push" | "replace";
      workspaceId?: string | null;
    } = {}
  ) => {
    if (queryWorkspaceView === "ai" && queryWorkspaceId && queryAiConversationId) {
      aiRouteMemoryRef.current?.remember(queryWorkspaceId, queryAiConversationId);
    }
    const targetWorkspaceId = options.workspaceId === undefined
      ? activeWorkspaceIsSettled ? currentWorkspaceId : queryWorkspaceId
      : options.workspaceId;
    const aiConversationId = nextView === "ai" && targetWorkspaceId
      ? queryWorkspaceView === "ai" && queryWorkspaceId === targetWorkspaceId
        ? queryAiConversationId
        : aiRouteMemoryRef.current?.get(targetWorkspaceId) ?? null
      : null;
    const nextUrl = createWorkspaceNavigationUrl(window.location.href, {
      aiConversationId,
      conversationId: options.conversationId,
      documentId: options.documentId,
      view: nextView,
      workspaceId: targetWorkspaceId
    });
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) {
      if (options.historyMode === "replace") window.history.replaceState(null, "", nextUrl);
      else window.history.pushState(null, "", nextUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    setWorkspaceView(nextView);
    if (window.matchMedia("(max-width: 960px)").matches) setMobileSidebarOpen(false);
  }, [activeWorkspaceIsSettled, currentWorkspaceId, queryAiConversationId, queryWorkspaceId, queryWorkspaceView]);
  const activeMember = activeWorkspace?.members.find((member) => member.id === payload?.activeUser.id) ?? null;
  const canViewLogs = activeWorkspaceIsSettled && activeMember?.role === "owner";
  const canInvite = activeWorkspaceIsSettled && activeMember?.role === "owner";
  const canEdit = activeWorkspaceIsSettled && (activeMember?.role === "owner" || activeMember?.role === "editor");
  const canManageMembers = activeWorkspaceIsSettled && activeMember?.role === "owner";
  const refreshRunHistory = useCallback(async (workspaceId: string) => {
    if (!canViewLogs) return [];
    const response = await fetch(`/api/jobs/runs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readActionError(response, "Run history failed"));
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
  }, [canViewLogs]);
  const currentDocumentId = activeTab?.id ?? null;
  const jobRuns = useMemo(() => canViewLogs ? activeWorkspace?.jobRuns ?? [] : [], [activeWorkspace?.jobRuns, canViewLogs]);
  const activeDocumentRuns = useMemo(() => currentDocumentId ? jobRuns.filter((run) => run.documentId === currentDocumentId) : [], [currentDocumentId, jobRuns]);
  const selectedRun = useMemo(() => activeDocumentRuns.find((run) => run.id === selectedRunId) ?? activeDocumentRuns[0] ?? null, [activeDocumentRuns, selectedRunId]);
  const activeRun = useMemo(() => activeDocumentRuns.find((run) => run.status === "pending" || run.status === "running") ?? null, [activeDocumentRuns]);
  const hasActiveRun = Boolean(activeRun);
  const selectedExecutionEnvironment = executionEnvironments.find((environment) => environment.id === selectedExecutionEnvironmentId) ?? executionEnvironments[0];
  const activeFileNode = useMemo(() => activeTab ? fileNodes.find((fileNode) => fileNode.documentId === activeTab.id) ?? null : null, [activeTab, fileNodes]);
  const selectedFileNode = useMemo(() => fileNodes.find((fileNode) => fileNode.id === selectedFileNodeId) ?? activeFileNode, [activeFileNode, fileNodes, selectedFileNodeId]);
  const selectedParentId = selectedFileNode?.kind === "folder" ? selectedFileNode.id : selectedFileNode?.parentId ?? null;
  const activePathParts = useMemo(() => {
    if (workspaceView === "dashboard") return [activeWorkspace?.name ?? "Workspace", "Dashboard"];
    if (workspaceView === "activity") return [activeWorkspace?.name ?? "Workspace", "Activity"];
    if (workspaceView === "ai") return [activeWorkspace?.name ?? "Workspace", "AI Assistant"];
    if (workspaceView === "messenger") return [activeWorkspace?.name ?? "Workspace", "Messenger"];
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
  }, [activeFileNode, activeTab, activeWorkspace?.name, fileNodes, workspaceView]);
  const fileNodesByParentId = useMemo(() => {
    const nextNodes = new Map<string, WorkspaceFileNode[]>();
    for (const fileNode of fileNodes) {
      const parentKey = fileNode.parentId ?? "root";
      nextNodes.set(parentKey, [...nextNodes.get(parentKey) ?? [], fileNode]);
    }

    const compareByPosition = (left: WorkspaceFileNode, right: WorkspaceFileNode) => left.position - right.position || left.name.localeCompare(right.name);

    for (const [parentKey, childNodes] of nextNodes.entries()) {
      nextNodes.set(parentKey, childNodes.sort(compareByPosition));
    }

    return nextNodes;
  }, [fileNodes]);
  const runBadge = runState === "running" ? "queued" : runState === "done" ? "created" : runState === "failed" ? "failed" : "idle";
  const unreadNotificationCount = notifications.filter((notification) => notification.readAt === null).length;
  const activeDocumentComments = useMemo(() => activeTab ? comments.filter((comment) => comment.documentId === activeTab.id) : [], [activeTab, comments]);
  const visibleWorkspaceComments = useMemo(() => workspaceComments, [workspaceComments]);
  const commentComposerContext = activeTab?.title ?? "Document";
  const getCommentContextLabel = (_comment: DocumentComment) => "";
  const messengerUnread = useMessengerUnread(activeWorkspaceIsSettled ? currentWorkspaceId : null);
  const shouldUseCanvasWorkbench = workspaceView === "files" && activeTab?.type === "canvas";
  const statusText = syncState === "blocked" ? "Save blocked" : syncState === "saving" ? "Saving" : syncState === "offline" ? "Offline" : "Saved";
  const statusDetail = syncState === "blocked" ? "Resolve the document save error" : syncState === "saving" ? "Writing to Postgres" : syncState === "offline" ? "Reconnect required" : "All changes persisted";
  const realtimeState: RealtimeConnectionStatus = realtimeConnection.documentId === currentDocumentId ? realtimeConnection.status : currentDocumentId ? "connecting" : "idle";
  const realtimeStatusText = getRealtimeStatusText(realtimeState);
  const realtimeStatusDetail = getRealtimeStatusDetail(realtimeState);
  const handleRealtimeStatusChange = useCallback((status: RealtimeConnectionStatus) => {
    setRealtimeConnection({ documentId: currentDocumentId, status });
  }, [currentDocumentId]);

  const registerDocumentFlush = useCallback((documentId: string, flush: () => void) => {
    documentFlushesRef.current.set(documentId, flush);
    return () => {
      if (documentFlushesRef.current.get(documentId) === flush) {
        documentFlushesRef.current.delete(documentId);
      }
    };
  }, []);

  useLayoutEffect(() => {
    requestedWorkspaceIdRef.current = requestedWorkspaceId ?? pendingDefaultWorkspaceId;
  }, [requestedWorkspaceId]);

  const cancelWorkspaceLoad = useCallback(() => {
    workspaceLoadSequenceRef.current += 1;
    workspaceLoadControllerRef.current?.abort();
    workspaceLoadControllerRef.current = null;
    setLoading(false);
  }, []);

  const loadWorkspace = useCallback(async (workspaceId: string | null) => {
    const navigationWorkspaceId = readWorkspaceNavigation(window.location).workspaceId;
    if (navigationWorkspaceId !== workspaceId) return null;
    const sequence = workspaceLoadSequenceRef.current + 1;
    workspaceLoadSequenceRef.current = sequence;
    workspaceLoadControllerRef.current?.abort();
    const controller = new AbortController();
    workspaceLoadControllerRef.current = controller;
    setLoading(true);
    setError(null);
    setWorkspaceErrorVariant(null);

    try {
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const response = await fetch(`/api/workspaces${query}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || workspaceLoadSequenceRef.current !== sequence) return null;

      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return null;
      }

      if (!response.ok) {
        const variant: WorkspaceLoadErrorVariant = response.status === 404 ? "workspace" : response.status === 403 ? "forbidden" : "unavailable";
        throw new WorkspaceRequestError(variant, await readActionError(response, "Workspace failed to load"));
      }

      const nextPayload = (await response.json()) as WorkspacePayload;
      if (controller.signal.aborted || workspaceLoadSequenceRef.current !== sequence) return null;
      if (readWorkspaceNavigation(window.location).workspaceId !== navigationWorkspaceId) return null;
      const nextWorkspaceId = nextPayload.activeWorkspace?.id ?? null;
      resolvedWorkspaceIdRef.current = nextWorkspaceId;
      requestedWorkspaceIdRef.current = nextWorkspaceId;
      setResolvedWorkspaceId(nextWorkspaceId);
      setPayload(nextPayload);
      setWorkspaceErrorVariant(null);
      refreshSyncState("saved");
      const repairedUrl = repairWorkspaceNavigationUrl(window.location.href, nextWorkspaceId);
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (repairedUrl !== currentUrl) {
        window.history.replaceState(null, "", repairedUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      return nextPayload;
    } catch (loadError) {
      if (controller.signal.aborted || workspaceLoadSequenceRef.current !== sequence) return null;
      setError(loadError instanceof Error ? loadError.message : "Workspace failed to load");
      setWorkspaceErrorVariant(loadError instanceof WorkspaceRequestError ? loadError.variant : "unavailable");
      refreshSyncState("offline");
      return null;
    } finally {
      if (workspaceLoadSequenceRef.current === sequence) {
        workspaceLoadControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [refreshSyncState]);

  const retryWorkspaceLoad = useCallback(() => {
    void loadWorkspace(requestedWorkspaceIdRef.current ?? requestedWorkspaceId);
  }, [loadWorkspace, requestedWorkspaceId]);

  const handleMessengerAccessDenied = useCallback(() => {
    setPayload(null);
    resolvedWorkspaceIdRef.current = null;
    setResolvedWorkspaceId(null);
    navigateWorkspaceView(standaloneMessenger ? "messenger" : "dashboard", { historyMode: "replace", workspaceId: null });
    void loadWorkspace(null);
  }, [loadWorkspace, navigateWorkspaceView, standaloneMessenger]);

  const handleMessengerAuthenticationRequired = useCallback(() => {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }, []);

  const handleMessengerConversationChange = useCallback((conversationId: string | null, historyMode: "push" | "replace") => {
    navigateWorkspaceView("messenger", { conversationId, historyMode });
  }, [navigateWorkspaceView]);

  const messengerRealtime = useMessengerRealtime(
    activeWorkspaceIsSettled ? currentWorkspaceId : null,
    handleMessengerAccessDenied,
    handleMessengerAuthenticationRequired,
    messengerUnread.refresh
  );

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        if (response.status !== 401) setNotificationError(await readActionError(response, "Notifications failed to load"));
        return;
      }
      const body = (await response.json()) as { notifications: UserNotification[] };
      setNotifications(body.notifications);
      setNotificationError(null);
    } catch (notificationLoadError) {
      setNotificationError(notificationLoadError instanceof Error ? notificationLoadError.message : "Notifications failed to load");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!requestedWorkspaceId || resolvedWorkspaceIdRef.current !== requestedWorkspaceId) {
        void loadWorkspace(requestedWorkspaceId);
      }
      void loadNotifications();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadNotifications, loadWorkspace, requestedWorkspaceId]);

  useEffect(() => () => {
    workspaceLoadSequenceRef.current += 1;
    workspaceLoadControllerRef.current?.abort();
    workspaceLoadControllerRef.current = null;
  }, []);

  useEffect(() => {
    if (selectedTheme) {
      setThemePreference(selectedTheme);
    }
  }, [selectedTheme]);

  useEffect(() => {
    if (!activeWorkspace || recoveredWorkspaceIdRef.current === activeWorkspace.id) return;
    recoveredWorkspaceIdRef.current = activeWorkspace.id;
    documentSaveQueueRef.current?.recover(activeWorkspace.documents.map((document) => document.id));
  }, [activeWorkspace]);

  useEffect(() => {
    function flushPendingSaves() {
      for (const flush of documentFlushesRef.current.values()) flush();
      documentSaveQueueRef.current?.flush();
    }

    window.addEventListener("pagehide", flushPendingSaves);
    return () => window.removeEventListener("pagehide", flushPendingSaves);
  }, []);

  useEffect(() => {
    shortcutHandlerRef.current = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasCmd = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setSettingsOpen(false);
        setWorkspaceSwitcherOpen(false);
        setWorkspaceCreateOpen(false);
        setCreationMenuOpen(false);
        setExecutionEnvironmentOpen(false);
        setFileCreationDraft(null);
        setFileContextMenu(null);
        setMemberRoleMenuOpenId(null);
        setPendingDeleteFileNode(null);
        setRenamingFileNodeId(null);
        return;
      }

      if (!hasCmd) return;

      if (!event.shiftKey && !event.altKey) {
        if (key === "k") {
          event.preventDefault();
          if (commandPaletteOpen) {
            setCommandPaletteOpen(false);
          } else {
            openCommandPalette();
          }
          return;
        }

        if (key === "enter") {
          if (workspaceView !== "files" || !activeTab || !canViewLogs || !canEdit || activeTab.type !== "code" || hasActiveRun || runState === "running") return;
          event.preventDefault();
          void runActiveDocument();
          return;
        }

        if (key === "s") {
          if (workspaceView !== "files" || !activeWorkspaceIsSettled) return;
          event.preventDefault();
          documentSaveQueueRef.current?.flush();
          return;
        }

        if (key === ",") {
          event.preventDefault();
          setSettingsOpen(true);
          return;
        }

        return;
      }

      if (event.altKey && !event.shiftKey) {
        if (workspaceView !== "files" || !activeWorkspaceIsSettled) return;
        if (event.code === "KeyN" || event.code === "KeyC" || event.code === "KeyV") {
          event.preventDefault();
          if (!canEdit) return;
          const fileName = event.code === "KeyN" ? "new-note.md" : event.code === "KeyC" ? "new-file.ts" : "new-canvas.canvas";
          beginFileCreation("document", undefined, fileName);
          return;
        }

        if (event.code === "KeyW") {
          event.preventDefault();
          if (activeTabId) closeDocumentTab(activeTabId);
          return;
        }

        if (event.code === "BracketRight" || event.code === "BracketLeft") {
          event.preventDefault();
          if (!activeTabId || openTabIds.length < 2) return;
          const currentIndex = openTabIds.indexOf(activeTabId);
          const step = event.code === "BracketRight" ? 1 : -1;
          const nextTabId = openTabIds[(currentIndex + step + openTabIds.length) % openTabIds.length];
          if (nextTabId) selectDocument(nextTabId);
          return;
        }

        const digitMatch = /^Digit([1-9])$/.exec(event.code);
        if (digitMatch) {
          event.preventDefault();
          const tabId = openTabIds[Number(digitMatch[1]) - 1];
          if (tabId) selectDocument(tabId);
          return;
        }

        return;
      }

      if (event.shiftKey && !event.altKey) {
        if (key === "d") {
          event.preventDefault();
          navigateWorkspaceView("dashboard");
          return;
        }

        if (key === "e" && canViewLogs) {
          event.preventDefault();
          navigateWorkspaceView("activity");
          return;
        }

        if (key === "l") {
          event.preventDefault();
          toggleTheme();
        }
      }
    };
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => shortcutHandlerRef.current(event);
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!workspaceSwitcherOpen) return;

    function closeWorkspaceSwitcherFromPointer(event: PointerEvent) {
      if (workspaceSwitcherRef.current?.contains(event.target as Node)) return;
      setWorkspaceSwitcherOpen(false);
    }

    window.addEventListener("pointerdown", closeWorkspaceSwitcherFromPointer);
    return () => window.removeEventListener("pointerdown", closeWorkspaceSwitcherFromPointer);
  }, [workspaceSwitcherOpen]);

  useEffect(() => {
    if (!executionEnvironmentOpen) return;

    function closeFromPointer(event: PointerEvent) {
      if (executionEnvironmentRef.current?.contains(event.target as Node)) return;
      setExecutionEnvironmentOpen(false);
    }

    window.addEventListener("pointerdown", closeFromPointer);
    return () => window.removeEventListener("pointerdown", closeFromPointer);
  }, [executionEnvironmentOpen]);

  useEffect(() => {
    if (!currentWorkspaceId || !hasActiveRun) return;

    const timer = window.setInterval(() => {
      void refreshRunHistory(currentWorkspaceId);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [currentWorkspaceId, hasActiveRun, refreshRunHistory]);

  function openCommandPalette() {
    setCommandPaletteQuery("");
    setCommandPaletteSelectedIndex(0);
    setCommandPaletteOpen(true);
  }

  function selectWorkspace(workspaceId: string) {
    requestedWorkspaceIdRef.current = workspaceId;
    setActiveTabId(null);
    setOpenTabIds([]);
    setSelectedFileNodeId(null);
    setOutputLines([]);
    setRunState("idle");
    setSelectedRunId(null);
    setSidePanelCollapsed(true);
    navigateWorkspaceView(workspaceView, { workspaceId });
  }

  function selectDocument(tabId: string) {
    const fileNode = fileNodes.find((node) => node.documentId === tabId) ?? null;
    navigateWorkspaceView("files", { documentId: tabId });
    setOpenTabIds((current) => current.includes(tabId) ? current : [...current, tabId]);
    setActiveTabId(tabId);
    setSelectedFileNodeId(fileNode?.id ?? null);
    setOutputLines([]);
    setRunState("idle");
    setSelectedRunId(null);
  }

  function openDocumentHistory(documentId: string) {
    selectDocument(documentId);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(".history-control")?.click(), 0);
  }

  function openDashboardFolder(fileNodeId: string) {
    navigateWorkspaceView("files");
    if (fileNodeId === "root") {
      setSelectedFileNodeId(null);
      return;
    }
    setSelectedFileNodeId(fileNodeId);
    setExpandedFolderIds((current) => new Set(current).add(fileNodeId));
  }

  function openDashboardRun(run: WorkspaceJobRun) {
    if (run.documentId) selectDocument(run.documentId);
    setSelectedRunId(run.id);
    setActivePanel("Output");
    setSidePanelCollapsed(false);
    setRunState(run.status === "failed" ? "failed" : run.status === "completed" ? "done" : run.status === "cancelled" ? "idle" : "running");
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
    setSelectedRunId(null);
  }

  function toggleCreationMenu() {
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

  const updateDocumentPresence = useCallback((documentId: string, users: WorkspacePresenceUser[]) => {
    setDocumentPresenceById((current) => {
      const visibleUsers = Array.from(new Map(users.filter((user) => user.id !== payload?.activeUser.id).map((user) => [user.id, user])).values());
      if (visibleUsers.length === 0) {
        if (!current[documentId]) return current;
        const nextPresence = { ...current };
        delete nextPresence[documentId];
        return nextPresence;
      }

      return {
        ...current,
        [documentId]: visibleUsers
      };
    });
  }, [payload?.activeUser.id]);

  const workspaceNameIsValid = /^[a-z0-9-]+$/.test(workspaceNameDraft.trim());

  async function createWorkspace() {
    if (workspaceCreating) return;

    setWorkspaceCreating(true);
    setWorkspaceCreateError(null);

    try {
      const response = await fetch("/api/workspaces", {
        body: JSON.stringify({ name: workspaceNameDraft.trim() }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }

      if (!response.ok) {
        setWorkspaceCreateError(await readActionError(response, "Workspace creation failed"));
        return;
      }

      const nextPayload = (await response.json()) as WorkspacePayload;
      const nextWorkspace = nextPayload.activeWorkspace;
      requestedWorkspaceIdRef.current = nextWorkspace?.id ?? null;
      resolvedWorkspaceIdRef.current = nextWorkspace?.id ?? null;
      setPayload(nextPayload);
      setResolvedWorkspaceId(nextWorkspace?.id ?? null);
      setActiveTabId(null);
      setOpenTabIds([]);
      setSelectedFileNodeId(null);
      refreshSyncState("saved");
      setCreationMenuOpen(false);
      setWorkspaceCreateOpen(false);
      navigateWorkspaceView("dashboard", { historyMode: "replace", workspaceId: nextWorkspace?.id ?? null });
    } catch (workspaceCreateError) {
      setWorkspaceCreateError(workspaceCreateError instanceof Error ? workspaceCreateError.message : "Workspace creation failed");
      refreshSyncState("offline");
    } finally {
      setWorkspaceCreating(false);
    }
  }

  function beginFileCreation(kind: "document" | "folder", parentIdOverride?: string | null, initialName?: string) {
    if (!activeWorkspace || !canEdit || fileTreePending) return;

    const parentId = parentIdOverride === undefined ? selectedParentId : parentIdOverride;
    navigateWorkspaceView("files");
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
    if (!canEdit || !documentSaveQueueRef.current) return false;
    documentSaveQueueRef.current.enqueue(documentId, input);
    return true;
  }

  const refreshActivity = useCallback(async (workspaceId: string) => {
    if (!canViewLogs) {
      setActivityEvents([]);
      setActivityError(null);
      return;
    }
    if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/activity`, { cache: "no-store" });
      if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;
      if (!response.ok) {
        setActivityError(await readActionError(response, "Activity failed to load"));
        return;
      }
      const body = (await response.json()) as { events: ActivityEvent[] };
      if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;
      setActivityEvents(body.events);
      setActivityError(null);
    } catch (activityLoadError) {
      if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;
      setActivityError(activityLoadError instanceof Error ? activityLoadError.message : "Activity failed to load");
    }
  }, [canViewLogs]);

  const applyAiWorkspaceChange = useCallback(async (result: WorkspaceAiApplyResult) => {
    if (!currentWorkspaceId) return;
    const workspaceId = currentWorkspaceId;
    if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;
    cancelWorkspaceLoad();
    const knownDocumentIds = new Set(documents.map((document) => document.id));
    let openDocumentId = result.openDocumentId ?? result.documents.find((document) => !knownDocumentIds.has(document.id))?.id ?? null;
    let availableFileNodes: WorkspaceFileNode[] = [
      ...fileNodes.filter((fileNode) => !result.fileNodes.some((incomingFileNode) => incomingFileNode.id === fileNode.id)),
      ...result.fileNodes
    ];

    if (result.documents.length > 0 || result.fileNodes.length > 0) {
      setPayload((current) => {
        if (!current?.activeWorkspace || current.activeWorkspace.id !== workspaceId) return current;
        const incomingDocuments = new Map(result.documents.map((document) => [document.id, document]));
        const incomingFileNodes = new Map(result.fileNodes.map((fileNode) => [fileNode.id, fileNode]));
        const existingDocumentIds = new Set(current.activeWorkspace.documents.map((document) => document.id));
        const existingFileNodeIds = new Set(current.activeWorkspace.fileNodes.map((fileNode) => fileNode.id));
        const nextDocuments = [
          ...current.activeWorkspace.documents.map((document) => incomingDocuments.get(document.id) ?? document),
          ...result.documents.filter((document) => !existingDocumentIds.has(document.id))
        ].sort((left, right) => left.position - right.position);
        const nextFileNodes = [
          ...current.activeWorkspace.fileNodes.map((fileNode) => incomingFileNodes.get(fileNode.id) ?? fileNode),
          ...result.fileNodes.filter((fileNode) => !existingFileNodeIds.has(fileNode.id))
        ];

        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            documents: nextDocuments,
            fileNodes: nextFileNodes
          },
          workspaces: current.workspaces.map((workspace) => workspace.id === workspaceId ? { ...workspace, documentCount: nextDocuments.length } : workspace)
        };
      });
    }

    const returnedDocumentIds = new Set(result.documents.map((document) => document.id));
    const hasReturnedOpenFileNode = Boolean(openDocumentId && result.fileNodes.some((fileNode) => fileNode.documentId === openDocumentId));
    if (
      (result.documents.length === 0 && result.fileNodes.length === 0)
      || (openDocumentId && !knownDocumentIds.has(openDocumentId) && (!returnedDocumentIds.has(openDocumentId) || !hasReturnedOpenFileNode))
    ) {
      const refreshedPayload = await loadWorkspace(workspaceId);
      if (refreshedPayload?.activeWorkspace?.id === workspaceId) {
        availableFileNodes = refreshedPayload.activeWorkspace.fileNodes;
        openDocumentId ??= refreshedPayload.activeWorkspace.documents.find((document) => !knownDocumentIds.has(document.id))?.id ?? null;
      }
    }

    if (requestedWorkspaceIdRef.current && requestedWorkspaceIdRef.current !== workspaceId) return;

    if (openDocumentId) {
      const openFileNode = availableFileNodes.find((fileNode) => fileNode.documentId === openDocumentId) ?? null;
      navigateWorkspaceView("files");
      setOpenTabIds((current) => current.includes(openDocumentId) ? current : [...current, openDocumentId]);
      setActiveTabId(openDocumentId);
      setSelectedFileNodeId(openFileNode?.id ?? null);
      setOutputLines([]);
      setRunState("idle");
      setSelectedRunId(null);

      if (openFileNode?.parentId) {
        const fileNodesById = new Map(availableFileNodes.map((fileNode) => [fileNode.id, fileNode]));
        setExpandedFolderIds((current) => {
          const next = new Set(current);
          let parentId = openFileNode.parentId;
          while (parentId) {
            next.add(parentId);
            parentId = fileNodesById.get(parentId)?.parentId ?? null;
          }
          return next;
        });
      }
    }

    await refreshActivity(workspaceId);
  }, [cancelWorkspaceLoad, currentWorkspaceId, documents, fileNodes, loadWorkspace, navigateWorkspaceView, refreshActivity]);

  const prepareAiContext = useCallback(async (documentId: string | null) => {
    if (!documentId) return;
    documentFlushesRef.current.get(documentId)?.();
    await documentSaveQueueRef.current?.flushAndWait(documentId);
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

  const refreshWorkspaceComments = useCallback(async (workspaceId: string) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/comments`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { comments: DocumentComment[] };
    setWorkspaceComments(body.comments);
  }, []);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    const timer = window.setTimeout(() => {
      void refreshActivity(currentWorkspaceId);
      void refreshWorkspaceComments(currentWorkspaceId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentWorkspaceId, refreshActivity, refreshWorkspaceComments]);

  useEffect(() => {
    if (!currentDocumentId) return;
    const timer = window.setTimeout(() => {
      void refreshComments(currentDocumentId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentDocumentId, refreshComments]);

  async function createComment() {
    if (!activeTab || !canEdit || commentPending || commentDraft.trim().length === 0) return;
    setCommentPending(true);
    setCommentError(null);

    try {
      documentFlushesRef.current.get(activeTab.id)?.();
      await documentSaveQueueRef.current?.flushAndWait(activeTab.id);
      const response = await fetch(`/api/documents/${activeTab.id}/comments`, {
        body: JSON.stringify({
          body: commentDraft,
          fileNodeId: activeFileNode?.id ?? null,
          lineEnd: activeTab.type === "code" ? commentLineSelection?.endLine ?? null : null,
          lineStart: activeTab.type === "code" ? commentLineSelection?.startLine ?? null : null,
          shapeId: activeTab.type === "canvas" ? commentShapeSelection?.id ?? null : null
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        setCommentError(await readActionError(response, "Comment creation failed"));
        return;
      }

      const body = (await response.json()) as { comment: DocumentComment };
      setComments((current) => [body.comment, ...current]);
      setWorkspaceComments((current) => [body.comment, ...current]);
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
      setWorkspaceComments((current) => current.map((comment) => comment.id === body.comment.id ? body.comment : comment));
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

  function inviteTeammates() {
    navigateWorkspaceView("dashboard");
    setMembersManageOpen(true);
    setInviteError(null);
  }

  function openDashboardMembers() {
    setMembersManageOpen(true);
    window.requestAnimationFrame(() => membersCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function createInvite() {
    if (!activeWorkspace || inviteSubmitting || !canInvite) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteError("Enter the Slate account email");
      return;
    }
    setInviteSubmitting(true);
    setInviteError(null);

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/invites`, {
        body: JSON.stringify({ email, role: inviteRole }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = await response.json().catch(() => ({ error: "Invite creation failed" }));
      if (!response.ok) {
        setInviteError(typeof body.error === "string" ? body.error : "Invite creation failed");
        return;
      }
      setInviteEmail("");
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            invites: [body.invite, ...current.activeWorkspace.invites.filter((invite) => invite.id !== body.invite.id)]
          }
        };
      });
    } catch (inviteCreationError) {
      setInviteError(inviteCreationError instanceof Error ? inviteCreationError.message : "Invite creation failed");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function toggleNotifications() {
    const nextOpen = !notificationsOpen;
    setNotificationsOpen(nextOpen);
    if (!nextOpen) return;
    await loadNotifications();
    if (notifications.some((notification) => notification.readAt === null)) {
      await fetch("/api/notifications", { method: "PATCH" }).catch(() => undefined);
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt ?? new Date().toISOString() })));
    }
  }

  async function respondToInvite(notification: UserNotification, action: "accept" | "decline") {
    if (notificationActionPendingId) return;
    setNotificationActionPendingId(notification.id);
    setNotificationError(null);
    try {
      const response = await fetch(`/api/notifications/${notification.id}/${action}`, { method: "POST" });
      if (!response.ok) {
        setNotificationError(await readActionError(response, `Invite ${action} failed`));
        return;
      }
      if (action === "accept") {
        window.location.href = `/workspace?workspaceId=${notification.workspace.id}`;
        return;
      }
      await loadNotifications();
    } catch (notificationActionError) {
      setNotificationError(notificationActionError instanceof Error ? notificationActionError.message : `Invite ${action} failed`);
    } finally {
      setNotificationActionPendingId(null);
    }
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
      setMemberRoleMenuOpenId(null);
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

  async function blockMember(member: WorkspaceMember) {
    if (!activeWorkspace || !canManageMembers || memberActionPendingId) return;
    setMemberActionPendingId(member.id);
    setMemberActionError(null);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/members/${member.id}/block`, { method: "POST" });
      if (!response.ok) {
        setMemberActionError(await readActionError(response, "Member block failed"));
        return;
      }
      const body = (await response.json()) as { blockedUser: WorkspaceBlockedUser };
      setPayload((current) => {
        if (!current?.activeWorkspace) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            blockedUsers: [body.blockedUser, ...current.activeWorkspace.blockedUsers.filter((user) => user.id !== member.id)],
            members: current.activeWorkspace.members.filter((workspaceMember) => workspaceMember.id !== member.id)
          },
          workspaces: current.workspaces.map((workspace) => workspace.id === activeWorkspace.id
            ? { ...workspace, members: workspace.members.filter((workspaceMember) => workspaceMember.id !== member.id) }
            : workspace)
        };
      });
    } catch (memberError) {
      setMemberActionError(memberError instanceof Error ? memberError.message : "Member block failed");
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function unblockUser(blockedUser: WorkspaceBlockedUser) {
    if (!activeWorkspace || !canManageMembers || memberActionPendingId) return;
    setMemberActionPendingId(blockedUser.id);
    setMemberActionError(null);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/blocks/${blockedUser.id}`, { method: "DELETE" });
      if (!response.ok) {
        setMemberActionError(await readActionError(response, "Member unblock failed"));
        return;
      }
      setPayload((current) => current?.activeWorkspace ? {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          blockedUsers: current.activeWorkspace.blockedUsers.filter((user) => user.id !== blockedUser.id)
        }
      } : current);
    } catch (memberError) {
      setMemberActionError(memberError instanceof Error ? memberError.message : "Member unblock failed");
    } finally {
      setMemberActionPendingId(null);
    }
  }

  async function runDocument(document: WorkspaceDocument) {
    const documentHasActiveRun = jobRuns.some((run) => run.documentId === document.id && (run.status === "pending" || run.status === "running"));
    if (!canViewLogs || !canEdit || documentHasActiveRun || runState === "running" || document.type !== "code") return;
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) return;
    selectDocument(document.id);
    setActivePanel("Output");
    setSidePanelCollapsed(false);
    setRunState("running");
    setOutputLines([`$ slate run ${document.title}`, `environment=${selectedExecutionEnvironmentId}`, "creating BullMQ job"]);

    try {
      const response = await fetch("/api/jobs/runs", {
        body: JSON.stringify({ documentId: document.id, environmentId: selectedExecutionEnvironmentId }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        const message = await readActionError(response, "Run creation failed");
        setRunState("failed");
        setOutputLines((current) => [...current, message]);
        return;
      }

      const body = (await response.json()) as { run: WorkspaceJobRun };
      setSelectedRunId(body.run.id);
      setPayload((current) => {
        if (!current?.activeWorkspace || current.activeWorkspace.id !== workspaceId) return current;
        return {
          ...current,
          activeWorkspace: {
            ...current.activeWorkspace,
            jobRuns: [body.run, ...current.activeWorkspace.jobRuns.filter((run) => run.id !== body.run.id)]
          }
        };
      });
      setOutputLines((current) => [...current, `job ${body.run.id} queued`, body.run.output]);
      const latestRuns = await waitForRunCompletion(workspaceId, body.run.id);
      const finalRun = latestRuns.find((run) => run.id === body.run.id);
      setRunState(finalRun?.status === "failed" ? "failed" : finalRun?.status === "completed" ? "done" : "idle");
    } catch (runError) {
      setRunState("failed");
      setOutputLines((current) => [...current, runError instanceof Error ? runError.message : "Run failed"]);
    }
  }

  async function runActiveDocument() {
    if (!activeTab) return;
    await runDocument(activeTab);
  }

  async function cancelRun(run: WorkspaceJobRun) {
    if (!canEdit || run.status !== "pending" && run.status !== "running") return;
    setRunState("idle");
    try {
      const response = await fetch(`/api/jobs/runs/${run.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readActionError(response, "Run cancellation failed"));
      const body = (await response.json()) as { run: WorkspaceJobRun };
      setPayload((current) => current?.activeWorkspace ? {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          jobRuns: current.activeWorkspace.jobRuns.map((candidate) => candidate.id === body.run.id ? body.run : candidate)
        }
      } : current);
      setOutputLines(runTerminalLines(body.run));
    } catch (cancelError) {
      setRunState("failed");
      setOutputLines((current) => [...current, cancelError instanceof Error ? cancelError.message : "Run cancellation failed"]);
    }
  }

  async function importGitRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace || !canEdit || gitImportPending) return;
    setGitImportPending(true);
    setGitImportError(null);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspace.id}/imports/git`, {
        body: JSON.stringify({ url: gitImportUrl }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await readActionError(response, "GitHub import failed"));
      await loadWorkspace(activeWorkspace.id);
      await refreshActivity(activeWorkspace.id);
      setGitImportOpen(false);
      setGitImportUrl("");
    } catch (importError) {
      setGitImportError(importError instanceof Error ? importError.message : "GitHub import failed");
    } finally {
      setGitImportPending(false);
    }
  }

  async function waitForRunCompletion(workspaceId: string, runId: string) {
    let latestRuns = await refreshRunHistory(workspaceId);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const latestRun = latestRuns.find((run) => run.id === runId);
      if (latestRun?.status === "completed" || latestRun?.status === "failed" || latestRun?.status === "cancelled") break;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      latestRuns = await refreshRunHistory(workspaceId);
    }

    return latestRuns;
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
    if (icon === "github") return <GithubIcon />;
    if (icon === "invite") return <UsersIcon />;
    if (icon === "run") return <PlayIcon />;
    return <CommandIcon />;
  }

  function renderCommandPaletteItem(item: CommandPaletteItem) {
    const enabledIndex = enabledCommandPaletteItems.findIndex((enabledItem) => enabledItem.id === item.id);
    const active = enabledIndex === commandPaletteSelectedIndex && !item.disabled;
    return (
      <button className={active ? "command-palette-item active" : "command-palette-item"} disabled={item.disabled} key={item.id} onClick={() => runPaletteItem(item)} title={item.disabledReason} type="button">
        <span className="command-palette-item-icon">{renderCommandIcon(item.icon)}</span>
        <span className="command-palette-item-copy">
          <strong>{item.label}</strong>
          <small>{item.disabledReason ?? item.meta}</small>
        </span>
        {!item.disabled && <kbd>{item.shortcut ?? "↵"}</kbd>}
      </button>
    );
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

  function renderWorkspaceDashboard() {
    const codeDocuments = documents.filter((document) => document.type === "code");
    const noteDocuments = documents.filter((document) => document.type === "note");
    const canvasDocuments = documents.filter((document) => document.type === "canvas");
    const foldersCount = fileNodes.filter((fileNode) => fileNode.kind === "folder").length;
    const fileCount = Math.max(0, fileNodes.length - foldersCount);
    const folderUsage = getFileTreeChartData().slice(0, 5);
    const folderUsageMax = Math.max(1, ...folderUsage.map((item) => item.files + item.folders));
    const completedRuns = jobRuns.filter((run) => run.status === "completed").length;
    const failedRuns = jobRuns.filter((run) => run.status === "failed").length;
    const cancelledRuns = jobRuns.filter((run) => run.status === "cancelled").length;
    const activeRuns = jobRuns.length - completedRuns - failedRuns - cancelledRuns;
    const latestRun = jobRuns[0] ?? null;
    const recentDocuments = [...documents]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 4);
    const continueDocument = recentDocuments[0] ?? null;
    const memberCount = activeWorkspace?.members.length ?? 0;
    const latestActivityAt = activityEvents[0]?.createdAt ?? null;
    const commentsWithContext = [...workspaceComments]
      .sort((left, right) => Number(Boolean(left.resolvedAt)) - Number(Boolean(right.resolvedAt)) || Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 4)
      .map((comment) => ({
      ...comment,
      documentTitle: documents.find((document) => document.id === comment.documentId)?.title ?? "Unknown file"
      }));
    const continueFileNode = continueDocument ? fileNodes.find((fileNode) => fileNode.documentId === continueDocument.id) ?? null : null;
    const continuePathParts = continueFileNode ? [continueFileNode.name] : continueDocument ? [continueDocument.title] : [];
    let continueParentId = continueFileNode?.parentId ?? null;

    while (continueParentId) {
      const parent = fileNodes.find((fileNode) => fileNode.id === continueParentId);
      if (!parent) break;
      continuePathParts.unshift(parent.name);
      continueParentId = parent.parentId;
    }

    const continueActivity = continueDocument
      ? activityEvents.find((event) => event.documentTitle === continueDocument.title) ?? null
      : null;
    const visibleMembers = activeWorkspace?.members.slice(0, membersManageOpen ? activeWorkspace.members.length : 5) ?? [];

    return (
      <section className="workspace-dashboard-view">
        <header className="workspace-dashboard-header">
          <div className="workspace-dashboard-identity">
            <span className="workspace-dashboard-mark">{activeWorkspace?.abbreviation ?? "SL"}</span>
            <div>
              <h1>{activeWorkspace?.name ?? "Slate workspace"}</h1>
              <p>{activeWorkspace?.settings.description || "Code, canvas, notes, and team context in one workspace."}</p>
              <small>
                {documents.length} {documents.length === 1 ? "document" : "documents"} · {memberCount} {memberCount === 1 ? "member" : "members"} · {jobRuns.length} {jobRuns.length === 1 ? "run" : "runs"}
                {latestActivityAt ? ` · last activity ${formatRelativeTime(latestActivityAt)}` : ""}
              </small>
            </div>
          </div>
          <div className="workspace-dashboard-header-actions">
            <div className="workspace-dashboard-context-group">
              <div className="workspace-dashboard-status" aria-label="Workspace status">
                <span className={`connection-pill ${syncState === "saving" ? "connection-saving" : syncState === "offline" || syncState === "blocked" ? "connection-offline" : ""}`} title={statusDetail}><i />{statusText.toLowerCase()}</span>
                <span className={`connection-pill realtime-${realtimeState} ${isRealtimeRecovering(realtimeState) ? "workspace-status-warning" : ""}`} title={realtimeStatusDetail}><i />{realtimeStatusText.toLowerCase()}</span>
              </div>
              <button aria-label={`Open ${memberCount} workspace members`} className="workspace-dashboard-member-stack" onClick={openDashboardMembers} title="Open workspace members" type="button">
                {activeWorkspace?.members.slice(0, 4).map((member) => (
                  <span className={`avatar avatar-${member.color}`} key={member.id} title={`${member.name} · ${member.role}`}>{member.initials}</span>
                ))}
                {memberCount > 4 && <small>+{memberCount - 4}</small>}
              </button>
            </div>
            <button className={continueDocument ? "workspace-dashboard-primary-action secondary" : "workspace-dashboard-primary-action"} disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-file.ts")} type="button">
              <FilePlusIcon />
              New document
            </button>
            <button className="workspace-dashboard-primary-action secondary" disabled={!canEdit} onClick={() => { setGitImportOpen(true); setGitImportError(null); }} type="button">
              <GithubIcon />
              Import GitHub
            </button>
          </div>
        </header>

        {gitImportOpen && (
          <form className="git-import-form" onSubmit={importGitRepository}>
            <input autoFocus disabled={gitImportPending} onChange={(event) => setGitImportUrl(event.target.value)} placeholder="https://github.com/owner/repository" required type="url" value={gitImportUrl} />
            <small>Imports up to 25 supported text files from a public GitHub repository.</small>
            {gitImportError && <strong>{gitImportError}</strong>}
            <div>
              <button disabled={gitImportPending} type="submit">{gitImportPending ? "Importing…" : "Import repository"}</button>
              <button disabled={gitImportPending} onClick={() => { setGitImportOpen(false); setGitImportError(null); }} type="button">Cancel</button>
            </div>
          </form>
        )}

        <article className="workspace-continue-surface">
          <div className="workspace-dashboard-card-heading workspace-continue-heading">
            <div>
              <span>Continue working</span>
              <small>{continueDocument ? "Pick up from the latest workspace change" : "Create the first surface in this workspace"}</small>
            </div>
          </div>
          {continueDocument ? (
            <div className="workspace-continue-content">
              <button className={`workspace-continue-document document-type-${continueDocument.type}`} onClick={() => selectDocument(continueDocument.id)} type="button">
                <span className="workspace-continue-icon">{renderDocumentTypeIcon(continueDocument.type)}</span>
                <span className="workspace-continue-copy">
                  {continuePathParts.length > 1 && <small>{continuePathParts.slice(0, -1).join(" / ")}</small>}
                  <strong>{continueDocument.title}</strong>
                  <span>{continueDocument.type === "code" ? "Code" : continueDocument.type === "note" ? "Note" : "Canvas"} · updated {formatRelativeTime(continueDocument.updatedAt)}</span>
                </span>
                <span className="workspace-continue-presence">
                  <small>{continueActivity?.actorName ?? payload?.activeUser.name ?? "Workspace team"} · <strong>{statusText}</strong></small>
                </span>
              </button>
              <div className="workspace-continue-actions">
                <button className="primary" onClick={() => selectDocument(continueDocument.id)} type="button">Open</button>
                {continueDocument.type === "code" && (
                  <button disabled={!canViewLogs || !canEdit || jobRuns.some((run) => run.documentId === continueDocument.id && (run.status === "pending" || run.status === "running"))} onClick={() => void runDocument(continueDocument)} type="button">
                    <PlayIcon />
                    Run
                  </button>
                )}
                <button onClick={() => { selectDocument(continueDocument.id); navigateWorkspaceView("ai"); setSidePanelCollapsed(true); }} type="button">
                  <AiIcon />
                  Ask AI
                </button>
                {canInvite && (
                  <button onClick={inviteTeammates} type="button">
                    <UsersIcon />
                    Invite
                  </button>
                )}
                <button onClick={() => openDocumentHistory(continueDocument.id)} type="button">
                  <RefreshIcon />
                  History
                </button>
              </div>
            </div>
          ) : (
            <div className="workspace-continue-empty">
              <strong>Your workspace is ready for its first document.</strong>
              <p>Start with executable code, a shared note, or a visual canvas.</p>
              <div>
                <button disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-file.ts")} type="button"><CodeIcon />Create code file</button>
                <button disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-note.md")} type="button"><NoteIcon />Create note</button>
                <button disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-canvas.canvas")} type="button"><CanvasIcon />Create canvas</button>
              </div>
            </div>
          )}
        </article>

        <div className="workspace-overview-heading">
          <span>Workspace overview</span>
        </div>

        <div className="workspace-dashboard-grid">
          <article className="workspace-dashboard-card dashboard-card-documents">
            <div className="workspace-dashboard-card-heading">
              <div><span>Documents</span><small>Recently updated</small></div>
              <button onClick={() => navigateWorkspaceView("files")} type="button">Open files</button>
            </div>
            <div className="workspace-dashboard-doc-types">
              <button onClick={() => beginFileCreation("document", undefined, "new-file.ts")} type="button">
                <CodeIcon />
                <strong>{codeDocuments.length}</strong>
                <span>Code files</span>
              </button>
              <button onClick={() => beginFileCreation("document", undefined, "new-note.md")} type="button">
                <NoteIcon />
                <strong>{noteDocuments.length}</strong>
                <span>Notes</span>
              </button>
              <button onClick={() => beginFileCreation("document", undefined, "new-canvas.canvas")} type="button">
                <CanvasIcon />
                <strong>{canvasDocuments.length}</strong>
                <span>Canvases</span>
              </button>
            </div>
            <div className="workspace-dashboard-recent-docs">
              {recentDocuments.map((document) => (
                <button key={document.id} onClick={() => selectDocument(document.id)} type="button">
                  {document.type === "code" ? <CodeIcon /> : document.type === "note" ? <NoteIcon /> : <CanvasIcon />}
                  <strong>{document.title}</strong>
                  <small>{formatRelativeTime(document.updatedAt)}</small>
                </button>
              ))}
              {recentDocuments.length === 0 && <p>No documents yet. Create one above to get started.</p>}
            </div>
          </article>

          {canViewLogs && <article className="workspace-dashboard-card dashboard-card-activity">
            <div className="workspace-dashboard-card-heading">
              <div><span>Recent activity</span><small>Latest workspace changes</small></div>
              <button onClick={() => navigateWorkspaceView("activity")} type="button">View all</button>
            </div>
            <div className="workspace-dashboard-feed">
              {activityEvents.slice(0, 5).map((event, index) => {
                const eventDocument = event.documentTitle ? documents.find((document) => document.title === event.documentTitle) ?? null : null;
                const previousActorName = index > 0 ? activityEvents[index - 1]?.actorName ?? null : null;
                const showActorName = index === 0 || previousActorName !== event.actorName;
                return (
                  <button key={event.id} onClick={() => eventDocument ? selectDocument(eventDocument.id) : navigateWorkspaceView("activity")} type="button">
                    <span>{renderActivityEventIcon(event)}</span>
                    <div>
                      <strong>{showActorName && <b>{event.actorName ?? "System"} </b>}{activityLabel(event)}</strong>
                      <small>{event.documentTitle ? `${event.documentTitle} · ` : ""}{formatRelativeTime(event.createdAt)}</small>
                    </div>
                  </button>
                );
              })}
              {activityEvents.length === 0 && <p>Changes to documents, comments, runs, members, and invites will appear here.</p>}
            </div>
          </article>}

          {canViewLogs && <article className="workspace-dashboard-card dashboard-card-runs">
            <div className="workspace-dashboard-card-heading">
              <div><span>Runs</span><small>Execution status</small></div>
              {latestRun && <button onClick={() => openDashboardRun(latestRun)} type="button">View history</button>}
            </div>
            {latestRun ? (
              <button className={`workspace-dashboard-latest-run run-status-${latestRun.status}`} onClick={() => openDashboardRun(latestRun)} type="button">
                <span>{latestRun.status}</span>
                <strong>{latestRun.documentTitle ?? "Workspace run"}</strong>
                <small>{formatRelativeTime(latestRun.createdAt)} · {formatRunDuration(latestRun)}</small>
                {(latestRun.status === "pending" || latestRun.status === "running") && <i>Open run</i>}
              </button>
            ) : (
              <div className="workspace-dashboard-empty-compact">
                <strong>No runs yet</strong>
                <button disabled={!codeDocuments[0] || !canEdit} onClick={() => codeDocuments[0] ? void runDocument(codeDocuments[0]) : undefined} type="button">Run your first check</button>
              </div>
            )}
            <p className="workspace-dashboard-run-summary">{completedRuns} passed · {failedRuns} failed · {cancelledRuns} cancelled · {activeRuns} running</p>
          </article>}

          <article className="workspace-dashboard-card dashboard-card-structure">
            <div className="workspace-dashboard-card-heading">
              <div><span>Project structure</span><small>{foldersCount} folders · {fileCount} files</small></div>
              <button onClick={() => navigateWorkspaceView("files")} type="button">Open explorer</button>
            </div>
            <div className="workspace-dashboard-tree-list" aria-label="Largest folders">
              {folderUsage.map((item) => (
                <button className="workspace-dashboard-tree-row" key={item.id} onClick={() => openDashboardFolder(item.id)} type="button">
                  <div className="workspace-dashboard-tree-row-top">
                    <strong title={item.label}>{item.label}</strong>
                    <small>{item.files} {item.files === 1 ? "file" : "files"}{item.folders > 0 ? ` · ${item.folders} ${item.folders === 1 ? "folder" : "folders"}` : ""}</small>
                  </div>
                  <span className="workspace-dashboard-tree-bar">
                    <i style={{ width: `${Math.max(4, (item.files + item.folders) / folderUsageMax * 100)}%` }} />
                  </span>
                </button>
              ))}
              {folderUsage.length === 0 && <p>No structure yet. Create the first file or folder to begin.</p>}
            </div>
            <div className="workspace-file-tree-chart-legend">
              <span>{foldersCount} folders</span>
              <span>{fileCount} files</span>
              <span>{documents.length} docs</span>
            </div>
          </article>

          <article className="workspace-dashboard-card workspace-dashboard-members-card dashboard-card-members" ref={membersCardRef}>
            <div className="workspace-dashboard-card-heading">
              <div><span>Members</span><small>{memberCount} people in this workspace</small></div>
              <div className="workspace-dashboard-members-heading">
                {canManageMembers && (
                  <button onClick={() => { setMembersManageOpen((current) => !current); setMemberRoleMenuOpenId(null); }} type="button">
                    {membersManageOpen ? "Done" : "Manage"}
                  </button>
                )}
                <b>{memberCount}</b>
              </div>
            </div>
            <div className="workspace-dashboard-members">
              {visibleMembers.map((member) => {
                const isCurrentUser = member.id === payload?.activeUser.id;

                return (
                  <div className="workspace-dashboard-member-row" key={member.id}>
                    <span className={`avatar avatar-${member.color}`}>{member.initials}</span>
                    <div className="workspace-dashboard-member-identity">
                      <strong>{member.name}{isCurrentUser ? " · You" : ""}</strong>
                      <span>{member.email}</span>
                    </div>
                    {membersManageOpen && !isCurrentUser ? (
                      <>
                        <div className="workspace-dashboard-role-menu" data-open={memberRoleMenuOpenId === member.id ? "true" : "false"}>
                          <button disabled={memberActionPendingId === member.id} onClick={() => setMemberRoleMenuOpenId((current) => current === member.id ? null : member.id)} type="button">
                            <span>{member.role}</span>
                            <ChevronDownIcon />
                          </button>
                          {memberRoleMenuOpenId === member.id && (
                            <div role="menu">
                              {(["editor", "viewer"] as WorkspaceRole[]).map((role) => (
                                <button className={member.role === role ? "active" : ""} disabled={member.role === role || memberActionPendingId === member.id} key={role} onClick={() => void updateMemberRole(member.id, role)} role="menuitem" type="button">{role}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="workspace-dashboard-member-actions">
                          <button className="workspace-dashboard-block-member" disabled={memberActionPendingId === member.id} onClick={() => void blockMember(member)} type="button">Block</button>
                          <button className="workspace-dashboard-remove-member" disabled={memberActionPendingId === member.id} onClick={() => void removeMember(member)} type="button">
                            {memberActionPendingId === member.id ? "..." : "Remove"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <span className="workspace-dashboard-role-static">{member.role}</span>
                    )}
                  </div>
                );
              })}
              {!membersManageOpen && memberCount > visibleMembers.length && <button className="workspace-dashboard-members-more" onClick={() => setMembersManageOpen(true)} type="button">View all {memberCount} members</button>}
              {memberActionError && <strong className="member-action-error">{memberActionError}</strong>}
              {canManageMembers && activeWorkspace && activeWorkspace.blockedUsers.length > 0 && (
                <div className="workspace-dashboard-blocked-users">
                  <strong>Blocked users</strong>
                  {activeWorkspace.blockedUsers.map((blockedUser) => (
                    <div key={blockedUser.id}>
                      <span className={`avatar avatar-${blockedUser.color}`}>{blockedUser.initials}</span>
                      <span><b>{blockedUser.name}</b><small>{blockedUser.email}</small></span>
                      <button disabled={memberActionPendingId === blockedUser.id} onClick={() => void unblockUser(blockedUser)} type="button">
                        {memberActionPendingId === blockedUser.id ? "..." : "Unblock"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {canInvite && (
                <div className="workspace-dashboard-share-box">
                  <div className="workspace-dashboard-invite-form">
                    <input autoComplete="email" onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" type="email" value={inviteEmail} />
                    <select aria-label="Invite role" onChange={(event) => setInviteRole(event.target.value === "editor" ? "editor" : "viewer")} value={inviteRole}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button className="primary-control" disabled={inviteSubmitting} onClick={createInvite} type="button">
                      {inviteSubmitting ? "Sending" : "Send invite"}
                    </button>
                  </div>
                  {inviteError && <strong className="auth-error">{inviteError}</strong>}
                  {activeWorkspace && activeWorkspace.invites.length > 0 && (
                    <div className="workspace-dashboard-invites">
                      {activeWorkspace.invites.slice(0, 3).map((invite) => (
                        <div key={invite.id}>
                          <span>{invite.email ?? "Link invite"}</span>
                          <button disabled={invite.acceptedAt !== null || invite.declinedAt !== null || invite.revokedAt !== null || inviteActionPendingId === invite.id} onClick={() => void revokeInvite(invite.id)} type="button">
                            {inviteActionPendingId === invite.id ? "..." : invite.acceptedAt ? "Accepted" : invite.declinedAt ? "Declined" : invite.revokedAt ? "Revoked" : "Revoke"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </article>
        </div>
      </section>
    );
  }

  function getFileTreeChartData() {
    const rootNodes = fileNodes.filter((fileNode) => fileNode.parentId === null);
    const rootFolders = rootNodes.filter((fileNode) => fileNode.kind === "folder");
    const rootFiles = rootNodes.filter((fileNode) => fileNode.kind === "document").length;
    const countChildren = (folderId: string): { files: number; folders: number } => {
      const children = fileNodes.filter((fileNode) => fileNode.parentId === folderId);
      return children.reduce((counts, child) => {
        if (child.kind === "folder") {
          const nestedCounts = countChildren(child.id);
          return {
            files: counts.files + nestedCounts.files,
            folders: counts.folders + 1 + nestedCounts.folders
          };
        }

        return {
          files: counts.files + 1,
          folders: counts.folders
        };
      }, { files: 0, folders: 0 });
    };

    const folderData = rootFolders.map((folder) => {
      const counts = countChildren(folder.id);
      return {
        files: counts.files,
        folders: counts.folders,
        id: folder.id,
        label: folder.name
      };
    });

    const rootData = rootFiles > 0 || folderData.length === 0 ? [{
      files: rootFiles,
      folders: rootFolders.length,
      id: "root",
      label: "Root"
    }] : [];

    return [...rootData, ...folderData]
      .sort((left, right) => right.files + right.folders - (left.files + left.folders) || left.label.localeCompare(right.label))
      .slice(0, 5);
  }

  function renderWorkspaceActivity() {
    const normalizedSearch = activitySearch.trim().toLowerCase();
    const activityFilters: { id: ActivityFilter; label: string }[] = [
      { id: "all", label: "All activity" },
      { id: "documents", label: "Documents" },
      { id: "runs", label: "Runs" },
      { id: "members", label: "Members" },
      { id: "ai", label: "AI" }
    ];
    const visibleActivityEvents = activityEvents.filter((event) => {
      if (activityFilter !== "all" && activityCategory(event) !== activityFilter) return false;
      if (!normalizedSearch) return true;
      return [event.actorName, event.documentTitle, activityLabel(event), event.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
    const groupedActivityEvents = visibleActivityEvents.reduce<Map<string, ActivityEvent[]>>((groups, event) => {
      const groupLabel = activityDateGroupLabel(event.createdAt);
      groups.set(groupLabel, [...groups.get(groupLabel) ?? [], event]);
      return groups;
    }, new Map());

    return (
      <section className="workspace-activity-view">
        <div className="workspace-activity-content">
          <div className="workspace-view-heading workspace-activity-heading">
            <h1>Activity</h1>
            <p>Workspace changes · {activityEvents.length} {activityEvents.length === 1 ? "event" : "events"}</p>
          </div>
          <div className="workspace-activity-controls">
            <div className="workspace-activity-filters" aria-label="Activity filters" role="tablist">
              {activityFilters.map((filter) => (
                <button aria-selected={activityFilter === filter.id} className={activityFilter === filter.id ? "active" : ""} key={filter.id} onClick={() => setActivityFilter(filter.id)} role="tab" type="button">
                  {filter.label}
                </button>
              ))}
            </div>
            <input aria-label="Search activity" onChange={(event) => setActivitySearch(event.target.value)} placeholder="Search activity" type="search" value={activitySearch} />
          </div>
          <div className="workspace-activity-groups">
            {[...groupedActivityEvents.entries()].map(([groupLabel, groupEvents]) => (
              <section className="workspace-activity-group" key={groupLabel}>
                <h2>{groupLabel}</h2>
                <div className="workspace-activity-list">
                  {groupEvents.map((event) => (
                    <article key={event.id}>
                      <span className={`activity-event-icon activity-event-${activityCategory(event)}`}>{renderActivityEventIcon(event)}</span>
                      <div>
                        <strong>{shortActorName(event.actorName)} {activityLabel(event)}</strong>
                        <p>{event.documentTitle ? event.documentTitle : `Workspace: ${activeWorkspace?.name ?? "Slate"}`}</p>
                      </div>
                      <time title={new Date(event.createdAt).toLocaleString()}>{formatActivityTime(event.createdAt)}</time>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {visibleActivityEvents.length === 0 && <div className="workspace-view-empty">{activityEvents.length === 0 ? "No activity yet." : "No events match this filter."}</div>}
            {activityError && <strong className="panel-error">{activityError}</strong>}
          </div>
        </div>
      </section>
    );
  }

  function renderCommentFilters() {
    const filters: { id: CommentFilter; label: string }[] = [
      { id: "all", label: "All" },
      { id: "open", label: "Open" },
      { id: "resolved", label: "Resolved" }
    ];

    return (
      <div aria-label="Filter comments" className="comment-filters" role="group">
        {filters.map((filter) => (
          <button aria-pressed={commentFilter === filter.id} className={commentFilter === filter.id ? "active" : ""} key={filter.id} onClick={() => setCommentFilter(filter.id)} type="button">
            {filter.label}
          </button>
        ))}
      </div>
    );
  }

  function renderCommentComposer() {
    if (!activeTab || !canEdit) return null;
    return (
      <form className="comment-composer" data-expanded={commentDraft.trim().length > 0 ? "true" : "false"} onSubmit={(event) => { event.preventDefault(); void createComment(); }}>
        <textarea aria-label="New comment" onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment..." value={commentDraft} />
        <div className="comment-composer-footer">
          <small title={commentComposerContext}>{commentComposerContext}</small>
          <button disabled={commentPending || commentDraft.trim().length === 0} type="submit">{commentPending ? "Posting…" : "Comment"}</button>
        </div>
      </form>
    );
  }

  function renderCommentEmptyState() {
    if (!activeTab) {
      return <div className="comment-empty-state"><strong>No document selected</strong><span>Open a document to view its discussion.</span></div>;
    }
    if (activeDocumentComments.length === 0) {
      return <div className="comment-empty-state"><strong>No comments yet</strong><span>Start a discussion about this document.</span></div>;
    }
    return <div className="comment-empty-state"><strong>No {commentFilter} comments</strong><span>Choose another filter to view the rest of the discussion.</span></div>;
  }

  function renderCommentItem(comment: DocumentComment, presentation: "compact" | "activity" = "compact") {
    if (presentation === "activity") {
      const actionLabel = comment.resolvedAt ? "Reopen" : "Resolve";
      const activityLabel = comment.resolvedAt ? "resolved a comment" : "commented on a document";
      return (
        <article className={comment.resolvedAt ? "workspace-comment-activity-item resolved" : "workspace-comment-activity-item"} key={comment.id}>
          <span className="workspace-comment-activity-avatar">{comment.authorName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{comment.authorName} {activityLabel}</strong>
            <p>{comment.body}</p>
          </div>
          <div className="workspace-comment-activity-meta">
            <time title={new Date(comment.createdAt).toLocaleString()}>{formatRelativeTime(comment.createdAt)}</time>
            {canEdit && <button disabled={commentActionPendingId === comment.id} onClick={() => void setCommentResolved(comment.id, !comment.resolvedAt)} type="button">{actionLabel}</button>}
          </div>
        </article>
      );
    }
    return (
      <article className={comment.resolvedAt ? "comment-item resolved" : "comment-item"} key={comment.id}>
        <header className="comment-meta">
          <span className="avatar avatar-gray">{comment.authorName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{comment.authorName}</strong>
            <time title={new Date(comment.createdAt).toLocaleString()}>{formatRelativeTime(comment.createdAt)}</time>
          </div>
          {comment.resolvedAt && <b className="comment-status">Resolved</b>}
        </header>
        <small className="comment-context">{getCommentContextLabel(comment)}</small>
        <p className="comment-body">{comment.body}</p>
        {canEdit && (
          <footer className="comment-actions">
            <button disabled={commentActionPendingId === comment.id} onClick={() => void setCommentResolved(comment.id, !comment.resolvedAt)} type="button">
              {comment.resolvedAt ? "Reopen" : "Resolve"}
            </button>
          </footer>
        )}
      </article>
    );
  }

  function renderWorkspaceComments() {
    return (
      <section className="workspace-comments-view">
        <div className="workspace-comments-content">
          <div className="workspace-view-heading workspace-comments-heading">
            <h1>Comments</h1>
            <p>{activeTab ? `Document discussion · ${activeDocumentComments.length} ${activeDocumentComments.length === 1 ? "comment" : "comments"}` : "Open a document to view its discussion."}</p>
          </div>
          <div className="workspace-comments-controls">
            {renderCommentFilters()}
            <input aria-label="Search comments" onChange={(event) => setCommentSearch(event.target.value)} placeholder="Search comments" type="search" value={commentSearch} />
          </div>
          <div className="workspace-comments-groups">
            <div className={visibleWorkspaceComments.length === 0 ? "workspace-comments-list empty" : "workspace-comments-list"}>
              {visibleWorkspaceComments.map((comment) => renderCommentItem(comment, "activity"))}
              {visibleWorkspaceComments.length === 0 && renderCommentEmptyState()}
            </div>
            {renderCommentComposer()}
            {commentError && <strong className="panel-error">{commentError}</strong>}
          </div>
        </div>
      </section>
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
      "invite.declined": "declined an invite",
      "invite.revoked": "revoked an invite",
      "member.blocked": "blocked a member",
      "member.removed": "removed a member",
      "member.role_changed": "changed a member role",
      "member.unblocked": "unblocked a user",
      "workspace.ownership_transferred": "transferred workspace ownership",
      "workspace.renamed": "renamed the workspace",
      "ai.action.applied": "applied an AI draft",
      "ai.action.discarded": "discarded an AI draft",
      "ai.draft.created": "prepared AI draft changes",
      "run.cancelled": "cancelled a run",
      "run.completed": "completed a run",
      "run.failed": "failed a run",
      "run.queued": "queued a run"
    };

    return labels[event.type] ?? event.type.replace(/\./g, " ");
  }

  function activityCategory(event: ActivityEvent): ActivityFilter {
    if (event.type.startsWith("ai.")) return "ai";
    if (event.type.startsWith("run.")) return "runs";
    if (event.type.startsWith("member.") || event.type.startsWith("invite.") || event.type.startsWith("workspace.")) return "members";
    if (event.type.startsWith("document.") || event.type.startsWith("file.") || event.type.startsWith("comment.") || event.type.startsWith("git_import.")) return "documents";
    return "all";
  }

  function activityDateGroupLabel(timestamp: string) {
    const eventDate = new Date(timestamp);
    const today = new Date();
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const elapsedDays = Math.round((todayDay - eventDay) / 86_400_000);
    if (elapsedDays === 0) return "Today";
    if (elapsedDays === 1) return "Yesterday";
    return eventDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: eventDate.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }

  function formatActivityTime(timestamp: string) {
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60_000));
    if (elapsedMinutes < 1) return "Just now";
    if (elapsedMinutes < 60) return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function shortActorName(actorName: string | null) {
    return actorName?.trim().split(/\s+/)[0] || "System";
  }

  function renderActivityEventIcon(event: ActivityEvent) {
    if (event.type.startsWith("ai.")) return <CommandIcon />;
    if (event.type.startsWith("comment.") || event.type.startsWith("member.") || event.type.startsWith("invite.")) return <UsersIcon />;
    if (event.type.startsWith("run.")) return <PlayIcon />;
    if (event.type.startsWith("workspace.")) return <DashboardIcon />;
    if (event.type.startsWith("document.") || event.type.startsWith("file.") || event.type.startsWith("git_import.")) return <FileIcon />;
    return event.actorName ? event.actorName.slice(0, 1).toUpperCase() : "S";
  }

  function buildCommandPaletteItems() {
    const query = commandPaletteQuery.trim().toLowerCase();
    const items: CommandPaletteItem[] = [];

    if (canEdit) {
      items.push({ group: "Commands", icon: "note", id: "create-note", label: "Create note", meta: "Document", run: () => beginFileCreation("document", undefined, "new-note.md"), shortcut: "↵" });
      items.push({ group: "Commands", icon: "code", id: "create-code", label: "Create code file", meta: "Document", run: () => beginFileCreation("document", undefined, "new-file.ts"), shortcut: "↵" });
      items.push({ group: "Commands", icon: "canvas", id: "create-canvas", label: "Create canvas", meta: "Document", run: () => beginFileCreation("document", undefined, "new-canvas.canvas"), shortcut: "↵" });
      items.push({ group: "Commands", icon: "github", id: "import-github", label: "Import public GitHub repository", meta: "Workspace", run: () => { setGitImportOpen(true); setGitImportError(null); }, shortcut: "↵" });
    }

    const runDisabledReason = !activeTab ? "No file selected" : !canViewLogs ? "Owner access required" : !canEdit ? "Editor access required" : activeTab.type !== "code" ? "Open a code file" : hasActiveRun || runState === "running" ? "A run is already active" : undefined;
    const snapDisabledReason = !activeTab ? "No file selected" : !canEdit ? "Editor access required" : activeTab.type !== "canvas" ? "Open a canvas" : undefined;
    items.push({ disabled: !activeWorkspace, disabledReason: "No workspace selected", group: "Commands", icon: "invite", id: "invite", label: "Invite teammate", meta: "Workspace", run: inviteTeammates, shortcut: "↵" });
    items.push({ group: "Commands", icon: "theme", id: "switch-theme", label: "Switch theme", meta: theme === "dark" ? "Use light theme" : "Use dark theme", run: toggleTheme, shortcut: "↵" });
    items.push({ disabled: Boolean(runDisabledReason), disabledReason: runDisabledReason, group: "Commands", icon: "run", id: "run-current-file", label: "Run current file", meta: activeTab?.title ?? "No file selected", run: () => void runActiveDocument(), shortcut: "↵" });
    items.push({ disabled: Boolean(snapDisabledReason), disabledReason: snapDisabledReason, group: "Commands", icon: "canvas", id: "toggle-canvas-snap", label: "Toggle snap", meta: activeTab?.type === "canvas" ? activeTab.title : "Canvas only", run: toggleActiveCanvasSnap, shortcut: "↵" });

    for (const document of [...documents].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))) {
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
        run: () => selectDocument(document.id),
        shortcut: "↵"
      });
    }

    if (!query) {
      const commands = items.filter((item) => item.group === "Commands");
      const recentFiles = items.filter((item) => item.group === "Search").slice(0, 5);
      return [...commands, ...recentFiles];
    }
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

  function openSettings(focusAccount: boolean) {
    setSettingsFocusAccount(focusAccount);
    setSettingsOpen(true);
  }

  async function logout() {
    setSettingsOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }

  const updateProfile = useCallback((user: WorkspacePayload["activeUser"]) => {
    setPayload((current) => {
      if (!current) return current;

      const updateMember = (member: WorkspaceMember) => (
        member.id === user.id ? { ...member, color: user.color, email: user.email, initials: user.initials, name: user.name } : member
      );

      return {
        ...current,
        activeUser: {
          ...current.activeUser,
          ...user
        },
        activeWorkspace: current.activeWorkspace ? {
          ...current.activeWorkspace,
          members: current.activeWorkspace.members.map(updateMember)
        } : null,
        workspaces: current.workspaces.map((workspace) => ({
          ...workspace,
          members: workspace.members.map(updateMember)
        }))
      };
    });
  }, []);

  const updateWorkspaceSettings = useCallback((settings: WorkspaceSettings) => {
    setPayload((current) => {
      if (!current?.activeWorkspace) return current;

      return {
        ...current,
        activeWorkspace: {
          ...current.activeWorkspace,
          settings
        }
      };
    });
  }, []);

  const updateWorkspaceIdentity = useCallback((workspace: { abbreviation: string; id: string; name: string; slug: string }) => {
    setPayload((current) => {
      if (!current) return current;

      return {
        ...current,
        activeWorkspace: current.activeWorkspace?.id === workspace.id ? {
          ...current.activeWorkspace,
          abbreviation: workspace.abbreviation,
          name: workspace.name,
          slug: workspace.slug
        } : current.activeWorkspace,
        workspaces: current.workspaces.map((currentWorkspace) => (
          currentWorkspace.id === workspace.id
            ? { ...currentWorkspace, abbreviation: workspace.abbreviation, name: workspace.name, slug: workspace.slug }
            : currentWorkspace
        ))
      };
    });
  }, []);

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
      const glyphClassName = fileNode.kind === "folder" ? (isExpanded ? "tree-node-glyph open" : "tree-node-glyph folder") : null;
      const presenceUsers = fileNode.documentId ? documentPresenceById[fileNode.documentId] ?? [] : [];

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
              {glyphClassName && <span className={glyphClassName} />}
              {fileNode.kind === "folder" ? <FolderIcon /> : renderDocumentTypeIcon(documentType)}
              <strong>{fileNode.name}</strong>
              {presenceUsers.length > 0 && (
                <span className="tree-node-presence" aria-label={`${presenceUsers.length} active collaborator${presenceUsers.length === 1 ? "" : "s"}`}>
                  {presenceUsers.slice(0, 3).map((user) => (
                    <i key={user.id} style={{ background: user.color }} title={`${user.name} is in this file`}>{user.initials}</i>
                  ))}
                </span>
              )}
            </button>
          )}
          {fileNode.kind === "folder" && isExpanded && renderFileNodes(fileNode.id, depth + 1)}
        </div>
      );
        })}
      </>
    );
  }

  if (error && workspaceErrorVariant && workspaceErrorVariant !== "unavailable") {
    return <ContextualErrorPage variant={workspaceErrorVariant} />;
  }

  if (error && !payload) {

    return (
      <WorkspaceLoadingShell error={error} onRetry={retryWorkspaceLoad} standaloneMessenger={standaloneMessenger} theme={theme} view={standaloneMessenger ? "messenger" : workspaceView} />
    );
  }

  if (loading && !payload) {
    if (!showLoadingShell) {
      return <main aria-busy="true" className={`workspace-shell workspace-loading-delay${standaloneMessenger ? " workspace-shell-messenger-only" : ""}`} data-theme={theme} />;
    }

    return (
      <WorkspaceLoadingShell messageVisible={showLoadingMessage} standaloneMessenger={standaloneMessenger} theme={theme} view={standaloneMessenger ? "messenger" : workspaceView} />
    );
  }

  const contextFileNode = fileContextMenu ? fileNodes.find((fileNode) => fileNode.id === fileContextMenu.fileNodeId) ?? null : null;
  const contextParentId = contextFileNode?.kind === "folder" ? contextFileNode.id : contextFileNode?.parentId ?? null;
  const commandPaletteItems = buildCommandPaletteItems();
  const enabledCommandPaletteItems = commandPaletteItems.filter((item) => !item.disabled);
  const commandPaletteHasQuery = commandPaletteQuery.trim().length > 0;
  const commandPaletteCommands = commandPaletteItems.filter((item) => item.group === "Commands" && !item.disabled);
  const commandPaletteRecentFiles = commandPaletteItems.filter((item) => item.group === "Search");
  const commandPaletteUnavailable = commandPaletteItems.filter((item) => item.group === "Commands" && item.disabled);
  const terminalLines = selectedRun ? runTerminalLines(selectedRun) : outputLines;
  const latestRunStatus = selectedRun?.status ?? runBadge;
  const latestRunDuration = selectedRun ? formatRunDuration(selectedRun) : null;
  const canSwitchWorkspace = (payload?.workspaces.length ?? 0) > 1;
  const messengerSurface = (standaloneMessenger || workspaceView === "messenger") && activeWorkspaceIsSettled && activeWorkspace && payload?.activeUser ? (
    <WorkspaceMessengerPage
      activeUser={payload.activeUser}
      members={activeWorkspace.members}
      onAccessDenied={handleMessengerAccessDenied}
      onAuthenticationRequired={handleMessengerAuthenticationRequired}
      onConversationChange={handleMessengerConversationChange}
      onUnreadRefresh={messengerUnread.refresh}
      realtimeEvent={messengerRealtime.event}
      realtimeState={messengerRealtime.state}
      requestedConversationId={queryConversationId}
      workspaceId={activeWorkspace.id}
      workspaceName={activeWorkspace.name}
    />
  ) : null;

  if (standaloneMessenger) {
    return (
      <main className="workspace-shell workspace-shell-messenger-only" data-theme={theme}>
        <section aria-busy={!activeWorkspaceIsSettled && Boolean(activeWorkspace)} className="workspace-main workspace-main-collapsed workspace-main-messenger workspace-main-messenger-only" inert={!activeWorkspaceIsSettled && Boolean(activeWorkspace)}>
          {messengerSurface}
        </section>
      </main>
    );
  }

  return (
    <main className={sidebarCollapsed ? "workspace-shell workspace-sidebar-collapsed" : "workspace-shell"} data-theme={theme}>
      <aside className={mobileSidebarOpen ? "workspace-sidebar mobile-open" : "workspace-sidebar"} data-guide-target="navigation">
        <div className="workspace-sidebar-top">
          <div className="workspace-switcher" data-open={workspaceSwitcherOpen ? "true" : "false"} ref={workspaceSwitcherRef}>
            <button aria-expanded={workspaceSwitcherOpen} aria-haspopup="menu" aria-label={workspaceSwitcherOpen ? "Close workspace switcher" : "Open workspace switcher"} className="workspace-identity-card" disabled={!activeWorkspace} onClick={() => setWorkspaceSwitcherOpen((open) => activeWorkspace ? !open : false)} title={workspaceSwitcherOpen ? undefined : canSwitchWorkspace ? "Switch workspace" : "Current workspace"} type="button">
              <span className="workspace-identity-mark">{(activeWorkspace?.abbreviation ?? "S").slice(0, 2).toUpperCase()}</span>
              <span className="workspace-identity-copy">
                <strong>{activeWorkspace?.name ?? "Slate"}</strong>
                <small>{payload?.activeUser.email ?? activeWorkspace?.abbreviation ?? "workspace"}</small>
              </span>
              <span className={workspaceSwitcherOpen ? "workspace-identity-chevron open" : "workspace-identity-chevron"} />
            </button>
            {workspaceSwitcherOpen && activeWorkspace && (
              <div className="workspace-switcher-menu" role="menu">
                <div className="workspace-switcher-list">
                  {payload?.workspaces.map((workspace) => {
                    const active = workspace.id === activeWorkspace.id;
                    return (
                      <button aria-current={active ? "true" : undefined} className={active ? "active" : ""} key={workspace.id} onClick={() => { selectWorkspace(workspace.id); setWorkspaceSwitcherOpen(false); }} role="menuitem" type="button">
                        <span className="workspace-switcher-option-copy"><strong>{workspace.name}</strong><small>{workspace.documentCount} docs</small></span>
                        {active && <span aria-hidden="true" className="workspace-switcher-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="workspace-switcher-footer">
                  <button disabled={workspaceCreating} onClick={() => { setWorkspaceCreateOpen(true); setWorkspaceSwitcherOpen(false); setWorkspaceCreateError(null); }} role="menuitem" type="button">
                    <span aria-hidden="true" className="workspace-switcher-create-icon">+</span>
                    <strong>{workspaceCreating ? "Creating workspace" : "Create workspace"}</strong>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="workspace-nav-section">
            <span className="workspace-nav-label">Workspace</span>
            <nav className="workspace-nav">
              <button className={workspaceView === "dashboard" ? "active" : ""} onClick={() => navigateWorkspaceView("dashboard")} type="button">
                <SidebarDashboardIcon />
                <span>Dashboard</span>
              </button>
              {canViewLogs && <button className={workspaceView === "activity" ? "active" : ""} onClick={() => navigateWorkspaceView("activity")} type="button">
                <SidebarActivityIcon />
                <span>Activity</span>
              </button>}
            </nav>
          </div>
          <div className="workspace-nav-section">
            <span className="workspace-nav-label">Tools</span>
            <nav className="workspace-nav">
              <button onClick={openCommandPalette} type="button">
                <SidebarCommandIcon />
                <span>Command</span>
              </button>
              <button className={workspaceView === "ai" ? "active" : ""} disabled={!activeWorkspaceIsSettled} onClick={() => { navigateWorkspaceView("ai"); setSidePanelCollapsed(true); }} type="button">
                <SidebarAiIcon />
                <span>AI Assistant</span>
              </button>
            </nav>
          </div>
        </div>
        <section className="sidebar-section file-section">
          <div className="explorer-header">
            <p>Files <small>{fileNodes.length}</small></p>
            <div className="explorer-actions">
              <div className="sidebar-create-control">
                <button aria-expanded={creationMenuOpen} aria-haspopup="menu" aria-label="Create file or folder" data-tooltip="New" disabled={!activeWorkspace || !canEdit} onClick={toggleCreationMenu} ref={createDocumentButtonRef} type="button"><SidebarPlusIcon /></button>
                {creationMenuOpen && (
                  <div className="create-menu" role="menu">
                    <button aria-label="Create code tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-file.ts")}><CodeIcon />Code file</button>
                    <button aria-label="Create note tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-note.md")}><NoteIcon />Note</button>
                    <button aria-label="Create canvas tab" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-canvas.canvas")}><CanvasIcon />Canvas</button>
                    <button aria-label="Create folder" disabled={!canEdit || fileTreePending} onClick={() => beginFileCreation("folder")}><FolderPlusIcon />Folder</button>
                  </div>
                )}
              </div>
              <button aria-label="Refresh files" data-tooltip="Refresh" disabled={!activeWorkspaceIsSettled} onClick={() => activeWorkspaceIsSettled && activeWorkspace ? void loadWorkspace(activeWorkspace.id) : undefined} type="button">
                <SidebarRefreshIcon />
              </button>
              <button aria-label="Hide sidebar" data-tooltip="Hide sidebar" onClick={() => { if (window.matchMedia("(max-width: 960px)").matches) setMobileSidebarOpen(false); else setSidebarCollapsed(true); setCreationMenuOpen(false); setWorkspaceSwitcherOpen(false); }} type="button"><SidebarToggleIcon /></button>
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
        <aside className="workspace-beta-card" aria-label="Slate beta testing">
          <span>Beta</span>
          <a href="mailto:feedback@slate.dev?subject=Slate%20beta%20feedback">Feedback</a>
        </aside>
        {payload?.activeUser && (
          <div className="workspace-account">
            <div className="workspace-footer-actions">
              <button onClick={() => openSettings(false)} type="button">
                <SidebarSettingsIcon />
                <span>Settings</span>
              </button>
              <button onClick={() => window.location.assign("mailto:support@slate.dev?subject=Slate%20support")} type="button">
                <SidebarSupportIcon />
                <span>Help &amp; support</span>
              </button>
            </div>
            <button
              aria-label="Open profile and account settings"
              className="workspace-user"
              onClick={() => openSettings(true)}
              type="button"
            >
              <span className={`avatar avatar-${payload.activeUser.color}`}>{payload.activeUser.initials}</span>
              <div>
                <strong>{payload.activeUser.name}</strong>
                <small>{payload.activeUser.email}</small>
              </div>
            </button>
          </div>
        )}
      </aside>
      {mobileSidebarOpen && <button aria-label="Close navigation" className="workspace-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} type="button" />}

      <header className="workspace-topbar" data-guide-target="controls">
        {sidebarCollapsed && <button aria-label="Show sidebar" className="workspace-sidebar-restore" onClick={() => setSidebarCollapsed(false)} title="Show sidebar" type="button"><SidebarToggleIcon /></button>}
        <button aria-expanded={mobileSidebarOpen} aria-label="Toggle navigation" className="workspace-mobile-nav-toggle" onClick={() => setMobileSidebarOpen((open) => !open)} type="button">
          <CollapseIcon />
        </button>
        <div className="breadcrumbs">
          {workspaceView === "files" && activeTab && (
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
        {workspaceView === "files" && <DocumentHistoryPanel canEdit={canEdit} documentId={activeTab?.id ?? null} onRestore={applyRestoredDocument} />}
        <div className="topbar-spacer" />
        {loading && payload && <span className="workspace-refreshing-status">Refreshing…</span>}
        <div className="topbar-actions">
          {workspaceView === "files" && (
            <div className="workspace-header-status" aria-label="Workspace status">
              {workspaceView === "files" && activeTab?.type === "canvas" && <span className={`connection-pill ${syncState === "saving" ? "connection-saving" : syncState === "offline" || syncState === "blocked" ? "connection-offline" : ""}`} title={statusDetail}><i />{statusText.toLowerCase()}</span>}
              <span className={`connection-pill realtime-${realtimeState} ${isRealtimeRecovering(realtimeState) ? "workspace-status-warning" : ""}`} title={realtimeStatusDetail}><i />{realtimeStatusText.toLowerCase()}</span>
              {workspaceView === "files" && activeTab?.type !== "canvas" && <span className={`connection-pill ${syncState === "saving" ? "connection-saving" : syncState === "offline" || syncState === "blocked" ? "connection-offline" : ""}`} title={statusDetail}><i />{statusText.toLowerCase()}</span>}
            </div>
          )}
          {workspaceView === "files" && activeTab?.type === "code" && (
            <div className="environment-selector" data-open={executionEnvironmentOpen ? "true" : "false"} ref={executionEnvironmentRef}>
              <button aria-expanded={executionEnvironmentOpen} aria-haspopup="listbox" disabled={!canViewLogs || !canEdit || hasActiveRun || runState === "running"} onClick={() => setExecutionEnvironmentOpen((open) => !open)} type="button">
                <span>{selectedExecutionEnvironment.label}</span>
              </button>
              {executionEnvironmentOpen && (
                <div className="environment-selector-menu" role="listbox">
                  {executionEnvironments.map((environment) => (
                    <button aria-selected={environment.id === selectedExecutionEnvironmentId} className={environment.id === selectedExecutionEnvironmentId ? "active" : ""} key={environment.id} onClick={() => { setSelectedExecutionEnvironmentId(environment.id); setExecutionEnvironmentOpen(false); }} role="option" type="button">
                      <span>{environment.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {workspaceView === "files" && activeTab?.type === "code" && (
            activeRun ? (
              <button className="run-control" disabled={!canViewLogs || !canEdit} onClick={() => void cancelRun(activeRun)} type="button">Cancel run</button>
            ) : (
              <button className="run-control" disabled={!activeTab || !canViewLogs || !canEdit || runState === "running" || activeTab.type !== "code"} onClick={runActiveDocument} type="button">
                <PlayIcon />
                Run
              </button>
            )
          )}
          {activeWorkspaceIsSettled && (
            <div className="workspace-notifications" data-open={notificationsOpen ? "true" : "false"}>
              <button aria-expanded={notificationsOpen} aria-haspopup="dialog" aria-label="Notifications" className="workspace-notifications-toggle" onClick={() => void toggleNotifications()} title="Notifications" type="button">
                <BellIcon />
                {unreadNotificationCount > 0 && <span>{Math.min(unreadNotificationCount, 9)}</span>}
              </button>
              {notificationsOpen && (
                <section aria-label="Notifications" className="workspace-notifications-popover" role="dialog">
                  <div className="workspace-notifications-heading">
                    <strong>Notifications</strong>
                    <small>{notifications.length} total</small>
                  </div>
                  <div className="workspace-notifications-list">
                    {notifications.map((notification) => {
                      const expired = new Date(notification.invite.expiresAt) <= new Date();
                      const resolved = Boolean(notification.invite.acceptedAt || notification.invite.declinedAt || notification.invite.revokedAt || expired);
                      return (
                        <article className={notification.readAt ? "is-read" : "is-unread"} key={notification.id}>
                          <span><UsersIcon /></span>
                          <div>
                            <strong>{notification.inviterName} invited you to {notification.workspace.name}</strong>
                            <small>{notification.invite.role} · {formatRelativeTime(notification.createdAt)}</small>
                            {!resolved && (
                              <div className="workspace-notification-actions">
                                <button disabled={notificationActionPendingId === notification.id} onClick={() => void respondToInvite(notification, "accept")} type="button">Accept</button>
                                <button disabled={notificationActionPendingId === notification.id} onClick={() => void respondToInvite(notification, "decline")} type="button">Decline</button>
                              </div>
                            )}
                            {resolved && <em>{notification.invite.acceptedAt ? "Accepted" : notification.invite.declinedAt ? "Declined" : notification.invite.revokedAt ? "Revoked" : "Expired"}</em>}
                          </div>
                        </article>
                      );
                    })}
                    {notifications.length === 0 && <p>No notifications yet.</p>}
                    {notificationError && <strong className="auth-error">{notificationError}</strong>}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </header>

      <section aria-busy={!activeWorkspaceIsSettled && Boolean(activeWorkspace)} className={`workspace-main workspace-main-collapsed${shouldUseCanvasWorkbench ? " workspace-main-canvas" : ""}${workspaceView === "ai" ? " workspace-main-ai" : ""}${workspaceView === "messenger" ? " workspace-main-messenger" : ""}`} data-guide-target="content" inert={!activeWorkspaceIsSettled && Boolean(activeWorkspace)}>
        {workspaceView === "dashboard" && renderWorkspaceDashboard()}
        {workspaceView === "activity" && (canViewLogs ? renderWorkspaceActivity() : renderWorkspaceDashboard())}
        {messengerSurface}
        {workspaceView === "ai" && activeWorkspaceIsSettled && activeWorkspace && (
          <section aria-label="AI Assistant" className="workspace-ai-page">
            <WorkspaceAiPanel
              activeDocument={aiContextDocument ? { id: aiContextDocument.id, title: aiContextDocument.title, updatedAt: aiContextDocument.updatedAt } : null}
              canApply={canEdit}
              key={activeWorkspace.id}
              onBeforeApply={prepareAiContext}
              onBeforeSend={prepareAiContext}
              onWorkspaceChange={applyAiWorkspaceChange}
              workspaceId={activeWorkspace.id}
              workspaceName={activeWorkspace.name}
            />
          </section>
        )}
        {workspaceView === "files" && (!activeWorkspace || !activeTab) && (
          <section className="workspace-start">
            <div className="workspace-start-copy">
              <span>{activeWorkspace ? "Start anywhere" : "Slate workspace"}</span>
              <h1>{activeWorkspace ? "Code, notes, and canvas share the same room." : "Create the room before you add the work."}</h1>
              <p>{activeWorkspace ? "Pick the first surface. Runs, comments, history, and teammates will stay attached as the work moves between modes." : "A workspace gives Slate one place to keep source, decisions, sketches, invites, and execution history."}</p>
              {!activeWorkspace && (
                <div className="empty-actions">
                  <button className="primary-control" disabled={workspaceCreating} onClick={() => { setWorkspaceCreateOpen(true); setWorkspaceCreateError(null); }} type="button">
                    Create workspace
                  </button>
                  {workspaceCreateError && <strong className="workspace-create-error">{workspaceCreateError}</strong>}
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
        )}
        {activeWorkspace && activeTab && (
          <section
            aria-hidden={workspaceView !== "files"}
            className={`${openedDocuments.length > 1 ? "workbench-surface" : "workbench-surface single-document"}${workspaceView !== "files" ? " workspace-document-surface-inactive" : ""}`}
            inert={workspaceView !== "files"}
          >
            {openedDocuments.length > 1 && (
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
                <button aria-label="New code file" className="document-tabbar-add" disabled={!canEdit} onClick={() => beginFileCreation("document", undefined, "new-file.ts")} title="New code file" type="button">+</button>
              </div>
            )}
            <div className="document-stage">
              {activeTab.type === "code" && (
                <CollaborativeEditor documentId={activeTab.id} fileName={activeTab.title} initialValue={activeTab.content} language={activeTab.language ?? "plaintext"} onContentChange={(content) => saveDocument(activeTab.id, { content })} onPresenceChange={(users) => updateDocumentPresence(activeTab.id, users)} onRealtimeStatusChange={handleRealtimeStatusChange} readOnly={!canEdit} registerDocumentFlush={registerDocumentFlush} roomName={activeWorkspace.id} theme={theme} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
              {activeTab.type === "note" && (
                <CollaborativeNote documentId={activeTab.id} initialValue={activeTab.content} onContentChange={(content) => saveDocument(activeTab.id, { content })} onPresenceChange={(users) => updateDocumentPresence(activeTab.id, users)} onRealtimeStatusChange={handleRealtimeStatusChange} readOnly={!canEdit} registerDocumentFlush={registerDocumentFlush} roomName={activeWorkspace.id} title={activeTab.title} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
              {activeTab.type === "canvas" && (
                <CollaborativeCanvas canvasId={activeTab.id} initialState={activeTab.canvasState} interactionEnabled={activeWorkspaceIsSettled && workspaceView === "files"} onLocalSaveBlockedChange={handleCanvasLocalSaveBlockedChange} onPresenceChange={(users) => updateDocumentPresence(activeTab.id, users)} onRealtimeStatusChange={handleRealtimeStatusChange} onStateChange={(documentId, canvasState) => saveDocument(documentId, { canvasState })} readOnly={!canEdit} registerDocumentFlush={registerDocumentFlush} roomName={activeWorkspace.id} saveValidationError={documentValidationErrors[activeTab.id] ?? null} theme={theme} title={activeTab.title} user={{ color: awarenessColors[payload?.activeUser.color ?? "blue"] ?? awarenessColors.blue, id: payload?.activeUser.id ?? "local", initials: payload?.activeUser.initials ?? "ME", name: payload?.activeUser.name ?? "You", role: activeMember?.role ?? "viewer" }} />
              )}
            </div>
          </section>
        )}
      </section>
      {commandPaletteOpen && (
        <div className="command-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandPaletteSelectedIndex((index) => enabledCommandPaletteItems.length === 0 ? 0 : Math.min(enabledCommandPaletteItems.length - 1, index + 1));
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
              <SearchIcon />
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
              <kbd>⌘ K</kbd>
            </div>
            <div className="command-palette-body">
              {commandPaletteItems.length === 0 ? (
                <div className="command-empty">
                  <strong>No results for “{commandPaletteQuery.trim()}”</strong>
                  <span>Try searching by file name, content, or command.</span>
                </div>
              ) : commandPaletteHasQuery ? (
                <section className="command-palette-section">
                  <h2>Search results</h2>
                  <div>{commandPaletteItems.map(renderCommandPaletteItem)}</div>
                </section>
              ) : (
                <>
                  {commandPaletteCommands.length > 0 && (
                    <section className="command-palette-section">
                      <h2>Commands</h2>
                      <div>{commandPaletteCommands.map(renderCommandPaletteItem)}</div>
                    </section>
                  )}
                  {commandPaletteRecentFiles.length > 0 && (
                    <section className="command-palette-section">
                      <h2>Recent files</h2>
                      <div>{commandPaletteRecentFiles.map(renderCommandPaletteItem)}</div>
                    </section>
                  )}
                  {commandPaletteUnavailable.length > 0 && (
                    <section className="command-palette-section command-palette-unavailable">
                      <h2>Unavailable</h2>
                      <div>{commandPaletteUnavailable.map(renderCommandPaletteItem)}</div>
                    </section>
                  )}
                </>
              )}
            </div>
            <footer className="command-palette-footer">
              <span><kbd>↑↓</kbd> Navigate</span>
              <span><kbd>↵</kbd> Open</span>
              <span><kbd>esc</kbd> Close</span>
            </footer>
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
      {workspaceCreateOpen && (
        <div className="workspace-create-layer" onClick={() => !workspaceCreating && setWorkspaceCreateOpen(false)}>
          <form
            aria-labelledby="workspace-create-title"
            aria-modal="true"
            className="workspace-create-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (workspaceNameIsValid) void createWorkspace();
            }}
            role="dialog"
          >
            <div className="workspace-create-heading">
              <span>New workspace</span>
              <h2 id="workspace-create-title">Create a workspace</h2>
              <p>Name the room before Slate creates files, notes, and shared context around it.</p>
            </div>
            <label className="cairn-field">
              <span className="cairn-field__label">Workspace name</span>
              <input autoFocus className="cairn-field__input" disabled={workspaceCreating} onChange={(event) => setWorkspaceNameDraft(event.target.value)} placeholder="acme-prod" spellCheck={false} type="text" value={workspaceNameDraft} />
              <span className="cairn-field__help">Lowercase letters, numbers, and hyphens.</span>
            </label>
            {workspaceCreateError && <strong className="workspace-create-error">{workspaceCreateError}</strong>}
            <div className="workspace-create-actions">
              <button disabled={workspaceCreating} onClick={() => setWorkspaceCreateOpen(false)} type="button">Cancel</button>
              <button className="primary-control" disabled={workspaceCreating || !workspaceNameIsValid} type="submit">{workspaceCreating ? "Creating" : "Create workspace"}</button>
            </div>
          </form>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          activeMemberRole={activeWorkspaceIsSettled ? activeMember?.role ?? "guest" : "guest"}
          activeUser={payload?.activeUser ?? null}
          confirmDeleteFiles={confirmDeleteFiles}
          focusAccount={settingsFocusAccount}
          key={settingsFocusAccount ? "profile" : "settings"}
          theme={theme}
          workspace={activeWorkspaceIsSettled ? activeWorkspace : null}
          workspacesCount={payload?.workspaces.length ?? 0}
          onClose={() => setSettingsOpen(false)}
          onConfirmDeleteFilesChange={setConfirmDeleteFiles}
          onLogout={logout}
          onProfileUpdated={updateProfile}
          onThemeChange={setSelectedTheme}
          onWorkspaceIdentityUpdated={updateWorkspaceIdentity}
          onWorkspaceOwnershipTransferred={async () => { if (activeWorkspace) await loadWorkspace(activeWorkspace.id); }}
          onWorkspaceSettingsUpdated={updateWorkspaceSettings}
        />
      )}
      <WorkspaceGuide />
    </main>
  );
}

function runTerminalLines(run: WorkspaceJobRun) {
  const lines = [
    `$ slate run ${run.documentTitle ?? "document"}`,
    `environment=${run.kind}`,
    `status=${run.status}`,
    `duration=${formatRunDuration(run)}`,
    ...run.output.split(/\r?\n/).filter(Boolean)
  ];

  if (run.error) {
    lines.push(`error=${run.error}`);
  }

  return lines;
}

function formatRunDuration(run: WorkspaceJobRun) {
  const startedAt = Date.parse(run.createdAt);
  const endedAt = Date.parse(run.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return "unknown";
  return `${Math.max(0, endedAt - startedAt)}ms`;
}
