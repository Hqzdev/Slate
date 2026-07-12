"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveCursors, type LiveCursor } from "@/components/LiveCursors";
import { fetchRealtimeGrant } from "@/lib/client/realtimeGrant";
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
  registerDocumentFlush: (documentId: string, flush: () => void) => () => void;
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

export function CollaborativeEditor({ documentId, fileName, initialValue, language, onContentChange, onPresenceChange, onRealtimeStatusChange, readOnly, registerDocumentFlush, roomName, theme, user }: CollaborativeEditorProps) {
  const roomKey = useMemo(() => `slate:room:${roomName}:file:${documentId}`, [documentId, roomName]);
  const [cursors, setCursors] = useState<LiveCursor[]>([]);
  const contentChangeRef = useRef(onContentChange);
  const latestContentRef = useRef(initialValue);
  const pendingSaveRef = useRef(false);
  const presenceChangeRef = useRef(onPresenceChange);
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

  useEffect(() => {
    presenceChangeRef.current = onPresenceChange;
  }, [onPresenceChange]);

  const flushContentSave = useCallback(() => {
    if (!pendingSaveRef.current) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = false;
    contentChangeRef.current(latestContentRef.current);
  }, []);

  useEffect(() => registerDocumentFlush(documentId, flushContentSave), [documentId, flushContentSave, registerDocumentFlush]);

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
        "editor.background": "#131110",
        "editor.lineHighlightBackground": "#1c1917",
        "editorLineNumber.foreground": "#44403c",
        "editorLineNumber.activeForeground": "#a8a29e",
        "editorCursor.foreground": "#fafaf9",
        "editor.selectionBackground": "#57534e99"
      }
    });
    monaco.editor.defineTheme("slate-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.lineHighlightBackground": "#f5f5f4",
        "editorLineNumber.foreground": "#a8a29e",
        "editorLineNumber.activeForeground": "#57534e",
        "editorCursor.foreground": "#0c0a09",
        "editor.selectionBackground": "#d6d3d1"
      }
    });
    monaco.editor.setTheme(`slate-${theme}`);

    const doc = new Y.Doc();
    const text = doc.getText("source");

    let disposed = false;
    let provider: WebsocketProvider | null = null;
    let unwatchRealtimeConnection: (() => void) | null = null;

    const updatePresence = () => {
      if (!provider) return;
      const stateEntries = Array.from(provider.awareness.getStates().entries());
      const states = stateEntries.map(([, state]) => state);
      const users = states
        .map((state) => state.user)
        .filter((presenceUser): presenceUser is PresenceUser => {
          return Boolean(presenceUser?.id && presenceUser?.name && presenceUser?.initials && presenceUser?.color && presenceUser?.role);
        });

      updateRemoteSelectionStyles(stateEntries, doc.clientID, remoteStyleRef);
      presenceChangeRef.current(Array.from(new Map(users.map((presenceUser) => [presenceUser.id, presenceUser])).values()));
      setCursors(states.flatMap((state) => {
        if (!state.user?.id || !state.pointer) return [];
        return [{ x: state.pointer.x, y: state.pointer.y, user: state.user }];
      }));
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
      flushContentSave();
    };

    doc.on("update", handleDocUpdate);
    window.addEventListener("pagehide", handlePageHide);

    void fetchRealtimeGrant(roomKey).then((grant) => {
      if (disposed) return;
      provider = new WebsocketProvider(syncUrl, roomKey, doc, { maxBackoffTime: 2500, params: { grant }, resyncInterval: 5000 });
      providerRef.current = provider;
      new MonacoBinding(text, model, new Set([editor]), provider.awareness);
      unwatchRealtimeConnection = watchRealtimeConnection(provider, (status) => realtimeStatusChangeRef.current(status));
      provider.awareness.setLocalStateField("user", {
        color: user.color,
        id: user.id,
        initials: user.initials,
        name: user.name,
        role: user.role
      });
      provider.awareness.on("change", updatePresence);
      window.setTimeout(updatePresence, 0);
    }).catch(() => realtimeStatusChangeRef.current("offline"));

    editor.onDidDispose(() => {
      disposed = true;
      flushContentSave();
      window.removeEventListener("pagehide", handlePageHide);
      doc.off("update", handleDocUpdate);
      provider?.awareness.off("change", updatePresence);
      unwatchRealtimeConnection?.();
      presenceChangeRef.current([]);
      setCursors([]);
      remoteStyleRef.current?.remove();
      remoteStyleRef.current = null;
      providerRef.current = null;
      provider?.destroy();
      doc.destroy();
    });
  };

  return (
    <div className="realtime-document-host" onMouseMove={updatePointer}>
      <Editor
        key={`${roomName}:${documentId}:${theme}`}
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
