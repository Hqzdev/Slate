"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CanvasIcon, DeveloperIcon, ExtensionsIcon, GlobeIcon, KeyboardIcon, MoonIcon, SearchIcon, SettingsIcon, ShieldIcon, SunIcon, UsageIcon, UsersIcon } from "@/components/Icons";

type WorkspaceTheme = "dark" | "light";
type SettingsPageId = "general" | "shortcuts" | "agents" | "workspace" | "privacy" | "usage" | "proxy" | "extensions" | "developer";

type SettingsUser = {
  color: string;
  email: string;
  initials: string;
  name: string;
};

type SettingsMember = {
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
  role: string;
};

type SettingsDocument = {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
};

type SettingsFileNode = {
  id: string;
  kind: string;
  name: string;
};

type SettingsJobRun = {
  id: string;
  status: string;
};

type SettingsWorkspace = {
  documents: SettingsDocument[];
  fileNodes: SettingsFileNode[];
  invites: { id: string }[];
  jobRuns: SettingsJobRun[];
  members: SettingsMember[];
  name: string;
  slug: string;
};

type SettingsModalProps = {
  activeMemberRole: string;
  activeUser: SettingsUser | null;
  confirmDeleteFiles: boolean;
  onClose: () => void;
  onConfirmDeleteFilesChange: (enabled: boolean) => void;
  onLogout: () => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  theme: WorkspaceTheme;
  workspace: SettingsWorkspace | null;
  workspacesCount: number;
};

type SettingsNavItem = {
  group: string;
  icon: ReactNode;
  id: SettingsPageId;
  label: string;
};

const settingsNavItems: SettingsNavItem[] = [
  { group: "Settings", icon: <SettingsIcon />, id: "general", label: "General" },
  { group: "Settings", icon: <KeyboardIcon />, id: "shortcuts", label: "Shortcuts" },
  { group: "Settings", icon: <UsersIcon />, id: "agents", label: "Agents" },
  { group: "Settings", icon: <CanvasIcon />, id: "workspace", label: "Workspace" },
  { group: "Settings", icon: <ShieldIcon />, id: "privacy", label: "Privacy" },
  { group: "Settings", icon: <UsageIcon />, id: "usage", label: "Usage" },
  { group: "Workspace app", icon: <GlobeIcon />, id: "proxy", label: "Proxy" },
  { group: "Workspace app", icon: <ExtensionsIcon />, id: "extensions", label: "Extensions" },
  { group: "Workspace app", icon: <DeveloperIcon />, id: "developer", label: "Developer" }
];

const shortcutRows = [
  ["Command palette", "⌘ K"],
  ["Create note", "N"],
  ["Create code file", "C"],
  ["Create canvas", "V"],
  ["Run current file", "⌘ Enter"],
  ["Close settings", "Esc"]
];

