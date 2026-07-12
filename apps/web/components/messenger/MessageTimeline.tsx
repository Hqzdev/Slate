"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { messengerReactionEmoji, type MessengerAiInvocation, type MessengerMessage, type MessengerReactionEmoji } from "@/lib/client/messengerTypes";
import { shouldGroupMessengerMessages, type PendingMessengerMessage } from "@/lib/client/messengerViewState";
import { MessageAttachments } from "./MessageAttachments";
import styles from "./Messenger.module.css";

type MessageTimelineProps = {
  canReact: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  hasMoreBefore: boolean;
  loading: boolean;
  loadingOlder: boolean;
  messages: MessengerMessage[];
  newMessageCount: number;
  olderError: string | null;
  onAddReaction: (messageId: string, emoji: MessengerReactionEmoji) => void;
  onDiscardPending: (clientRequestId: string) => void;
  onEditPending: (clientRequestId: string) => void;
  onLoadOlder: () => void;
  onOpenAiHandoff: (invocationId: string) => void;
  onRemoveReaction: (messageId: string, reactionId: string) => void;
  onRetryPending: (clientRequestId: string) => void;
  onRetryAiInvocation: (invocation: MessengerAiInvocation) => void;
  onScroll: () => void;
  onScrollToLatest: () => void;
  pending: PendingMessengerMessage[];
  typingUsers: Array<{ name: string; userId: string }>;
  workspaceId: string;
};

