"use client";

import { ChangeEvent, MouseEvent, SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { LiveCursors, type LiveCursor } from "@/components/LiveCursors";
import { type RealtimeConnectionStatus, watchRealtimeConnection } from "@/lib/client/realtimeConnection";
import rehypeSanitize from "rehype-sanitize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

type CollaborativeNoteProps = {
  documentId: string;
  initialValue: string;
  onContentChange: (content: string) => void;
  onPresenceChange: (users: PresenceUser[]) => void;
  onRealtimeStatusChange: (status: RealtimeConnectionStatus) => void;
  readOnly: boolean;
  roomName: string;
  title: string;
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

type RemoteTextCaret = {
  id: string;
  left: number;
  top: number;
  user: PresenceUser;
};

type NoteMode = "edit" | "preview";

const syncUrl = process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://127.0.0.1:1234";

export function CollaborativeNote({ documentId, initialValue, onContentChange, onPresenceChange, onRealtimeStatusChange, readOnly, roomName, title, user }: CollaborativeNoteProps) {
  const roomKey = useMemo(() => `slate:room:${roomName}:note:${documentId}`, [documentId, roomName]);
  const [cursors, setCursors] = useState<LiveCursor[]>([]);
  const [remoteCarets, setRemoteCarets] = useState<RemoteTextCaret[]>([]);
  const [value, setValue] = useState(initialValue);
  const [mode, setMode] = useState<NoteMode>("edit");
  const contentChangeRef = useRef(onContentChange);
  const latestValueRef = useRef(initialValue);
  const pendingSaveRef = useRef(false);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const realtimeStatusChangeRef = useRef(onRealtimeStatusChange);
  const saveTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef<Y.Text | null>(null);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    realtimeStatusChangeRef.current = onRealtimeStatusChange;
  }, [onRealtimeStatusChange]);

  useEffect(() => {
    const doc = new Y.Doc();
    const text = doc.getText("note");
    const provider = new WebsocketProvider(syncUrl, roomKey, doc, { maxBackoffTime: 2500, resyncInterval: 5000 });
    const unwatchRealtimeConnection = watchRealtimeConnection(provider, (status) => realtimeStatusChangeRef.current(status));

    providerRef.current = provider;
    textRef.current = text;
    provider.awareness.setLocalStateField("user", {
      color: user.color,
      id: user.id,
      initials: user.initials,
      name: user.name,
      role: user.role
    });

    const updatePresence = () => {
      const states = Array.from(provider.awareness.getStates().values());
      const users = states
        .map((state) => state.user)
        .filter((presenceUser): presenceUser is PresenceUser => {
          return Boolean(presenceUser?.id && presenceUser?.name && presenceUser?.initials && presenceUser?.color && presenceUser?.role);
        });

      onPresenceChange(Array.from(new Map(users.map((presenceUser) => [presenceUser.id, presenceUser])).values()));
      setRemoteCarets(states.flatMap((state) => {
        if (!state.user?.id || state.user.id === user.id || !state.selection?.head) return [];
        const position = Y.createAbsolutePositionFromRelativePosition(state.selection.head, doc);
        const textarea = textareaRef.current;
        if (!position || position.type !== text || !textarea) return [];
        const coordinates = measureTextareaCaret(textarea, position.index);
        if (!coordinates) return [];
        return [{ id: state.user.id, left: coordinates.left, top: coordinates.top, user: state.user }];
      }));
      setCursors(states.flatMap((state) => {
        if (!state.user?.id || !state.pointer) return [];
        return [{ x: state.pointer.x, y: state.pointer.y, user: state.user }];
      }));
    };

    const flushContentSave = () => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      contentChangeRef.current(latestValueRef.current);
    };

    const updateValue = () => {
      latestValueRef.current = text.toString();
      pendingSaveRef.current = true;
      setValue(latestValueRef.current);

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

    text.observe(updateValue);
    provider.awareness.on("change", updatePresence);
    window.addEventListener("pagehide", handlePageHide);
    window.setTimeout(updatePresence, 0);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      flushContentSave();
      window.removeEventListener("pagehide", handlePageHide);
      text.unobserve(updateValue);
      provider.awareness.off("change", updatePresence);
      unwatchRealtimeConnection();
      onPresenceChange([]);
      setCursors([]);
      setRemoteCarets([]);
      provider.destroy();
      doc.destroy();
      providerRef.current = null;
      textRef.current = null;
    };
  }, [initialValue, onPresenceChange, onRealtimeStatusChange, readOnly, roomKey, user.color, user.id, user.initials, user.name, user.role]);

  function updatePointer(event: MouseEvent<HTMLElement>) {
    const provider = providerRef.current;
    if (!provider) return;

    const rect = event.currentTarget.getBoundingClientRect();
    provider.awareness.setLocalStateField("pointer", {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100
    });
  }

  function updateSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const provider = providerRef.current;
    const text = textRef.current;
    const target = event.currentTarget;
    if (!provider || !text) return;

    provider.awareness.setLocalStateField("selection", {
      anchor: Y.createRelativePositionFromTypeIndex(text, target.selectionStart),
      head: Y.createRelativePositionFromTypeIndex(text, target.selectionEnd)
    });
  }

  function updateNote(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const text = textRef.current;

    if (readOnly) return;

    setValue(nextValue);
    updateSelection(event);

    if (!text) return;

    applyTextDiff(text, nextValue);
  }

  return (
    <section className="note-document realtime-document-host" onMouseMove={updatePointer}>
      <div className="note-editor-frame">
        <div className="note-mode-switch" aria-label="Note mode">
          <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")} type="button">Edit</button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")} type="button">Preview</button>
        </div>
        {mode === "edit" ? (
          <>
            <textarea
              aria-label={title}
              onChange={updateNote}
              onClick={updateSelection}
              onKeyUp={updateSelection}
              onSelect={updateSelection}
              readOnly={readOnly}
              ref={textareaRef}
              spellCheck={false}
              value={value}
            />
            <div className="note-remote-caret-layer">
              {remoteCarets.map((caret) => (
                <div className="note-remote-caret" key={caret.id} style={{ left: caret.left, top: caret.top }}>
                  <span style={{ background: caret.user.color }} />
                  <b style={{ background: caret.user.color }}>{caret.user.name}</b>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="note-markdown-preview">
            <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
              {value || "_Nothing here yet._"}
            </ReactMarkdown>
          </div>
        )}
      </div>
      <LiveCursors cursors={cursors} localUserId={user.id} />
    </section>
  );
}

function applyTextDiff(text: Y.Text, nextValue: string) {
  const currentValue = text.toString();
  if (currentValue === nextValue) return;

  let start = 0;
  while (start < currentValue.length && start < nextValue.length && currentValue[start] === nextValue[start]) {
    start += 1;
  }

  let currentEnd = currentValue.length;
  let nextEnd = nextValue.length;
  while (currentEnd > start && nextEnd > start && currentValue[currentEnd - 1] === nextValue[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  text.doc?.transact(() => {
    if (currentEnd > start) {
      text.delete(start, currentEnd - start);
    }

    if (nextEnd > start) {
      text.insert(start, nextValue.slice(start, nextEnd));
    }
  });
}

function measureTextareaCaret(textarea: HTMLTextAreaElement, index: number) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const properties = [
    "borderBottomWidth",
    "borderLeftWidth",
    "borderRightWidth",
    "borderTopWidth",
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "textTransform",
    "whiteSpace",
    "wordBreak",
    "wordSpacing",
    "wordWrap"
  ] as const;

  for (const property of properties) {
    mirror.style[property] = style[property];
  }

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.minHeight = `${textarea.clientHeight}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = textarea.value.slice(0, index);
  marker.textContent = textarea.value.slice(index, index + 1) || " ";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const left = textarea.offsetLeft + marker.offsetLeft - textarea.scrollLeft;
  const top = textarea.offsetTop + marker.offsetTop - textarea.scrollTop;
  mirror.remove();

  return { left, top };
}
