"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { DeveloperIcon, KeyboardIcon, MoonIcon, SearchIcon, SettingsIcon, ShieldIcon, SunIcon, UsersIcon } from "@/components/Icons";

type WorkspaceTheme = "dark" | "light";
type WorkspaceRole = "owner" | "editor" | "viewer";
type SettingsPageId = "profile" | "general" | "members" | "permissions" | "appearance" | "shortcuts" | "developer";

type SettingsUser = {
  color: string;
  email: string;
  emailVerifiedAt?: string | null;
  id: string;
  initials: string;
  name: string;
  username?: string | null;
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

type SettingsWorkspaceSettings = {
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

type SettingsWorkspace = {
  abbreviation: string;
  documents: SettingsDocument[];
  fileNodes: SettingsFileNode[];
  id: string;
  invites: { id: string }[];
  jobRuns: SettingsJobRun[];
  members: SettingsMember[];
  name: string;
  settings: SettingsWorkspaceSettings;
  slug: string;
};

type SettingsModalProps = {
  activeMemberRole: string;
  activeUser: SettingsUser | null;
  confirmDeleteFiles: boolean;
  focusAccount?: boolean;
  onClose: () => void;
  onConfirmDeleteFilesChange: (enabled: boolean) => void;
  onLogout: () => void;
  onProfileUpdated: (user: SettingsUser) => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  onWorkspaceIdentityUpdated: (workspace: { abbreviation: string; id: string; name: string; slug: string }) => void;
  onWorkspaceOwnershipTransferred: () => Promise<void>;
  onWorkspaceSettingsUpdated: (settings: SettingsWorkspaceSettings) => void;
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

type ProfileDevice = {
  browserName: string;
  createdAt: string;
  current: boolean;
  deviceName: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  lastSeenAt: string;
  operatingSystem: string;
  userAgent: string | null;
};

type ProfilePayload = {
  devices: ProfileDevice[];
  user: SettingsUser;
};

const profileColorOptions = [
  { id: "blue", label: "Blue" },
  { id: "violet", label: "Violet" },
  { id: "teal", label: "Teal" },
  { id: "green", label: "Green" },
  { id: "pink", label: "Pink" },
  { id: "orange", label: "Orange" },
  { id: "gray", label: "Gray" }
];

const settingsNavItems: SettingsNavItem[] = [
  { group: "Account", icon: <UsersIcon />, id: "profile", label: "Profile" },
  { group: "Workspace", icon: <SettingsIcon />, id: "general", label: "General" },
  { group: "Workspace", icon: <UsersIcon />, id: "members", label: "Members" },
  { group: "Workspace", icon: <ShieldIcon />, id: "permissions", label: "Permissions" },
  { group: "App", icon: <SunIcon />, id: "appearance", label: "Appearance" },
  { group: "App", icon: <KeyboardIcon />, id: "shortcuts", label: "Shortcuts" },
  { group: "Advanced", icon: <DeveloperIcon />, id: "developer", label: "Developer" }
];

const shortcutRows = [
  ["Command palette", "⌘ K"],
  ["Run current file", "⌘ Enter"],
  ["Save now", "⌘ S"],
  ["Open settings", "⌘ ,"],
  ["Create note", "⌥ ⌘ N"],
  ["Create code file", "⌥ ⌘ C"],
  ["Create canvas", "⌥ ⌘ V"],
  ["Close tab", "⌥ ⌘ W"],
  ["Next tab", "⌥ ⌘ ]"],
  ["Previous tab", "⌥ ⌘ ["],
  ["Go to tab 1–9", "⌥ ⌘ 1–9"],
  ["Dashboard", "⇧ ⌘ D"],
  ["Activity", "⇧ ⌘ E"],
  ["Toggle theme", "⇧ ⌘ L"],
  ["Close settings", "Esc"]
];

export function SettingsModal({ activeMemberRole, activeUser, confirmDeleteFiles, focusAccount = false, onClose, onConfirmDeleteFilesChange, onLogout, onProfileUpdated, onThemeChange, onWorkspaceIdentityUpdated, onWorkspaceOwnershipTransferred, onWorkspaceSettingsUpdated, theme, workspace, workspacesCount }: SettingsModalProps) {
  const [selectedPage, setSelectedPage] = useState<SettingsPageId>(focusAccount ? "profile" : "general");
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      <section
        aria-modal="true"
        className="settings-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDownCapture={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            searchInputRef.current?.focus();
          }
        }}
        role="dialog"
      >
        <SettingsSidebar groups={visibleGroups} searchInputRef={searchInputRef} searchQuery={searchQuery} selectedPage={selectedPage} onSearchChange={setSearchQuery} onSelectPage={setSelectedPage} />
        <div className="settings-modal-main">
          <header className="settings-modal-toolbar">
            <strong>Settings</strong>
            <span>Workspace and account preferences</span>
            <button aria-label="Close settings" className="settings-modal-close" onClick={onClose} type="button">×</button>
          </header>
          <div className="settings-modal-content">
            {selectedPage === "profile" && <ProfileSettings activeUser={activeUser} onLogout={onLogout} onProfileUpdated={onProfileUpdated} />}
            {selectedPage === "general" && (
              <>
                <GeneralSettings
                  confirmDeleteFiles={confirmDeleteFiles}
                  openLastWorkspace={openLastWorkspace}
                  restoreOpenTabs={restoreOpenTabs}
                  workspaceName={workspace?.name ?? "your workspace"}
                  onConfirmDeleteFilesChange={onConfirmDeleteFilesChange}
                  onOpenLastWorkspaceChange={setOpenLastWorkspace}
                  onRestoreOpenTabsChange={setRestoreOpenTabs}
                />
                <WorkspaceSettings mode="general" showHeader={false} key={workspace?.id ?? "empty-workspace"} activeMemberRole={activeMemberRole} workspace={workspace} workspacesCount={workspacesCount} onWorkspaceIdentityUpdated={onWorkspaceIdentityUpdated} onWorkspaceSettingsUpdated={onWorkspaceSettingsUpdated} />
              </>
            )}
            {selectedPage === "members" && <AgentsSettings activeMemberRole={activeMemberRole} activeUser={activeUser} key={workspace?.id ?? "empty-workspace"} members={workspace?.members ?? []} onOwnershipTransferred={onWorkspaceOwnershipTransferred} workspace={workspace} />}
            {selectedPage === "permissions" && (
              <>
                <WorkspaceSettings mode="permissions" key={workspace?.id ?? "empty-workspace"} activeMemberRole={activeMemberRole} workspace={workspace} workspacesCount={workspacesCount} onWorkspaceIdentityUpdated={onWorkspaceIdentityUpdated} onWorkspaceSettingsUpdated={onWorkspaceSettingsUpdated} />
                <PrivacySettings embedded localTelemetry={localTelemetry} sharePresence={sharePresence} showEmail={showEmail} onLocalTelemetryChange={setLocalTelemetry} onSharePresenceChange={setSharePresence} onShowEmailChange={setShowEmail} />
              </>
            )}
            {selectedPage === "appearance" && <AppearanceSettings onThemeChange={onThemeChange} theme={theme} />}
            {selectedPage === "shortcuts" && <ShortcutsSettings />}
            {selectedPage === "developer" && (
              <>
                <DeveloperSettings debugLogs={debugLogs} experimentalCanvasTools={experimentalCanvasTools} onDebugLogsChange={setDebugLogs} onExperimentalCanvasToolsChange={setExperimentalCanvasTools} />
                <details className="settings-advanced-details">
                  <summary>Local integrations</summary>
                  <ProxySettings proxyAuth={proxyAuth} proxyEnabled={proxyEnabled} proxyUrl={proxyUrl} onProxyAuthChange={setProxyAuth} onProxyEnabledChange={setProxyEnabled} onProxyUrlChange={setProxyUrl} />
                  <ExtensionsSettings canvasExtension={canvasExtension} markdownExtension={markdownExtension} terminalExtension={terminalExtension} onCanvasExtensionChange={setCanvasExtension} onMarkdownExtensionChange={setMarkdownExtension} onTerminalExtensionChange={setTerminalExtension} />
                </details>
                <details className="settings-advanced-details">
                  <summary>Usage diagnostics</summary>
                  <UsageSettings workspace={workspace} workspacesCount={workspacesCount} />
                </details>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsSidebar({ groups, onSearchChange, onSelectPage, searchInputRef, searchQuery, selectedPage }: { groups: Record<string, SettingsNavItem[]>; onSearchChange: (value: string) => void; onSelectPage: (page: SettingsPageId) => void; searchInputRef: RefObject<HTMLInputElement | null>; searchQuery: string; selectedPage: SettingsPageId }) {
  const groupEntries = Object.entries(groups);

  return (
    <aside className="settings-modal-sidebar">
      <label className="settings-search">
        <SearchIcon />
        <input aria-label="Search settings" placeholder="Search settings" ref={searchInputRef} value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} />
        <kbd>⌘K</kbd>
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

function GeneralSettings({ confirmDeleteFiles, onConfirmDeleteFilesChange, onOpenLastWorkspaceChange, onRestoreOpenTabsChange, openLastWorkspace, restoreOpenTabs, workspaceName }: { confirmDeleteFiles: boolean; onConfirmDeleteFilesChange: (enabled: boolean) => void; onOpenLastWorkspaceChange: (enabled: boolean) => void; onRestoreOpenTabsChange: (enabled: boolean) => void; openLastWorkspace: boolean; restoreOpenTabs: boolean; workspaceName: string }) {
  return (
    <>
      <SettingsHeader description="Startup, workspace identity, and editor behavior." title="General" />
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
    </>
  );
}

function AppearanceSettings({ onThemeChange, theme }: { onThemeChange: (theme: WorkspaceTheme) => void; theme: WorkspaceTheme }) {
  return (
    <>
      <SettingsHeader description="Choose how Slate looks in this browser." title="Appearance" />
      <SettingsSection title="Theme">
        <SettingsRow description="Use the light or dark workspace color mode." title="Color mode">
          <div className="settings-theme-toggle">
            <button aria-label="Dark theme" className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")} title="Dark theme" type="button"><MoonIcon /></button>
            <button aria-label="Light theme" className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")} title="Light theme" type="button"><SunIcon /></button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function ProfileSettings({ activeUser, onLogout, onProfileUpdated }: { activeUser: SettingsUser | null; onLogout: () => void; onProfileUpdated: (user: SettingsUser) => void }) {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [name, setName] = useState(activeUser?.name ?? "");
  const [email, setEmail] = useState(activeUser?.email ?? "");
  const [username, setUsername] = useState(activeUser?.username ?? "");
  const [color, setColor] = useState(activeUser?.color ?? "blue");
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [devicePendingId, setDevicePendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (!response.ok) throw new Error(await readApiError(response, "Profile failed to load"));
        const nextProfile = await response.json() as ProfilePayload;
        if (!mounted) return;
        setProfile(nextProfile);
        setName(nextProfile.user.name);
        setEmail(nextProfile.user.email);
        setUsername(nextProfile.user.username ?? "");
        setColor(nextProfile.user.color);
        onProfileUpdated(nextProfile.user);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Profile failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [onProfileUpdated]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/profile", {
        body: JSON.stringify({ color, currentPassword, email, name, username }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });

      if (!response.ok) throw new Error(await readApiError(response, "Profile update failed"));

      const body = await response.json() as { user: SettingsUser };
      setProfile((current) => current ? { ...current, user: body.user } : { devices: [], user: body.user });
      setCurrentPassword("");
      setStatus("Profile updated");
      onProfileUpdated(body.user);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Profile update failed");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;
    setStatus(null);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch("/api/profile/password", {
        body: JSON.stringify({ currentPassword: passwordCurrent, newPassword }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) throw new Error(await readApiError(response, "Password update failed"));

      setPasswordCurrent("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("Password updated");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Password update failed");
    } finally {
      setSavingPassword(false);
    }
  }

  async function removeDevice(deviceId: string) {
    if (devicePendingId) return;
    setDevicePendingId(deviceId);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch(`/api/profile/devices/${deviceId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response, "Device removal failed"));
      const body = await response.json() as { signedOut: boolean };
      if (body.signedOut) {
        onLogout();
        return;
      }

      setProfile((current) => current ? { ...current, devices: current.devices.filter((device) => device.id !== deviceId) } : current);
      setStatus("Device removed");
    } catch (deviceError) {
      setError(deviceError instanceof Error ? deviceError.message : "Device removal failed");
    } finally {
      setDevicePendingId(null);
    }
  }

  async function requestEmailVerification() {
    const response = await fetch("/api/auth/resend-verification", { body: JSON.stringify({ email }), headers: { "content-type": "application/json" }, method: "POST" });
    if (response.ok) window.location.assign(`/verify-email?email=${encodeURIComponent(email)}`);
    else setError("Could not send a verification code");
  }

  const devices = profile?.devices ?? [];

  return (
    <>
      <SettingsHeader description="Account identity, security, active devices, and data export." title="Profile" />
      {loading ? (
        <div className="settings-empty-card">Loading profile...</div>
      ) : (
        <div className="profile-settings-grid">
          <form className="profile-settings-form" onSubmit={saveProfile}>
            <SettingsSection title="Identity">
              <label className="settings-input-row">
                <span>Name</span>
                <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="settings-input-row">
                <span>Email</span>
                <input autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              {!profile?.user.emailVerifiedAt && <div className="profile-email-verification"><span>Email is not verified</span><button className="settings-secondary-control" onClick={() => void requestEmailVerification()} type="button">Verify email</button></div>}
              <label className="settings-input-row">
                <span>Username</span>
                <input autoCapitalize="none" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
              </label>
              <label className="settings-input-row">
                <span>Current password</span>
                <input autoComplete="current-password" placeholder="Required when changing email" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </label>
              <div className="profile-color-row">
                <span>Accent color</span>
                <div>
                  {profileColorOptions.map((option) => (
                    <button aria-label={option.label} aria-pressed={color === option.id} className={color === option.id ? `active avatar-${option.id}` : `avatar-${option.id}`} key={option.id} onClick={() => setColor(option.id)} title={option.label} type="button">
                      <i />
                    </button>
                  ))}
                </div>
              </div>
              <div className="profile-settings-actions">
                <button className="settings-primary-control" disabled={savingProfile} type="submit">{savingProfile ? "Saving" : "Save profile"}</button>
                <button className="settings-secondary-control" onClick={() => window.location.assign("/api/profile/export")} type="button">Export Excel</button>
              </div>
            </SettingsSection>
          </form>
          <form className="profile-settings-form" onSubmit={savePassword}>
            <SettingsSection title="Password">
              <label className="settings-input-row">
                <span>Current password</span>
                <input autoComplete="current-password" type="password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} />
              </label>
              <label className="settings-input-row">
                <span>New password</span>
                <input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </label>
              <label className="settings-input-row">
                <span>Confirm new password</span>
                <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
              <div className="profile-settings-actions">
                <button className="settings-primary-control" disabled={savingPassword} type="submit">{savingPassword ? "Updating" : "Update password"}</button>
              </div>
            </SettingsSection>
          </form>
          <SettingsSection title="Devices">
            <div className="profile-device-list">
              {devices.length === 0 && <div className="settings-empty-card">No active devices found.</div>}
              {devices.map((device) => (
                <div className="profile-device-row" key={device.id}>
                  <div>
                    <strong>{device.deviceName}{device.current ? " · Current" : ""}</strong>
                    <p>{device.operatingSystem} · {device.browserName} · Last login {formatDateTime(device.createdAt)}</p>
                    <small>{device.ipAddress ?? "Local session"} · Last active {formatDateTime(device.lastSeenAt)}</small>
                  </div>
                  <button className="settings-secondary-control" disabled={devicePendingId === device.id} onClick={() => void removeDevice(device.id)} type="button">
                    {devicePendingId === device.id ? "Removing" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          </SettingsSection>
          <SettingsSection title="Danger zone">
            <SettingsRow description="End the current Slate session on this device." title="Sign out">
              <button className="settings-signout-control" onClick={onLogout} type="button">Sign out</button>
            </SettingsRow>
          </SettingsSection>
        </div>
      )}
      {(status || error) && <div className={error ? "profile-status error" : "profile-status"}>{error ?? status}</div>}
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

function AgentsSettings({ activeMemberRole, activeUser, members, onOwnershipTransferred, workspace }: { activeMemberRole: string; activeUser: SettingsUser | null; members: SettingsMember[]; onOwnershipTransferred: () => Promise<void>; workspace: SettingsWorkspace | null }) {
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const candidate = members.find((member) => member.id === candidateId) ?? null;
  const canManageOwnership = activeMemberRole === "owner";
  const confirmationMatches = Boolean(workspace && confirmationName === workspace.name);

  function selectCandidate(memberId: string) {
    setCandidateId(memberId);
    setConfirmationName("");
    setError("");
  }

  async function transferOwnership() {
    if (!workspace || !candidate || !confirmationMatches || pending || !canManageOwnership) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/ownership`, {
        body: JSON.stringify({ memberUserId: candidate.id, workspaceName: confirmationName }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await readApiError(response, "Ownership transfer failed"));
      setCandidateId(null);
      setConfirmationName("");
      await onOwnershipTransferred();
    } catch (transferError) {
      setError(transferError instanceof Error ? transferError.message : "Ownership transfer failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SettingsHeader description="People and roles in the current workspace." title="Members" />
      <SettingsSection title="Workspace members">
        <div className="settings-list-card">
          {members.length === 0 && <div className="settings-empty-card">No members in this workspace yet.</div>}
          {members.map((member) => (
            <div className="settings-member-row" key={member.id}>
              <span className={`avatar avatar-${member.color}`}>{member.initials}</span>
              <div>
                <strong>{member.name}{activeUser?.email === member.email ? " · You" : ""}</strong>
                <p>{member.email}</p>
              </div>
              <div className="settings-member-controls">
                <small>{member.role}</small>
                {canManageOwnership && activeUser?.id !== member.id && (
                  <button disabled={pending} onClick={() => selectCandidate(member.id)} type="button">Transfer ownership</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
      {canManageOwnership && workspace && candidate && (
        <SettingsSection title="Ownership transfer">
          <div className="settings-ownership-transfer">
            <div>
              <strong>Transfer ownership to {candidate.name}</strong>
              <p>You will become an editor. Type the workspace name exactly to confirm this action.</p>
            </div>
            <label>
              <span>Type “{workspace.name}”</span>
              <input autoComplete="off" disabled={pending} onChange={(event) => { setConfirmationName(event.target.value); setError(""); }} placeholder={workspace.name} spellCheck={false} value={confirmationName} />
            </label>
            {error && <p className="settings-error-text">{error}</p>}
            <div className="settings-ownership-actions">
              <button disabled={pending} onClick={() => { setCandidateId(null); setConfirmationName(""); setError(""); }} type="button">Cancel</button>
              <button disabled={!confirmationMatches || pending} onClick={() => void transferOwnership()} type="button">{pending ? "Transferring" : "Transfer ownership"}</button>
            </div>
          </div>
        </SettingsSection>
      )}
    </>
  );
}

function WorkspaceSettings({ activeMemberRole, mode, onWorkspaceIdentityUpdated, onWorkspaceSettingsUpdated, showHeader = true, workspace }: { activeMemberRole: string; mode: "general" | "permissions"; onWorkspaceIdentityUpdated: (workspace: { abbreviation: string; id: string; name: string; slug: string }) => void; onWorkspaceSettingsUpdated: (settings: SettingsWorkspaceSettings) => void; showHeader?: boolean; workspace: SettingsWorkspace | null; workspacesCount: number }) {
  const [draft, setDraft] = useState<SettingsWorkspaceSettings | null>(workspace?.settings ?? null);
  const [nameDraft, setNameDraft] = useState(workspace?.name ?? "");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const canManageWorkspace = activeMemberRole === "owner";

  function updateDraft(next: Partial<SettingsWorkspaceSettings>) {
    setDraft((current) => current ? { ...current, ...next } : current);
    setStatus("");
    setError("");
  }

  async function saveWorkspace() {
    if (!workspace || !draft || saving || !canManageWorkspace) return;
    if (nameDraft.trim().length < 2) {
      setError("Workspace name must be at least 2 characters");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");

    try {
      if (nameDraft.trim() !== workspace.name) {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          body: JSON.stringify({ name: nameDraft }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        });
        if (!response.ok) throw new Error(await readApiError(response, "Workspace update failed"));
        const body = await response.json() as { workspace: { abbreviation: string; id: string; name: string; slug: string } };
        setNameDraft(body.workspace.name);
        onWorkspaceIdentityUpdated(body.workspace);
      }

      const settingsResponse = await fetch(`/api/workspaces/${workspace.id}/settings`, {
        body: JSON.stringify(draft),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      if (!settingsResponse.ok) throw new Error(await readApiError(settingsResponse, "Workspace settings update failed"));
      const settingsBody = await settingsResponse.json() as { settings: SettingsWorkspaceSettings };
      setDraft(settingsBody.settings);
      onWorkspaceSettingsUpdated(settingsBody.settings);
      setStatus("Workspace saved");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Workspace update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {showHeader && <SettingsHeader description={mode === "permissions" ? "Control who can invite, edit, delete, and comment." : "Workspace identity and collaboration behavior."} title={mode === "permissions" ? "Permissions" : "General"} />}
      {!workspace || !draft ? (
        <SettingsSection title="Configuration">
          <div className="settings-empty-card">No active workspace selected.</div>
        </SettingsSection>
      ) : (
        <>
          {mode === "general" && <SettingsSection title="Identity">
            <label className="settings-input-row">
              <span>Workspace name</span>
              <input disabled={!canManageWorkspace} maxLength={80} placeholder="Workspace name" value={nameDraft} onChange={(event) => { setNameDraft(event.target.value); setStatus(""); setError(""); }} />
            </label>
            <label className="settings-input-row">
              <span>Description</span>
              <textarea disabled={!canManageWorkspace} maxLength={240} placeholder="What this workspace is for" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
            </label>
          </SettingsSection>}
          {mode === "permissions" && <SettingsSection title="Access">
            <SettingsRow description="Editors can invite new teammates without owner approval." title="Editor invites">
              <SettingsSwitch checked={draft.allowEditorInvites} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ allowEditorInvites: checked })} />
            </SettingsRow>
            <SettingsRow description="Editors can archive or delete files from the shared file tree." title="Editor file deletion">
              <SettingsSwitch checked={draft.allowEditorFileDelete} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ allowEditorFileDelete: checked })} />
            </SettingsRow>
          </SettingsSection>}
          {mode === "general" && <SettingsSection title="Collaboration">
            <SettingsRow description="Show teammate color badges in files, cursors, selections, and typing indicators." title="Collaborator presence">
              <SettingsSwitch checked={draft.showCollaboratorPresence} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ showCollaboratorPresence: checked })} />
            </SettingsRow>
            <SettingsRow description="Keep the activity feed connected to document edits, comments, member changes, and runs." title="Document activity">
              <SettingsSwitch checked={draft.showDocumentActivity} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ showDocumentActivity: checked })} />
            </SettingsRow>
            <SettingsRow description="Persist edits automatically from code, notes, and canvas surfaces." title="Auto-save">
              <SettingsSwitch checked={draft.autoSaveEnabled} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ autoSaveEnabled: checked })} />
            </SettingsRow>
          </SettingsSection>}
          {mode === "general" && <SettingsSection title="Files">
            <SettingsRow description="Default ordering for the sidebar file tree." title="File tree sort">
              <SettingsSegmentedControl
                disabled={!canManageWorkspace}
                options={[
                  { id: "manual", label: "Manual" },
                  { id: "name", label: "Name" },
                  { id: "changes", label: "Changes" }
                ]}
                value={draft.fileTreeSortMode}
                onChange={(value) => updateDraft({ fileTreeSortMode: value })}
              />
            </SettingsRow>
          </SettingsSection>}
          {mode === "general" && <SettingsSection title="Data">
            <label className="settings-input-row">
              <span>Activity retention days</span>
              <input disabled={!canManageWorkspace} inputMode="numeric" max={365} min={7} type="number" value={draft.retentionDays} onChange={(event) => updateDraft({ retentionDays: Number(event.target.value) })} />
            </label>
            <SettingsRow description="Include activity, comments, member list, and file tree metadata in workspace exports." title="Export activity">
              <SettingsSwitch checked={draft.exportIncludesActivity} disabled={!canManageWorkspace} onChange={(checked) => updateDraft({ exportIncludesActivity: checked })} />
            </SettingsRow>
          </SettingsSection>}
          <div className="settings-save-bar">
            <div>
              {error && <p className="settings-error-text">{error}</p>}
              {status && <p className="settings-status-text">{status}</p>}
              {!canManageWorkspace && <p className="settings-muted-text">Only workspace owners can change these settings.</p>}
            </div>
            <button className="settings-primary-control" disabled={!canManageWorkspace || saving} onClick={() => void saveWorkspace()} type="button">{saving ? "Saving" : "Save workspace"}</button>
          </div>
        </>
      )}
    </>
  );
}

function PrivacySettings({ embedded = false, localTelemetry, onLocalTelemetryChange, onSharePresenceChange, onShowEmailChange, sharePresence, showEmail }: { embedded?: boolean; localTelemetry: boolean; onLocalTelemetryChange: (enabled: boolean) => void; onSharePresenceChange: (enabled: boolean) => void; onShowEmailChange: (enabled: boolean) => void; sharePresence: boolean; showEmail: boolean }) {
  return (
    <>
      {!embedded && <SettingsHeader description="Control what your workspace shares inside the app." title="Privacy" />}
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
  const usageMetrics = [
    { label: "Workspaces", value: workspacesCount },
    { label: "Documents", value: workspace?.documents.length ?? 0 },
    { label: "Files", value: workspace?.fileNodes.length ?? 0 },
    { label: "Members", value: workspace?.members.length ?? 0 },
    { label: "Invites", value: workspace?.invites.length ?? 0 },
    { label: "Runs", value: completedRuns }
  ];

  return (
    <>
      <SettingsHeader description="Workspace usage and activity totals." title="Usage" />
      <SettingsSection title="Summary">
        <div className="settings-usage-radar-card">
          <UsageRadarChart metrics={usageMetrics} />
          <div className="settings-usage-radar-metrics">
            {usageMetrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

function UsageRadarChart({ metrics }: { metrics: { label: string; value: number }[] }) {
  const size = 250;
  const center = size / 2;
  const radius = 82;
  const maxValue = Math.max(1, ...metrics.map((metric) => metric.value));
  const rings = [0.25, 0.5, 0.75, 1];
  const points = metrics.map((metric, index) => {
    const angle = Math.PI * 2 * index / metrics.length - Math.PI / 2;
    const distance = Math.max(0.12, metric.value / maxValue) * radius;
    return {
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      label: metric.label,
      labelX: center + Math.cos(angle) * (radius + 28),
      labelY: center + Math.sin(angle) * (radius + 28),
      value: metric.value,
      x: center + Math.cos(angle) * distance,
      y: center + Math.sin(angle) * distance
    };
  });
  const polygon = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg aria-label="Usage radar chart" className="settings-usage-radar" role="img" viewBox={`0 0 ${size} ${size}`}>
      {rings.map((ring) => (
        <polygon className="settings-usage-radar-grid" key={ring} points={metrics.map((_, index) => {
          const angle = Math.PI * 2 * index / metrics.length - Math.PI / 2;
          return `${center + Math.cos(angle) * radius * ring},${center + Math.sin(angle) * radius * ring}`;
        }).join(" ")} />
      ))}
      {points.map((point) => (
        <line className="settings-usage-radar-axis" key={point.label} x1={center} x2={point.axisX} y1={center} y2={point.axisY} />
      ))}
      <polygon className="settings-usage-radar-area" points={polygon} />
      {points.map((point) => (
        <circle className="settings-usage-radar-dot" cx={point.x} cy={point.y} key={point.label} r="3.5" />
      ))}
      {points.map((point) => (
        <text className="settings-usage-radar-label" dominantBaseline="middle" key={point.label} textAnchor={point.labelX < center - 8 ? "end" : point.labelX > center + 8 ? "start" : "middle"} x={point.labelX} y={point.labelY}>{point.label}</text>
      ))}
    </svg>
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

async function readApiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  });
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

function SettingsSwitch({ checked, disabled = false, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button aria-pressed={checked} className={checked ? "settings-switch active" : "settings-switch"} disabled={disabled} onClick={() => onChange(!checked)} type="button">
      <span />
    </button>
  );
}

function SettingsSegmentedControl({ disabled = false, onChange, options, value }: { disabled?: boolean; onChange: (value: string) => void; options: { id: string; label: string }[]; value: string }) {
  return (
    <div className="settings-segmented-control">
      {options.map((option) => (
        <button className={option.id === value ? "active" : ""} disabled={disabled} key={option.id} onClick={() => onChange(option.id)} type="button">{option.label}</button>
      ))}
    </div>
  );
}
