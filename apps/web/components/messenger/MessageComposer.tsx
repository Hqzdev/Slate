"use client";

import { type ChangeEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowIcon, FilePlusIcon } from "@/components/Icons";
import { messengerAttachmentAccept } from "@/lib/client/messengerAttachmentPolicy";
import { countMessengerCodePoints, normalizeMessengerDraft } from "@/lib/client/messengerViewState";
import type { MessengerComposerAttachment } from "./useMessengerAttachmentUploads";
import styles from "./Messenger.module.css";

type MessageComposerProps = {
  allowAiAttachments: boolean;
  canSend: boolean;
  conversationTitle: string;
  draftSeed: { body: string; id: number } | null;
  attachments: MessengerComposerAttachment[];
  offline: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment: (localId: string) => void;
  onSend: (body: string, attachmentLocalIds: string[], aiAttachmentLocalIds: string[]) => boolean;
  onTypingChange: (active: boolean) => void;
};

export function MessageComposer({ allowAiAttachments, attachments, canSend, conversationTitle, draftSeed, offline, onAddFiles, onRemoveAttachment, onRetryAttachment, onSend, onTypingChange }: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [compositionActive, setCompositionActive] = useState(false);
  const [consumedDraftSeedId, setConsumedDraftSeedId] = useState<number | null>(null);
  const [aiAttachmentLocalIds, setAiAttachmentLocalIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingActiveRef = useRef(false);
  const typingLastSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const effectiveDraft = draftSeed && draftSeed.id !== consumedDraftSeedId ? draftSeed.body : draft;
  const normalizedDraft = normalizeMessengerDraft(effectiveDraft);
  const codePointCount = countMessengerCodePoints(normalizedDraft);
  const readyAttachments = attachments.filter((item) => item.phase === "ready" && item.attachment);
  const attachmentsSettled = attachments.every((item) => item.phase === "ready");
  const canSubmit = canSend
    && codePointCount <= 8_000
    && (normalizedDraft.length > 0 || readyAttachments.length > 0)
    && attachmentsSettled;

  useEffect(() => {
    if (draftSeed && draftSeed.id !== consumedDraftSeedId) textareaRef.current?.focus();
  }, [consumedDraftSeedId, draftSeed]);

  useEffect(() => () => {
    if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
    if (typingActiveRef.current) onTypingChange(false);
  }, [onTypingChange]);

  function setTyping(active: boolean) {
    if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = null;
    if (!active) {
      if (typingActiveRef.current) onTypingChange(false);
      typingActiveRef.current = false;
      return;
    }
    if (!typingActiveRef.current || Date.now() - typingLastSentAtRef.current >= 1_500) {
      onTypingChange(true);
      typingLastSentAtRef.current = Date.now();
    }
    typingActiveRef.current = true;
    typingStopTimerRef.current = window.setTimeout(() => setTyping(false), 1_800);
  }

  function updateDraft(value: string) {
    if (draftSeed && draftSeed.id !== consumedDraftSeedId) setConsumedDraftSeedId(draftSeed.id);
    setDraft(value);
    if (canSend && !offline) setTyping(value.trim().length > 0);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit || !onSend(normalizedDraft, readyAttachments.map((item) => item.localId), aiAttachmentLocalIds)) return;
    setTyping(false);
    setDraft("");
    setAiAttachmentLocalIds([]);
    if (draftSeed) setConsumedDraftSeedId(draftSeed.id);
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    onAddFiles(files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || compositionActive || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(max-width: 960px)").matches) return;
    event.preventDefault();
    submit();
  }

  if (!canSend) {
    return (
      <div className={styles.readOnlyComposer}>
        <span>You can read this conversation. Only workspace owners and editors can send messages.</span>
        {effectiveDraft && <textarea aria-label="Unsent Messenger draft" readOnly value={effectiveDraft} />}
      </div>
    );
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <div className={styles.composerInner}>
        {attachments.length > 0 && (
        <div aria-label="Selected attachments" className={styles.composerAttachments}>
          {attachments.map((item) => (
            <div className={styles.composerAttachment} key={item.localId}>
              <span aria-hidden="true" className={styles.composerAttachmentIcon}><FilePlusIcon /></span>
              <span className={styles.composerAttachmentCopy}>
                <strong>{item.fileName}</strong>
                <small className={item.error ? styles.attachmentError : ""}>{attachmentStatus(item)}</small>
                {item.phase === "uploading" && <i aria-hidden="true"><span style={{ width: `${item.progress}%` }} /></i>}
              </span>
              <span className={styles.composerAttachmentActions}>
                {allowAiAttachments && item.phase === "ready" && item.attachment && <label className={styles.aiAttachmentConsent}><input checked={aiAttachmentLocalIds.includes(item.localId)} disabled={!aiAttachmentLocalIds.includes(item.localId) && aiAttachmentLocalIds.length >= 3} onChange={() => setAiAttachmentLocalIds((current) => current.includes(item.localId) ? current.filter((id) => id !== item.localId) : current.length < 3 ? [...current, item.localId] : current)} type="checkbox" />Use with AI</label>}
                {item.phase === "failed" && item.canRetry && <button onClick={() => onRetryAttachment(item.localId)} type="button">Retry</button>}
                <button aria-label={`Remove ${item.fileName}`} disabled={item.phase === "removing"} onClick={() => { setAiAttachmentLocalIds((current) => current.filter((id) => id !== item.localId)); onRemoveAttachment(item.localId); }} type="button">×</button>
              </span>
            </div>
          ))}
        </div>
        )}
        <input accept={messengerAttachmentAccept} className={styles.visuallyHidden} multiple onChange={selectFiles} ref={fileInputRef} type="file" />
        <button aria-label="Add attachment" className={styles.attachmentButton} disabled={offline || attachments.length >= 10} onClick={() => fileInputRef.current?.click()} type="button"><FilePlusIcon /></button>
        <textarea
          aria-label={`Message ${conversationTitle}`}
          onChange={(event) => updateDraft(event.target.value)}
          onCompositionEnd={() => setCompositionActive(false)}
          onCompositionStart={() => setCompositionActive(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTyping(false)}
          placeholder={offline ? "Write a message to send after reconnecting" : `Message everyone in ${conversationTitle}…`}
          ref={textareaRef}
          rows={1}
          value={effectiveDraft}
        />
        <button aria-label="Send message" className={styles.sendButton} disabled={!canSubmit} type="submit"><ArrowIcon /></button>
      </div>
    </form>
  );
}

function attachmentStatus(item: MessengerComposerAttachment) {
  if (item.error) return item.error;
  if (item.phase === "reserving") return "Preparing secure upload…";
  if (item.phase === "uploading") return `Uploading ${item.progress}%`;
  if (item.phase === "processing") return "Security scan and preview processing…";
  if (item.phase === "removing") return "Removing…";
  return `${formatBytes(item.byteSize)} · Ready`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
