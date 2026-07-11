"use client";

import { ChangeEvent, CSSProperties, HTMLAttributes, MouseEvent, ReactNode, SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveCursors, type LiveCursor } from "@/components/LiveCursors";
import { fetchRealtimeGrant } from "@/lib/client/realtimeGrant";
import { type RealtimeConnectionStatus, watchRealtimeConnection } from "@/lib/client/realtimeConnection";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
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
  registerDocumentFlush: (documentId: string, flush: () => void) => () => void;
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
const noteColorOptions = [
  { id: "default", label: "Default", value: "" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "green", label: "Green", value: "#22c55e" },
  { id: "pink", label: "Pink", value: "#ec4899" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "gray", label: "Gray", value: "#64748b" }
];
const noteFontOptions = [
  { id: "sans", label: "Sans", value: "var(--sans)" },
  { id: "serif", label: "Serif", value: "Georgia, serif" },
  { id: "mono", label: "Mono", value: "var(--mono)" }
];
const noteSizeOptions = [
  { id: "small", label: "Small", value: "13px" },
  { id: "normal", label: "Normal", value: "15px" },
  { id: "large", label: "Large", value: "19px" },
  { id: "huge", label: "Huge", value: "26px" }
];
const noteSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["dataNoteColor", ...noteColorOptions.map((option) => option.id)],
      ["dataNoteFont", ...noteFontOptions.map((option) => option.id)],
      ["dataNoteSize", ...noteSizeOptions.map((option) => option.id)],
      ["data-note-color", ...noteColorOptions.map((option) => option.id)],
      ["data-note-font", ...noteFontOptions.map((option) => option.id)],
      ["data-note-size", ...noteSizeOptions.map((option) => option.id)]
    ]
  }
};