export function MessageTimeline({ canReact, containerRef, hasMoreBefore, loading, loadingOlder, messages, newMessageCount, olderError, onAddReaction, onDiscardPending, onEditPending, onLoadOlder, onOpenAiHandoff, onRemoveReaction, onRetryAiInvocation, onRetryPending, onScroll, onScrollToLatest, pending, typingUsers, workspaceId }: MessageTimelineProps) {
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);
  const reactionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!pending.some((item) => item.retryAt !== null)) return;
    const updateNow = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateNow, 0);
    const timer = window.setInterval(updateNow, 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [pending]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncementsEnabled(!loading && !loadingOlder), 0);
    return () => window.clearTimeout(timer);
  }, [loading, loadingOlder]);

  useEffect(() => {
    if (!reactionPickerMessageId) return;
    const frame = window.requestAnimationFrame(() => reactionPickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [reactionPickerMessageId]);

  function closeReactionPicker(messageId: string) {
    setReactionPickerMessageId(null);
    window.requestAnimationFrame(() => reactionTriggerRefs.current.get(messageId)?.focus());
  }

  return (
    <div className={styles.timelineWrap}>
      <div aria-atomic="false" aria-busy={loading || loadingOlder} aria-label="Messages in General" aria-live={!loading && !loadingOlder && announcementsEnabled ? "polite" : "off"} aria-relevant="additions" className={styles.timeline} onScroll={onScroll} ref={containerRef} role="log">
        <div className={styles.olderMessages}>
          {olderError ? <div className={styles.olderError} role="alert"><span>{olderError}</span><button disabled={loadingOlder} onClick={onLoadOlder} type="button">Retry</button></div> : hasMoreBefore ? <button disabled={loadingOlder} onClick={onLoadOlder} type="button">{loadingOlder ? "Loading…" : "Load earlier messages"}</button> : messages.length > 0 ? <span>Beginning of General</span> : null}
        </div>
        {loading && messages.length === 0 && <div className={styles.timelineEmpty}>Loading messages…</div>}
        {!loading && messages.length === 0 && pending.length === 0 && (
          <div className={styles.timelineEmpty}>
            <strong>Start the conversation</strong>
            <span>Messages shared in General will appear here.</span>
          </div>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1] ?? null;
          const previousDay = previous ? new Date(previous.createdAt).toDateString() : null;
          const currentDay = new Date(message.createdAt).toDateString();
          const grouped = shouldGroupMessengerMessages(previous, message);
          return (
            <div key={message.id}>
              {previousDay !== currentDay && <div className={styles.dateDivider}><span>{formatMessageDay(message.createdAt)}</span></div>}
              <article className={`${styles.message}${grouped ? ` ${styles.messageGrouped}` : ""}`} data-message-id={message.id}>
                {!grouped && <span aria-hidden="true" className={styles.messageAvatar} data-color={message.author.color}>{message.author.initials}</span>}
                <div className={styles.messageContent}>
                  {!grouped && (
                    <header>
                      <strong>{message.author.name}</strong>
                      <time aria-label={new Date(message.createdAt).toLocaleString()} dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                    </header>
                  )}
                  {grouped && (
                    <header className={styles.visuallyHidden}>
                      <strong>{message.author.name}</strong>
                      <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
                    </header>
                  )}
                  {message.body && <p>{message.body}</p>}
                  <MessageAttachments attachments={message.attachments} conversationId={message.conversationId} workspaceId={workspaceId} />
                  {message.aiInvocation && <AiInvocationCard invocation={message.aiInvocation} onOpenHandoff={onOpenAiHandoff} onRetry={onRetryAiInvocation} />}
                  {(message.reactions.length > 0 || canReact) && (
                    <div className={styles.reactions}>
                      {message.reactions.map((reaction) => {
                        const names = reaction.reactors.map((reactor) => reactor.name).join(", ");
                        const countLabel = `${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}`;
                        const actionLabel = canReact
                          ? reaction.ownReactionId ? `Remove ${reaction.emoji} reaction` : `Add ${reaction.emoji} reaction`
                          : `${reaction.emoji} reactions unavailable`;
                        const reactorLabel = names || `${reaction.count} workspace ${reaction.count === 1 ? "member" : "members"}`;
                        return (
                          <button
                            aria-label={`${actionLabel}. ${countLabel} from ${reactorLabel}`}
                            aria-pressed={Boolean(reaction.ownReactionId)}
                            className={reaction.ownReactionId ? styles.reactionOwn : ""}
                            disabled={!canReact}
                            key={reaction.emoji}
                            onClick={() => reaction.ownReactionId ? onRemoveReaction(message.id, reaction.ownReactionId) : onAddReaction(message.id, reaction.emoji)}
                            title={names}
                            type="button"
                          >
                            <span>{reaction.emoji}</span><b>{reaction.count}</b>
                          </button>
                        );
                      })}
                      {canReact && (
                        <div className={styles.reactionPickerWrap}>
                          <button
                            aria-controls={`reaction-picker-${message.id}`}
                            aria-expanded={reactionPickerMessageId === message.id}
                            aria-label={`Add reaction to message from ${message.author.name}`}
                            className={styles.reactionAdd}
                            onClick={() => setReactionPickerMessageId((current) => current === message.id ? null : message.id)}
                            ref={(element) => {
                              if (element) reactionTriggerRefs.current.set(message.id, element);
                              else reactionTriggerRefs.current.delete(message.id);
                            }}
                            type="button"
                          >+</button>
                          {reactionPickerMessageId === message.id && (
                            <div
                              aria-label="Choose a reaction"
                              className={styles.reactionPicker}
                              id={`reaction-picker-${message.id}`}
                              onKeyDown={(event) => {
                                if (event.key !== "Escape") return;
                                event.preventDefault();
                                event.stopPropagation();
                                closeReactionPicker(message.id);
                              }}
                              ref={reactionPickerRef}
                              role="group"
                            >
                              {messengerReactionEmoji.map((emoji) => (
                                <button aria-label={`React with ${emoji}`} key={emoji} onClick={() => { onAddReaction(message.id, emoji); closeReactionPicker(message.id); }} type="button">{emoji}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
        {pending.map((item) => {
          const retryLocked = item.retryAt !== null && item.retryAt > now;
          const retrySeconds = retryLocked ? Math.max(1, Math.ceil((item.retryAt as number - now) / 1_000)) : null;
          const retryAllowed = item.errorCode !== "idempotency_conflict";
          return (
            <article className={`${styles.message} ${styles.pendingMessage}`} key={item.clientRequestId}>
              <span aria-hidden="true" className={styles.messageAvatar}>ME</span>
              <div className={styles.messageContent}>
                <header><strong>You</strong><time aria-label={new Date(item.createdAt).toLocaleString()} dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time></header>
                {item.body && <p>{item.body}</p>}
                {item.attachments && item.attachments.length > 0 && (
                  <div className={styles.pendingAttachments}>
                    {item.attachments.map((attachment) => <span key={attachment.id}><FileIconLabel />{attachment.fileName}</span>)}
                  </div>
                )}
                <div className={item.status === "failed" ? styles.pendingFailed : styles.pendingSending}>
                  <span aria-atomic="true" aria-live="polite" role="status">{item.status === "sending" ? "Sending…" : item.errorMessage ?? "Message was not sent"}</span>
                  {item.status === "failed" && (
                    <span>
                      {retryAllowed && <button disabled={retryLocked} onClick={() => onRetryPending(item.clientRequestId)} type="button">{retrySeconds ? `Retry in ${retrySeconds}s` : "Retry"}</button>}
                      <button onClick={() => onEditPending(item.clientRequestId)} type="button">Edit</button>
                      <button onClick={() => onDiscardPending(item.clientRequestId)} type="button">Discard</button>
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
      </div>
      <span aria-atomic="true" aria-live="polite" className={styles.visuallyHidden}>{newMessageCount > 0 ? `${newMessageCount} new ${newMessageCount === 1 ? "message" : "messages"}` : ""}</span>
      {newMessageCount > 0 && <button className={styles.newMessages} onClick={onScrollToLatest} type="button">{newMessageCount} new {newMessageCount === 1 ? "message" : "messages"} ↓</button>}
    </div>
  );
}

function TypingIndicator({ users }: { users: Array<{ name: string; userId: string }> }) {
  const names = users.map((user) => user.name);
  const label = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : "Several people are typing";
  return <div aria-live="polite" className={styles.typingIndicator}>
    <span>{label}</span>
    <i aria-hidden="true"><b /><b /><b /></i>
  </div>;
}

function AiInvocationCard({ invocation, onOpenHandoff, onRetry }: { invocation: MessengerAiInvocation; onOpenHandoff: (invocationId: string) => void; onRetry: (invocation: MessengerAiInvocation) => void }) {
  const active = invocation.status === "queued" || invocation.status === "running";
  const failed = invocation.status === "failed" || invocation.status === "cancelled" || invocation.status === "skipped";
  const retryable = failed && !invocation.errorCode?.startsWith("ai_attachment") && invocation.errorCode !== "malware_detected";
  return <div aria-live="polite" className={styles.aiInvocation}>
    <span>{active ? "Slate AI is preparing a response…" : invocation.status === "completed" ? "Slate AI response completed" : aiFailureLabel(invocation.errorCode)}</span>
    {retryable && <button onClick={() => onRetry(invocation)} type="button">{invocation.errorCode === "provider_outcome_unknown" ? "Send again" : "Retry"}</button>}
    {invocation.canOpenAssistant && <button onClick={() => onOpenHandoff(invocation.id)} type="button">{invocation.handoffCreated ? "Open AI Assistant" : "Open in AI Assistant"}</button>}
  </div>;
}

function aiFailureLabel(errorCode: string | null) {
  if (errorCode === "provider_outcome_unknown") return "The provider result is unknown. Sending again may create a duplicate provider request.";
  if (errorCode === "ai_disabled") return "Slate AI is disabled for this workspace.";
  if (errorCode?.startsWith("ai_attachment") || errorCode === "malware_detected") return "The selected attachment could not be used safely.";
  return "Slate AI could not complete this request.";
}

function FileIconLabel() {
  return <span aria-hidden="true">▧</span>;
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMessageDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
