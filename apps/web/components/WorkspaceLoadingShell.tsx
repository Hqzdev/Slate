"use client";

type WorkspaceLoadingView = "activity" | "ai" | "comments" | "dashboard" | "files" | "messenger";

type WorkspaceLoadingShellProps = {
  error?: string | null;
  messageVisible?: boolean;
  onRetry?: () => void;
  standaloneMessenger?: boolean;
  theme?: "dark" | "light";
  view?: WorkspaceLoadingView;
};

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`workspace-skeleton ${className}`} />;
}

function WorkspaceSidebarSkeleton() {
  return (
    <aside className="workspace-sidebar workspace-loading-sidebar" aria-label="Workspace navigation loading">
      <div className="workspace-sidebar-top">
        <div className="workspace-loading-brand">
          <SkeletonBlock className="workspace-loading-brand-mark" />
          <span>
            <SkeletonBlock className="workspace-loading-line workspace-loading-line-wide" />
            <SkeletonBlock className="workspace-loading-line workspace-loading-line-short" />
          </span>
        </div>
        <div className="workspace-loading-nav-group">
          <SkeletonBlock className="workspace-loading-line workspace-loading-line-label" />
          <SkeletonBlock className="workspace-loading-nav-item" />
          <SkeletonBlock className="workspace-loading-nav-item" />
          <SkeletonBlock className="workspace-loading-nav-item" />
          <SkeletonBlock className="workspace-loading-nav-item" />
        </div>
        <div className="workspace-loading-nav-group">
          <SkeletonBlock className="workspace-loading-line workspace-loading-line-label" />
          <SkeletonBlock className="workspace-loading-nav-item workspace-loading-nav-item-short" />
          <SkeletonBlock className="workspace-loading-nav-item workspace-loading-nav-item-short" />
        </div>
      </div>
      <section className="sidebar-section file-section workspace-loading-files">
        <div className="workspace-loading-section-heading">
          <SkeletonBlock className="workspace-loading-line workspace-loading-line-medium" />
          <SkeletonBlock className="workspace-loading-icon" />
        </div>
        <SkeletonBlock className="workspace-loading-file" />
        <SkeletonBlock className="workspace-loading-file workspace-loading-file-indent" />
        <SkeletonBlock className="workspace-loading-file workspace-loading-file-indent" />
        <SkeletonBlock className="workspace-loading-file" />
      </section>
      <div className="workspace-loading-sidebar-footer">
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-medium" />
        <SkeletonBlock className="workspace-loading-user" />
      </div>
    </aside>
  );
}

function WorkspaceHeaderSkeleton({ messageVisible, view }: { messageVisible: boolean; view: WorkspaceLoadingView }) {
  return (
    <header className="workspace-topbar workspace-loading-topbar">
      <div className="workspace-loading-breadcrumbs">
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-medium" />
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-short" />
      </div>
      <div className="topbar-spacer" />
      {messageVisible && <span className="workspace-loading-status">Loading your workspace…</span>}
      {view === "files" && <SkeletonBlock className="workspace-loading-control" />}
      <SkeletonBlock className="workspace-loading-control workspace-loading-control-icon" />
    </header>
  );
}

function DashboardLoadingContent() {
  return (
    <div className="workspace-loading-content workspace-loading-dashboard">
      <div className="workspace-loading-heading">
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-title" />
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-wide" />
      </div>
      <div className="workspace-loading-card-grid">
        <SkeletonBlock className="workspace-loading-card workspace-loading-card-large" />
        <SkeletonBlock className="workspace-loading-card workspace-loading-card-large" />
        <SkeletonBlock className="workspace-loading-card" />
        <SkeletonBlock className="workspace-loading-card" />
        <SkeletonBlock className="workspace-loading-card" />
        <SkeletonBlock className="workspace-loading-card" />
      </div>
    </div>
  );
}

function FilesLoadingContent() {
  return (
    <div className="workspace-loading-content workspace-loading-editor">
      <div className="workspace-loading-editor-tabs">
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-medium" />
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-short" />
      </div>
      <div className="workspace-loading-editor-body">
        <div className="workspace-loading-gutter">
          {Array.from({ length: 10 }, (_, index) => <SkeletonBlock className="workspace-loading-gutter-line" key={index} />)}
        </div>
        <div className="workspace-loading-code">
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-wide" />
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-medium" />
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-short" />
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-wide workspace-loading-code-line-indent" />
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-medium workspace-loading-code-line-indent" />
          <SkeletonBlock className="workspace-loading-code-line workspace-loading-code-line-short" />
        </div>
      </div>
    </div>
  );
}

function AiLoadingContent() {
  return (
    <div className="workspace-loading-content workspace-loading-ai">
      <SkeletonBlock className="workspace-loading-line workspace-loading-line-title" />
      <div className="workspace-loading-ai-empty" />
      <SkeletonBlock className="workspace-loading-composer" />
    </div>
  );
}

function GenericLoadingContent({ view }: { view: WorkspaceLoadingView }) {
  return (
    <div className="workspace-loading-content workspace-loading-generic">
      <div className="workspace-loading-heading">
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-title" />
        <SkeletonBlock className="workspace-loading-line workspace-loading-line-wide" />
      </div>
      <SkeletonBlock className="workspace-loading-panel" />
      {view === "messenger" && <SkeletonBlock className="workspace-loading-composer" />}
    </div>
  );
}

function WorkspaceErrorContent({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="workspace-loading-content workspace-loading-error" role="alert">
      <div className="workspace-loading-error-mark">!</div>
      <h1>Workspace unavailable</h1>
      <p>We couldn’t load this workspace right now.</p>
      {onRetry && <button onClick={onRetry} type="button">Retry</button>}
      <details>
        <summary>Details</summary>
        <p>{error}</p>
      </details>
    </div>
  );
}

export function WorkspaceLoadingShell({ error = null, messageVisible = false, onRetry, standaloneMessenger = false, theme = "light", view = "dashboard" }: WorkspaceLoadingShellProps) {
  return (
    <main className={standaloneMessenger ? "workspace-shell workspace-shell-messenger-only" : "workspace-shell"} data-theme={theme}>
      {!standaloneMessenger && <WorkspaceSidebarSkeleton />}
      {!standaloneMessenger && <WorkspaceHeaderSkeleton messageVisible={messageVisible} view={view} />}
      <section className={`workspace-main workspace-main-collapsed workspace-loading-main${standaloneMessenger ? " workspace-main-messenger-only" : ""}`}>
        {error ? <WorkspaceErrorContent error={error} onRetry={onRetry} /> : view === "dashboard" ? <DashboardLoadingContent /> : view === "files" ? <FilesLoadingContent /> : view === "ai" ? <AiLoadingContent /> : <GenericLoadingContent view={view} />}
      </section>
    </main>
  );
}
