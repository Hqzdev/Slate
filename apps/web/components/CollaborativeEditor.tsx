"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { LiveCursors, type LiveCursor } from "@/components/LiveCursors";
import { type RealtimeConnectionStatus, watchRealtimeConnection } from "@/lib/client/realtimeConnection";
import { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

type CollaborativeEditorProps = {
  documentId: string;
  fileName: string;
  initialValue: string;
  language: string;
  onContentChange: (content: string) => void;
  onPresenceChange: (users: PresenceUser[]) => void;
  onRealtimeStatusChange: (status: RealtimeConnectionStatus) => void;
  readOnly: boolean;
  roomName: string;
  theme: "dark" | "light";
  user: {
    color: string;
    id: string;
    initials: string;
    name: string;
    role: string;
  };
};

export type PresenceUser = {
  color: string;
  id: string;
  initials: string;
  name: string;
  role: string;
};

type AwarenessState = {
  pointer?: {
    x: number;
    y: number;
  };
  user?: PresenceUser;
};

const syncUrl = process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://127.0.0.1:1234";

export function CollaborativeEditor({ documentId, fileName, initialValue, language, onContentChange, onPresenceChange, onRealtimeStatusChange, readOnly, roomName, theme, user }: CollaborativeEditorProps) {
  const roomKey = useMemo(() => `slate:room:${roomName}:file:${documentId}`, [documentId, roomName]);
  const [cursors, setCursors] = useState<LiveCursor[]>([]);
  const contentChangeRef = useRef(onContentChange);
  const latestContentRef = useRef(initialValue);
  const pendingSaveRef = useRef(false);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const realtimeStatusChangeRef = useRef(onRealtimeStatusChange);
  const remoteStyleRef = useRef<HTMLStyleElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    realtimeStatusChangeRef.current = onRealtimeStatusChange;
  }, [onRealtimeStatusChange]);

  function updatePointer(event: MouseEvent<HTMLDivElement>) {
    const provider = providerRef.current;
    if (!provider) return;

    const rect = event.currentTarget.getBoundingClientRect();
    provider.awareness.setLocalStateField("pointer", {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100
    });
  }

  const handleMount: OnMount = (editor, monaco) => {
    const model = editor.getModel();
    if (!model) return;

    monaco.editor.defineTheme("slate-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0e0e11",
        "editor.lineHighlightBackground": "#17171b",
        "editorLineNumber.foreground": "#3f3f46",
        "editorLineNumber.activeForeground": "#a1a1aa",
        "editorCursor.foreground": "#fafafa",
        "editor.selectionBackground": "#2563eb55"
      }
    });
    monaco.editor.defineTheme("slate-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#fbfcff",
        "editor.lineHighlightBackground": "#eef4ff",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#475569",
        "editorCursor.foreground": "#0f172a",
        "editor.selectionBackground": "#bfdbfe"
      }
    });
    monaco.editor.setTheme(`slate-${theme}`);

    const doc = new Y.Doc();
    const text = doc.getText("source");

    const provider = new WebsocketProvider(syncUrl, roomKey, doc, { maxBackoffTime: 2500, resyncInterval: 5000 });
    providerRef.current = provider;
    new MonacoBinding(text, model, new Set([editor]), provider.awareness);
    const unwatchRealtimeConnection = watchRealtimeConnection(provider, (status) => realtimeStatusChangeRef.current(status));

    provider.awareness.setLocalStateField("user", {
      color: user.color,
      id: user.id,
      initials: user.initials,
      name: user.name,
      role: user.role
    });

    const updatePresence = () => {
      const stateEntries = Array.from(provider.awareness.getStates().entries());
      const states = stateEntries.map(([, state]) => state);
      const users = states
        .map((state) => state.user)
        .filter((presenceUser): presenceUser is PresenceUser => {
          return Boolean(presenceUser?.id && presenceUser?.name && presenceUser?.initials && presenceUser?.color && presenceUser?.role);
        });

      updateRemoteSelectionStyles(stateEntries, doc.clientID, remoteStyleRef);
      onPresenceChange(Array.from(new Map(users.map((presenceUser) => [presenceUser.id, presenceUser])).values()));
      setCursors(states.flatMap((state) => {
        if (!state.user?.id || !state.pointer) return [];
        return [{ x: state.pointer.x, y: state.pointer.y, user: state.user }];
      }));
    };

    const flushContentSave = () => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      contentChangeRef.current(latestContentRef.current);
    };

    const handleDocUpdate = () => {
      latestContentRef.current = text.toString();
      pendingSaveRef.current = true;

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        flushContentSave();
      }, 500);
    };

    const handlePageHide = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      flushContentSave();
    };

    doc.on("update", handleDocUpdate);
    provider.awareness.on("change", updatePresence);
    window.addEventListener("pagehide", handlePageHide);
    window.setTimeout(updatePresence, 0);

    editor.onDidDispose(() => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      flushContentSave();
      window.removeEventListener("pagehide", handlePageHide);
      doc.off("update", handleDocUpdate);
      provider.awareness.off("change", updatePresence);
      unwatchRealtimeConnection();
      onPresenceChange([]);
      setCursors([]);
      remoteStyleRef.current?.remove();
      remoteStyleRef.current = null;
      providerRef.current = null;
      provider.destroy();
      doc.destroy();
    });
  };

  return (
    <div className="realtime-document-host" onMouseMove={updatePointer}>
      <Editor
        key={`${roomName}:${fileName}:${theme}`}
        defaultLanguage={language}
        defaultValue={initialValue}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
          fontSize: 13,
          minimap: { enabled: false },
          padding: { top: 12, bottom: 12 },
          readOnly,
          renderValidationDecorations: "off",
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: "off"
        }}
        path={fileName}
        theme={`slate-${theme}`}
      />
      <LiveCursors cursors={cursors} localUserId={user.id} />
    </div>
  );
}

function updateRemoteSelectionStyles(stateEntries: [number, AwarenessState][], localClientId: number, styleRef: { current: HTMLStyleElement | null }) {
  const rules = stateEntries.flatMap(([clientId, state]) => {
    if (clientId === localClientId || !state.user?.id) return [];
    const color = typeof state.user.color === "string" ? state.user.color : "#3b82f6";
    const name = typeof state.user.name === "string" ? state.user.name : "Collaborator";

    return [
      `.yRemoteSelection-${clientId}{background-color:${hexToRgba(color, 0.22)}}`,
      `.yRemoteSelectionHead-${clientId}{border-left-color:${color}}`,
      `.yRemoteSelectionHead-${clientId}::after{content:"${escapeCssContent(name)}";background:${color}}`
    ];
  });

  if (rules.length === 0) {
    styleRef.current?.remove();
    styleRef.current = null;
    return;
  }

  if (!styleRef.current) {
    styleRef.current = document.createElement("style");
    document.head.appendChild(styleRef.current);
  }

  styleRef.current.textContent = rules.join("\n");
}

function escapeCssContent(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function hexToRgba(color: string, alpha: number) {
  const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return color;
  const red = Number.parseInt(match[1], 16);
  const green = Number.parseInt(match[2], 16);
  const blue = Number.parseInt(match[3], 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
