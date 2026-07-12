export type WorkspaceNavigationView = "activity" | "ai" | "dashboard" | "files" | "messenger";

export type WorkspaceNavigationState = {
  aiConversationId: string | null;
  conversationId: string | null;
  documentId: string | null;
  view: WorkspaceNavigationView;
  workspaceId: string | null;
};

const workspaceViews = new Set<WorkspaceNavigationView>([
  "activity",
  "ai",
  "dashboard",
  "files",
  "messenger"
]);

const aiConversationIdPattern = /^sltx-[a-f0-9]{4}-[a-f0-9]{4}$/;

export class WorkspaceAiRouteMemory {
  private readonly conversationIdsByWorkspaceId = new Map<string, string>();

  get(workspaceId: string) {
    return this.conversationIdsByWorkspaceId.get(workspaceId) ?? null;
  }

  remember(workspaceId: string, conversationId: string) {
    if (!aiConversationIdPattern.test(conversationId)) return;
    this.conversationIdsByWorkspaceId.set(workspaceId, conversationId);
  }
}

export function readWorkspaceNavigation(input: { pathname: string; search: string }): WorkspaceNavigationState {
  const params = new URLSearchParams(input.search);
  const requestedView = params.get("view") as WorkspaceNavigationView | null;
  const aiConversationId = input.pathname.match(/^\/workspace\/ai\/(sltx-[a-f0-9]{4}-[a-f0-9]{4})$/)?.[1] ?? null;
  const messengerRoute = input.pathname === "/workspace/messenger";
  const view = aiConversationId
    ? "ai"
    : messengerRoute || requestedView === "messenger"
      ? "dashboard"
    : requestedView && workspaceViews.has(requestedView)
      ? requestedView
      : "dashboard";
  return {
    aiConversationId,
    conversationId: null,
    documentId: view === "files" ? params.get("documentId") : null,
    view,
    workspaceId: params.get("workspaceId")
  };
}

export function createWorkspaceNavigationUrl(
  currentUrl: string,
  input: {
    aiConversationId?: string | null;
    conversationId?: string | null;
    documentId?: string | null;
    view: WorkspaceNavigationView;
    workspaceId: string | null;
  }
) {
  const url = new URL(currentUrl);
  const view = input.view === "messenger" ? "dashboard" : input.view;
  const aiConversationId = view === "ai" && input.aiConversationId && aiConversationIdPattern.test(input.aiConversationId)
    ? input.aiConversationId
    : null;
  url.pathname = aiConversationId ? `/workspace/ai/${aiConversationId}` : "/workspace";
  url.search = "";
  if (input.workspaceId) url.searchParams.set("workspaceId", input.workspaceId);
  if (!aiConversationId) url.searchParams.set("view", view);
  if (view === "files" && input.documentId) url.searchParams.set("documentId", input.documentId);
  return `${url.pathname}${url.search}`;
}

export function repairWorkspaceNavigationUrl(currentUrl: string, workspaceId: string | null) {
  const url = new URL(currentUrl);
  const navigation = readWorkspaceNavigation(url);
  const workspaceChanged = navigation.workspaceId !== null && navigation.workspaceId !== workspaceId;
  return createWorkspaceNavigationUrl(currentUrl, {
    aiConversationId: workspaceChanged ? null : navigation.aiConversationId,
    conversationId: workspaceChanged ? null : navigation.conversationId,
    documentId: workspaceChanged ? null : navigation.documentId,
    view: navigation.view,
    workspaceId
  });
}