export function CollaborativeNote({ documentId, initialValue, onContentChange, onPresenceChange, onRealtimeStatusChange, readOnly, registerDocumentFlush, roomName, title, user }: CollaborativeNoteProps) {
  const roomKey = useMemo(() => `slate:room:${roomName}:note:${documentId}`, [documentId, roomName]);
  const [cursors, setCursors] = useState<LiveCursor[]>([]);
  const [remoteCarets, setRemoteCarets] = useState<RemoteTextCaret[]>([]);
  const [value, setValue] = useState(initialValue);
  const [mode, setMode] = useState<NoteMode>("edit");
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const contentChangeRef = useRef(onContentChange);
  const latestValueRef = useRef(initialValue);
  const pendingSaveRef = useRef(false);
  const presenceChangeRef = useRef(onPresenceChange);
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
    presenceChangeRef.current = onPresenceChange;
  }, [onPresenceChange]);

  const flushContentSave = useCallback(() => {
    if (!pendingSaveRef.current) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = false;
    contentChangeRef.current(latestValueRef.current);
  }, []);

  useEffect(() => registerDocumentFlush(documentId, flushContentSave), [documentId, flushContentSave, registerDocumentFlush]);

  useEffect(() => {
    const doc = new Y.Doc();
    const text = doc.getText("note");
    let disposed = false;
    let provider: WebsocketProvider | null = null;
    let unwatchRealtimeConnection: (() => void) | null = null;
    textRef.current = text;

    const updatePresence = () => {
      if (!provider) return;
      const states = Array.from(provider.awareness.getStates().values());
      const users = states
        .map((state) => state.user)
        .filter((presenceUser): presenceUser is PresenceUser => {
          return Boolean(presenceUser?.id && presenceUser?.name && presenceUser?.initials && presenceUser?.color && presenceUser?.role);
        });

      presenceChangeRef.current(Array.from(new Map(users.map((presenceUser) => [presenceUser.id, presenceUser])).values()));
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
      flushContentSave();
    };

    text.observe(updateValue);
    window.addEventListener("pagehide", handlePageHide);

    void fetchRealtimeGrant(roomKey).then((grant) => {
      if (disposed) return;
      provider = new WebsocketProvider(syncUrl, roomKey, doc, { maxBackoffTime: 2500, params: { grant }, resyncInterval: 5000 });
      providerRef.current = provider;
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

    return () => {
      disposed = true;
      flushContentSave();
      window.removeEventListener("pagehide", handlePageHide);
      text.unobserve(updateValue);
      provider?.awareness.off("change", updatePresence);
      unwatchRealtimeConnection?.();
      presenceChangeRef.current([]);
      setCursors([]);
      setRemoteCarets([]);
      provider?.destroy();
      doc.destroy();
      providerRef.current = null;
      textRef.current = null;
    };
  }, [flushContentSave, readOnly, roomKey, user.color, user.id, user.initials, user.name, user.role]);

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

  function commitFormattedValue(nextValue: string, selectionStart: number, selectionEnd: number) {
    const text = textRef.current;

    setValue(nextValue);
    latestValueRef.current = nextValue;
    pendingSaveRef.current = true;

    if (text) {
      applyTextDiff(text, nextValue);
    } else {
      pendingSaveRef.current = false;
      contentChangeRef.current(nextValue);
    }

    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      const provider = providerRef.current;
      const yText = textRef.current;
      if (!provider || !yText) return;
      provider.awareness.setLocalStateField("selection", {
        anchor: Y.createRelativePositionFromTypeIndex(yText, selectionStart),
        head: Y.createRelativePositionFromTypeIndex(yText, selectionEnd)
      });
    }, 0);
  }

  function replaceSelection(replacement: string, selectionOffset = 0, selectionLength = replacement.length) {
    const textarea = textareaRef.current;
    if (!textarea || readOnly) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`;
    const nextSelectionStart = selectionStart + selectionOffset;
    commitFormattedValue(nextValue, nextSelectionStart, nextSelectionStart + selectionLength);
  }

  function wrapSelection(prefix: string, suffix: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea || readOnly) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectedText = value.slice(selectionStart, selectionEnd) || placeholder;
    const replacement = `${prefix}${selectedText}${suffix}`;
    replaceSelection(replacement, prefix.length, selectedText.length);
  }

  function transformSelectedLines(transformLine: (line: string, index: number) => string) {
    const textarea = textareaRef.current;
    if (!textarea || readOnly) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextLineBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    const originalBlock = value.slice(lineStart, lineEnd) || "";
    const replacement = originalBlock.split("\n").map(transformLine).join("\n");
    const nextValue = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
    commitFormattedValue(nextValue, lineStart, lineStart + replacement.length);
  }

  function formatHeading(level: number) {
    transformSelectedLines((line) => `${"#".repeat(level)} ${line.replace(/^#{1,6}\s+/, "") || "Heading"}`);
  }

  function applyInlineStyle(kind: "color" | "font" | "size", id: string) {
    wrapSelection(`<span data-note-${kind}="${id}">`, "</span>", "styled text");
  }

  function runFormatCommand(command: string) {
    if (command === "h1") formatHeading(1);
    if (command === "h2") formatHeading(2);
    if (command === "h3") formatHeading(3);
    if (command === "bold") wrapSelection("**", "**", "bold text");
    if (command === "italic") wrapSelection("_", "_", "italic text");
    if (command === "code") wrapSelection("`", "`", "code");
    if (command === "quote") transformSelectedLines((line) => `> ${line.replace(/^>\s?/, "") || "Quote"}`);
    if (command === "bullets") transformSelectedLines((line) => `- ${line.replace(/^[-*]\s+/, "") || "List item"}`);
    if (command === "numbers") transformSelectedLines((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "") || "List item"}`);
    if (command === "tasks") transformSelectedLines((line) => `- [ ] ${line.replace(/^- \[[ xX]\]\s+/, "") || "Task"}`);
    if (command === "table") replaceSelection("| Column | Column |\n| --- | --- |\n| Value | Value |", 2, 6);
    if (command === "divider") replaceSelection("\n---\n", 5, 0);
    if (command === "link") wrapSelection("[", "](https://example.com)", "link");
  }

  return (
    <section className="note-document realtime-document-host" onMouseMove={updatePointer}>
      <div className="note-editor-frame">
        <div className="note-toolbar">
          <div className="note-mode-switch" aria-label="Note mode">
            <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")} type="button">Edit</button>
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")} type="button">Preview</button>
          </div>
          <div className="note-format-menu" data-open={formatMenuOpen ? "true" : "false"}>
            <button disabled={readOnly || mode !== "edit"} onClick={() => setFormatMenuOpen((open) => !open)} type="button">Format</button>
            {formatMenuOpen && mode === "edit" && (
              <div className="note-format-panel">
                <section>
                  <span>Markdown</span>
                  <div className="note-format-grid">
                    {[
                      ["h1", "H1"],
                      ["h2", "H2"],
                      ["h3", "H3"],
                      ["bold", "Bold"],
                      ["italic", "Italic"],
                      ["code", "Code"],
                      ["quote", "Quote"],
                      ["bullets", "Bullets"],
                      ["numbers", "Numbers"],
                      ["tasks", "Tasks"],
                      ["table", "Table"],
                      ["divider", "Divider"],
                      ["link", "Link"]
                    ].map(([command, label]) => (
                      <button key={command} onMouseDown={(event) => { event.preventDefault(); runFormatCommand(command); }} type="button">{label}</button>
                    ))}
                  </div>
                </section>
                <section>
                  <span>Text color</span>
                  <div className="note-style-row">
                    {noteColorOptions.map((option) => (
                      <button aria-label={option.label} className="note-color-swatch" key={option.id} onMouseDown={(event) => { event.preventDefault(); applyInlineStyle("color", option.id); }} style={{ background: option.value || "var(--workspace-panel)" }} type="button" />
                    ))}
                  </div>
                </section>
                <section>
                  <span>Font</span>
                  <div className="note-style-row">
                    {noteFontOptions.map((option) => (
                      <button key={option.id} onMouseDown={(event) => { event.preventDefault(); applyInlineStyle("font", option.id); }} type="button">{option.label}</button>
                    ))}
                  </div>
                </section>
                <section>
                  <span>Size</span>
                  <div className="note-style-row">
                    {noteSizeOptions.map((option) => (
                      <button key={option.id} onMouseDown={(event) => { event.preventDefault(); applyInlineStyle("size", option.id); }} type="button">{option.label}</button>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
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
            <ReactMarkdown components={{ span: NotePreviewSpan }} rehypePlugins={[rehypeRaw, [rehypeSanitize, noteSanitizeSchema]]} remarkPlugins={[remarkGfm]}>
              {value || "_Nothing here yet._"}
            </ReactMarkdown>
          </div>
        )}
      </div>
      <LiveCursors cursors={cursors} localUserId={user.id} />
    </section>
  );
}

function NotePreviewSpan(props: HTMLAttributes<HTMLSpanElement> & { node?: unknown }) {
  const noteProps = props as HTMLAttributes<HTMLSpanElement> & { "data-note-color"?: string; "data-note-font"?: string; "data-note-size"?: string; dataNoteColor?: string; dataNoteFont?: string; dataNoteSize?: string };
  const colorId = noteProps["data-note-color"] ?? noteProps.dataNoteColor ?? "";
  const fontId = noteProps["data-note-font"] ?? noteProps.dataNoteFont ?? "";
  const sizeId = noteProps["data-note-size"] ?? noteProps.dataNoteSize ?? "";
  const color = noteColorOptions.find((option) => option.id === colorId)?.value;
  const fontFamily = noteFontOptions.find((option) => option.id === fontId)?.value;
  const fontSize = noteSizeOptions.find((option) => option.id === sizeId)?.value;
  const style: CSSProperties = {};
  const { children } = props;

  if (color) style.color = color;
  if (fontFamily) style.fontFamily = fontFamily;
  if (fontSize) style.fontSize = fontSize;

  return <span style={style}>{children as ReactNode}</span>;
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