export function SettingsModal({ activeMemberRole, activeUser, confirmDeleteFiles, onClose, onConfirmDeleteFilesChange, onLogout, onThemeChange, theme, workspace, workspacesCount }: SettingsModalProps) {
  const [selectedPage, setSelectedPage] = useState<SettingsPageId>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const [openLastWorkspace, setOpenLastWorkspace] = useState(true);
  const [restoreOpenTabs, setRestoreOpenTabs] = useState(true);
  const [sharePresence, setSharePresence] = useState(true);
  const [showEmail, setShowEmail] = useState(false);
  const [localTelemetry, setLocalTelemetry] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("http://localhost:8787");
  const [proxyAuth, setProxyAuth] = useState(true);
  const [markdownExtension, setMarkdownExtension] = useState(true);
  const [canvasExtension, setCanvasExtension] = useState(true);
  const [terminalExtension, setTerminalExtension] = useState(false);
  const [debugLogs, setDebugLogs] = useState(false);
  const [experimentalCanvasTools, setExperimentalCanvasTools] = useState(false);

  const visibleGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = query ? settingsNavItems.filter((item) => item.label.toLowerCase().includes(query) || item.group.toLowerCase().includes(query)) : settingsNavItems;
    return items.reduce<Record<string, SettingsNavItem[]>>((groups, item) => {
      groups[item.group] = [...(groups[item.group] ?? []), item];
      return groups;
    }, {});
  }, [searchQuery]);

  return (
    <div className="settings-modal-layer" onClick={onClose}>
      <section aria-modal="true" className="settings-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        <SettingsSidebar groups={visibleGroups} searchQuery={searchQuery} selectedPage={selectedPage} onSearchChange={setSearchQuery} onSelectPage={setSelectedPage} />
        <div className="settings-modal-content">
          <button aria-label="Close settings" className="settings-modal-close" onClick={onClose} type="button">×</button>
          {selectedPage === "general" && (
            <GeneralSettings
              activeMemberRole={activeMemberRole}
              activeUser={activeUser}
              confirmDeleteFiles={confirmDeleteFiles}
              openLastWorkspace={openLastWorkspace}
              restoreOpenTabs={restoreOpenTabs}
              theme={theme}
              workspaceName={workspace?.name ?? "your workspace"}
              onConfirmDeleteFilesChange={onConfirmDeleteFilesChange}
              onLogout={onLogout}
              onOpenLastWorkspaceChange={setOpenLastWorkspace}
              onRestoreOpenTabsChange={setRestoreOpenTabs}
              onThemeChange={onThemeChange}
            />
          )}
          {selectedPage === "shortcuts" && <ShortcutsSettings />}
          {selectedPage === "agents" && <AgentsSettings activeUser={activeUser} members={workspace?.members ?? []} />}
          {selectedPage === "workspace" && <WorkspaceSettings workspace={workspace} workspacesCount={workspacesCount} />}
          {selectedPage === "privacy" && (
            <PrivacySettings
              localTelemetry={localTelemetry}
              sharePresence={sharePresence}
              showEmail={showEmail}
              onLocalTelemetryChange={setLocalTelemetry}
              onSharePresenceChange={setSharePresence}
              onShowEmailChange={setShowEmail}
            />
          )}
          {selectedPage === "usage" && <UsageSettings workspace={workspace} workspacesCount={workspacesCount} />}
          {selectedPage === "proxy" && (
            <ProxySettings
              proxyAuth={proxyAuth}
              proxyEnabled={proxyEnabled}
              proxyUrl={proxyUrl}
              onProxyAuthChange={setProxyAuth}
              onProxyEnabledChange={setProxyEnabled}
              onProxyUrlChange={setProxyUrl}
            />
          )}
          {selectedPage === "extensions" && (
            <ExtensionsSettings
              canvasExtension={canvasExtension}
              markdownExtension={markdownExtension}
              terminalExtension={terminalExtension}
              onCanvasExtensionChange={setCanvasExtension}
              onMarkdownExtensionChange={setMarkdownExtension}
              onTerminalExtensionChange={setTerminalExtension}
            />
          )}
          {selectedPage === "developer" && (
            <DeveloperSettings
              debugLogs={debugLogs}
              experimentalCanvasTools={experimentalCanvasTools}
              onDebugLogsChange={setDebugLogs}
              onExperimentalCanvasToolsChange={setExperimentalCanvasTools}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsSidebar({ groups, onSearchChange, onSelectPage, searchQuery, selectedPage }: { groups: Record<string, SettingsNavItem[]>; onSearchChange: (value: string) => void; onSelectPage: (page: SettingsPageId) => void; searchQuery: string; selectedPage: SettingsPageId }) {
  const groupEntries = Object.entries(groups);

  return (
    <aside className="settings-modal-sidebar">
      <label className="settings-search">
        <SearchIcon />
        <input aria-label="Search settings" placeholder="Search" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} />
      </label>
      {groupEntries.length === 0 ? (
        <div className="settings-empty-nav">No settings found</div>
      ) : groupEntries.map(([group, items]) => (
        <div className="settings-nav-group" key={group}>
          <span>{group}</span>
          {items.map((item) => (
            <button className={selectedPage === item.id ? "active" : ""} key={item.id} onClick={() => onSelectPage(item.id)} type="button">
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}

function GeneralSettings({ activeMemberRole, activeUser, confirmDeleteFiles, onConfirmDeleteFilesChange, onLogout, onOpenLastWorkspaceChange, onRestoreOpenTabsChange, onThemeChange, openLastWorkspace, restoreOpenTabs, theme, workspaceName }: { activeMemberRole: string; activeUser: SettingsUser | null; confirmDeleteFiles: boolean; onConfirmDeleteFilesChange: (enabled: boolean) => void; onLogout: () => void; onOpenLastWorkspaceChange: (enabled: boolean) => void; onRestoreOpenTabsChange: (enabled: boolean) => void; onThemeChange: (theme: WorkspaceTheme) => void; openLastWorkspace: boolean; restoreOpenTabs: boolean; theme: WorkspaceTheme; workspaceName: string }) {
  return (
    <>
      <SettingsHeader description="Workspace behavior and confirmations for Slate." title="General" />
      <SettingsSection title="Appearance">
        <SettingsRow description="Choose the workspace color mode." title="Theme">
          <div className="settings-theme-toggle">
            <button aria-label="Dark theme" className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")} title="Dark theme" type="button"><MoonIcon /></button>
            <button aria-label="Light theme" className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")} title="Light theme" type="button"><SunIcon /></button>
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Startup">
        <SettingsRow description={`Restore ${workspaceName} when Slate opens.`} title="Open last workspace">
          <SettingsSwitch checked={openLastWorkspace} onChange={onOpenLastWorkspaceChange} />
        </SettingsRow>
        <SettingsRow description="Reopen the documents that were active before closing the workspace." title="Restore open tabs">
          <SettingsSwitch checked={restoreOpenTabs} onChange={onRestoreOpenTabsChange} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Behavior">
        <SettingsRow description="Ask before removing files or folders from the workspace." title="Confirm before deleting files">
          <SettingsSwitch checked={confirmDeleteFiles} onChange={onConfirmDeleteFilesChange} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Account">
        {activeUser && (
          <div className="settings-card-row settings-profile-row">
            <span className={`avatar avatar-${activeUser.color}`}>{activeUser.initials}</span>
            <div>
              <strong>{activeUser.name}</strong>
              <p>{activeUser.email}</p>
            </div>
            <small>{activeMemberRole}</small>
          </div>
        )}
        <button className="settings-signout-control" onClick={onLogout} type="button">Sign out</button>
      </SettingsSection>
    </>
  );
}

function ShortcutsSettings() {
  return (
    <>
      <SettingsHeader description="Keyboard commands available in the workspace." title="Shortcuts" />
      <SettingsSection title="Workspace">
        <div className="settings-list-card">
          {shortcutRows.map(([label, shortcut]) => (
            <div className="settings-shortcut-row" key={label}>
              <span>{label}</span>
              <kbd>{shortcut}</kbd>
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

function AgentsSettings({ activeUser, members }: { activeUser: SettingsUser | null; members: SettingsMember[] }) {
  return (
    <>
      <SettingsHeader description="People currently attached to this workspace." title="Agents" />
      <SettingsSection title="Members">
        <div className="settings-list-card">
          {members.length === 0 && <div className="settings-empty-card">No members in this workspace yet.</div>}
          {members.map((member) => (
            <div className="settings-member-row" key={member.id}>
              <span className={`avatar avatar-${member.color}`}>{member.initials}</span>
              <div>
                <strong>{member.name}{activeUser?.email === member.email ? " · You" : ""}</strong>
                <p>{member.email}</p>
              </div>
              <small>{member.role}</small>
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

function WorkspaceSettings({ workspace, workspacesCount }: { workspace: SettingsWorkspace | null; workspacesCount: number }) {
  return (
    <>
      <SettingsHeader description="Current workspace details and local workspace counts." title="Workspace" />
      <SettingsSection title="Overview">
        <div className="settings-grid">
          <SettingsStat label="Workspace" value={workspace?.name ?? "No workspace"} />
          <SettingsStat label="Slug" value={workspace?.slug ?? "none"} />
          <SettingsStat label="All workspaces" value={String(workspacesCount)} />
          <SettingsStat label="Open documents" value={String(workspace?.documents.length ?? 0)} />
        </div>
      </SettingsSection>
      <SettingsSection title="Documents">
        <div className="settings-list-card">
          {(workspace?.documents ?? []).slice(0, 6).map((document) => (
            <div className="settings-document-row" key={document.id}>
              <div>
                <strong>{document.title}</strong>
                <p>{document.type}</p>
              </div>
              <small>{new Date(document.updatedAt).toLocaleDateString()}</small>
            </div>
          ))}
          {(workspace?.documents.length ?? 0) === 0 && <div className="settings-empty-card">No documents yet.</div>}
        </div>
      </SettingsSection>
    </>
  );
}

function PrivacySettings({ localTelemetry, onLocalTelemetryChange, onSharePresenceChange, onShowEmailChange, sharePresence, showEmail }: { localTelemetry: boolean; onLocalTelemetryChange: (enabled: boolean) => void; onSharePresenceChange: (enabled: boolean) => void; onShowEmailChange: (enabled: boolean) => void; sharePresence: boolean; showEmail: boolean }) {
  return (
    <>
      <SettingsHeader description="Control what your workspace shares inside the app." title="Privacy" />
      <SettingsSection title="Presence">
        <SettingsRow description="Show teammates when you are active in a document." title="Share presence">
          <SettingsSwitch checked={sharePresence} onChange={onSharePresenceChange} />
        </SettingsRow>
        <SettingsRow description="Show your email in workspace member lists." title="Show email to teammates">
          <SettingsSwitch checked={showEmail} onChange={onShowEmailChange} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Diagnostics">
        <SettingsRow description="Keep usage diagnostics local to this browser session." title="Local diagnostics only">
          <SettingsSwitch checked={localTelemetry} onChange={onLocalTelemetryChange} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function UsageSettings({ workspace, workspacesCount }: { workspace: SettingsWorkspace | null; workspacesCount: number }) {
  const completedRuns = workspace?.jobRuns.filter((run) => run.status === "completed").length ?? 0;

  return (
    <>
      <SettingsHeader description="Workspace usage and activity totals." title="Usage" />
      <SettingsSection title="Summary">
        <div className="settings-grid">
          <SettingsStat label="Workspaces" value={String(workspacesCount)} />
          <SettingsStat label="Documents" value={String(workspace?.documents.length ?? 0)} />
          <SettingsStat label="Files" value={String(workspace?.fileNodes.length ?? 0)} />
          <SettingsStat label="Members" value={String(workspace?.members.length ?? 0)} />
          <SettingsStat label="Invites" value={String(workspace?.invites.length ?? 0)} />
          <SettingsStat label="Completed runs" value={String(completedRuns)} />
        </div>
      </SettingsSection>
    </>
  );
}

function ProxySettings({ onProxyAuthChange, onProxyEnabledChange, onProxyUrlChange, proxyAuth, proxyEnabled, proxyUrl }: { onProxyAuthChange: (enabled: boolean) => void; onProxyEnabledChange: (enabled: boolean) => void; onProxyUrlChange: (value: string) => void; proxyAuth: boolean; proxyEnabled: boolean; proxyUrl: string }) {
  return (
    <>
      <SettingsHeader description="Local proxy behavior for workspace integrations." title="Proxy" />
      <SettingsSection title="Connection">
        <SettingsRow description="Route workspace actions through a local proxy endpoint." title="Enable proxy">
          <SettingsSwitch checked={proxyEnabled} onChange={onProxyEnabledChange} />
        </SettingsRow>
        <label className="settings-input-row">
          <span>Proxy URL</span>
          <input value={proxyUrl} onChange={(event) => onProxyUrlChange(event.target.value)} />
        </label>
        <SettingsRow description="Require local authorization before proxy actions run." title="Require authorization">
          <SettingsSwitch checked={proxyAuth} onChange={onProxyAuthChange} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function ExtensionsSettings({ canvasExtension, markdownExtension, onCanvasExtensionChange, onMarkdownExtensionChange, onTerminalExtensionChange, terminalExtension }: { canvasExtension: boolean; markdownExtension: boolean; onCanvasExtensionChange: (enabled: boolean) => void; onMarkdownExtensionChange: (enabled: boolean) => void; onTerminalExtensionChange: (enabled: boolean) => void; terminalExtension: boolean }) {
  return (
    <>
      <SettingsHeader description="Enable workspace capabilities for the current browser session." title="Extensions" />
      <SettingsSection title="Built-in extensions">
        <SettingsRow description="Render markdown notes with formatting and tables." title="Markdown notes">
          <SettingsSwitch checked={markdownExtension} onChange={onMarkdownExtensionChange} />
        </SettingsRow>
        <SettingsRow description="Use canvas blocks, arrows, styles, and snap behavior." title="Canvas tools">
          <SettingsSwitch checked={canvasExtension} onChange={onCanvasExtensionChange} />
        </SettingsRow>
        <SettingsRow description="Show execution surfaces for runnable source files." title="Terminal output">
          <SettingsSwitch checked={terminalExtension} onChange={onTerminalExtensionChange} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function DeveloperSettings({ debugLogs, experimentalCanvasTools, onDebugLogsChange, onExperimentalCanvasToolsChange }: { debugLogs: boolean; experimentalCanvasTools: boolean; onDebugLogsChange: (enabled: boolean) => void; onExperimentalCanvasToolsChange: (enabled: boolean) => void }) {
  return (
    <>
      <SettingsHeader description="Developer controls for testing workspace behavior." title="Developer" />
      <SettingsSection title="Debugging">
        <SettingsRow description="Show extra realtime and save-state logs in the browser console." title="Debug logs">
          <SettingsSwitch checked={debugLogs} onChange={onDebugLogsChange} />
        </SettingsRow>
        <SettingsRow description="Enable in-progress canvas controls for local testing." title="Experimental canvas tools">
          <SettingsSwitch checked={experimentalCanvasTools} onChange={onExperimentalCanvasToolsChange} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function SettingsHeader({ description, title }: { description: string; title: string }) {
  return (
    <header className="settings-content-header">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="settings-content-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SettingsRow({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return (
    <div className="settings-card-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingsSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button aria-pressed={checked} className={checked ? "settings-switch active" : "settings-switch"} onClick={() => onChange(!checked)} type="button">
      <span />
    </button>
  );
}

function SettingsStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
