"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { messengerClient, MessengerClientError } from "@/lib/client/messengerClient";
import type { MessengerRealtimeState } from "@/lib/client/messengerRealtimeConnection";
import { compareMessengerSequences, type MessengerAiInvocation, type MessengerConversation, type MessengerHistoryPage, type MessengerMessage, type MessengerReactionEmoji, type MessengerReceipt, type MessengerRealtimeEvent } from "@/lib/client/messengerTypes";
import { createWorkspaceNavigationUrl } from "@/lib/client/workspaceNavigation";
import { isMessengerNearLatest, maximumMessengerSequence, mergeMessengerConversationSnapshot, mergeMessengerMessages, mergeMessengerReceipt, removeCanonicalPending, retainMessengerMessages, selectMessengerRevalidationMessages, type PendingMessengerMessage } from "@/lib/client/messengerViewState";
import { ConversationHeader, type MessengerConnectionState } from "./ConversationHeader";
import { ConversationRail } from "./ConversationRail";
import type { MessengerRecipient } from "./ConversationRail";
import { MessageComposer } from "./MessageComposer";
import { MessageTimeline } from "./MessageTimeline";
import { MessengerDetailsPanel } from "./MessengerDetailsPanel";
import { useMessengerAttachmentUploads } from "./useMessengerAttachmentUploads";
import styles from "./Messenger.module.css";

type WorkspaceMessengerPageProps = {
  activeUser: {
    color: string;
    id: string;
    initials: string;
    name: string;
  };
  members: Array<{
    color: string;
    email: string;
    id: string;
    initials: string;
    name: string;
    role: "editor" | "owner" | "viewer";
  }>;
  onAccessDenied: () => void;
  onAuthenticationRequired: () => void;
  onConversationChange: (conversationId: string | null, historyMode: "push" | "replace") => void;
  onUnreadRefresh: () => void;
  realtimeEvent: { sequence: number; value: MessengerRealtimeEvent } | null;
  realtimeState: MessengerRealtimeState;
  requestedConversationId: string | null;
  workspaceId: string;
  workspaceName: string;
};

type DraftSeed = {
  body: string;
  id: number;
};

type HistoryState = Pick<MessengerHistoryPage, "hasMoreBefore" | "oldestSequence" | "resolvedThroughSequence" | "retainedFromSequence" | "serverLastSequence">;

type TimelineAnchor = {
  messageId: string;
  offsetTop: number;
};

const initialHistory: HistoryState = {
  hasMoreBefore: false,
  oldestSequence: null,
  retainedFromSequence: "1",
  resolvedThroughSequence: "0",
  serverLastSequence: "0"
};

export function WorkspaceMessengerPage({ activeUser, members, onAccessDenied, onAuthenticationRequired, onConversationChange, onUnreadRefresh, realtimeEvent, realtimeState, requestedConversationId, workspaceId, workspaceName }: WorkspaceMessengerPageProps) {
  const [conversation, setConversation] = useState<MessengerConversation | null>(null);
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [pending, setPending] = useState<PendingMessengerMessage[]>([]);
  const [history, setHistory] = useState<HistoryState>(initialHistory);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<MessengerConnectionState>("connecting");
  const [compactLayout, setCompactLayout] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(requestedConversationId));
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [draftSeed, setDraftSeed] = useState<DraftSeed | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<MessengerMessage[]>([]);
  const conversationRef = useRef<MessengerConversation | null>(null);
  const historyRef = useRef<HistoryState>(initialHistory);
  const receiptRef = useRef<MessengerReceipt | null>(null);
  const scopeRef = useRef(`${workspaceId}:none`);
  const loadControllerRef = useRef<AbortController | null>(null);
  const recoveryControllerRef = useRef<AbortController | null>(null);
  const recoveryRequestedRef = useRef(false);
  const mutationControllersRef = useRef(new Set<AbortController>());
  const reactionMessageLocksRef = useRef(new Set<string>());
  const readTimerRef = useRef<number | null>(null);
  const readScheduleTimerRef = useRef<number | null>(null);
  const scrollRecoveryTimerRef = useRef<number | null>(null);
  const requestedConversationIdRef = useRef(requestedConversationId);
  const conversationRefreshSequenceRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const focusConversationAfterOpenRef = useRef(false);
  const focusRailAfterCloseRef = useRef(false);
  const prependHeightRef = useRef<number | null>(null);
  const timelineAnchorRef = useRef<TimelineAnchor | null>(null);
  const scrollAfterMergeRef = useRef(false);
  const initialScrollRef = useRef(false);
  const typingTimersRef = useRef(new Map<string, number>());
  const conversationButtonRef = useRef<HTMLButtonElement | null>(null);
  const conversationHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const attachmentUploads = useMessengerAttachmentUploads(workspaceId, conversation?.id ?? null, realtimeEvent);

  const clearTypingUsers = useCallback(() => {
    for (const timer of typingTimersRef.current.values()) window.clearTimeout(timer);
    typingTimersRef.current.clear();
    setTypingUserIds([]);
  }, []);

  const publishTyping = useCallback((active: boolean) => {
    const currentConversation = conversationRef.current;
    if (!currentConversation || !navigator.onLine) return;
    void messengerClient.setTyping(workspaceId, currentConversation.id, active).catch(() => undefined);
  }, [workspaceId]);

  useEffect(() => () => clearTypingUsers(), [clearTypingUsers]);

  useEffect(() => {
    requestedConversationIdRef.current = requestedConversationId;
  }, [requestedConversationId]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 960px)");
    const updateLayout = () => {
      setCompactLayout(media.matches);
      if (!media.matches && conversationRef.current) {
        setMobileConversationOpen(true);
        if (requestedConversationIdRef.current !== conversationRef.current.id) {
          onConversationChange(conversationRef.current.id, "replace");
        }
      }
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, [onConversationChange]);

  const handleRequestError = useCallback((requestError: unknown, fallback: string) => {
    if (requestError instanceof MessengerClientError) {
      if (requestError.status === 401) {
        onAuthenticationRequired();
        return requestError.message;
      }
      if (requestError.status === 404 && requestError.code !== "message_not_found") {
        onAccessDenied();
        return requestError.message;
      }
      setConnectionState(requestError.code === "network_error" ? "offline" : "degraded");
      return humanizeMessengerError(requestError, fallback);
    }
    setConnectionState("degraded");
    return requestError instanceof Error ? requestError.message : fallback;
  }, [onAccessDenied, onAuthenticationRequired]);

  const refreshConversation = useCallback(async (signal?: AbortSignal) => {
    const scope = scopeRef.current;
    const refreshSequence = conversationRefreshSequenceRef.current + 1;
    conversationRefreshSequenceRef.current = refreshSequence;
    const page = await messengerClient.listConversations(workspaceId, { limit: 30, signal });
    if (signal?.aborted || scopeRef.current !== scope || !scope.startsWith(`${workspaceId}:`) || conversationRefreshSequenceRef.current !== refreshSequence) return null;
    const general = page.conversations.find((item) => item.kind === "general") ?? null;
    if (!general) throw new MessengerClientError({ code: "conversation_not_found", message: "General is not available", requestId: null, retryAfterMs: null, retryable: false, status: 404 });
    const currentId = conversationRef.current?.id ?? requestedConversationIdRef.current;
    const incomingConversation = page.conversations.find((item) => item.id === currentId) ?? general;
    const nextConversation = mergeMessengerConversationSnapshot(conversationRef.current?.id === incomingConversation.id ? conversationRef.current : null, incomingConversation);
    setConversations((current) => page.conversations.map((item) => mergeMessengerConversationSnapshot(current.find((existing) => existing.id === item.id) ?? null, item)));
    conversationRef.current = nextConversation;
    receiptRef.current = mergeMessengerReceipt(receiptRef.current, nextConversation.receipt);
    setConversation(nextConversation);
    return nextConversation;
  }, [workspaceId]);

  const advanceReceipt = useCallback(async (sequence: string, read: boolean) => {
    const currentConversation = conversationRef.current;
    const scope = scopeRef.current;
    if (!currentConversation || compareMessengerSequences(sequence, "0") <= 0) return;
    const receipt = receiptRef.current;
    const deliveredCurrent = receipt?.deliveredThroughSequence ?? "0";
    const readCurrent = receipt?.readThroughSequence ?? "0";
    const shouldDeliver = compareMessengerSequences(sequence, deliveredCurrent) > 0;
    const shouldRead = read && compareMessengerSequences(sequence, readCurrent) > 0;
    if (!shouldDeliver && !shouldRead) return;
    try {
      const nextReceipt = await messengerClient.updateReceipt(workspaceId, currentConversation.id, {
        deliveredThroughSequence: shouldDeliver ? sequence : undefined,
        readThroughSequence: shouldRead ? sequence : undefined
      });
      if (scopeRef.current !== scope) return;
      receiptRef.current = mergeMessengerReceipt(receiptRef.current, nextReceipt);
      if (shouldRead) {
        onUnreadRefresh();
        void refreshConversation().catch(() => undefined);
      }
    } catch (receiptError) {
      if (scopeRef.current !== scope) return;
      handleRequestError(receiptError, "Receipt update failed");
    }
  }, [handleRequestError, onUnreadRefresh, refreshConversation, workspaceId]);

  const scheduleReadReceipt = useCallback(() => {
    if (readTimerRef.current !== null) window.clearTimeout(readTimerRef.current);
    const container = timelineRef.current;
    const newestSequence = messagesRef.current.at(-1)?.sequence ?? null;
    const scope = scopeRef.current;
    if (!container || !newestSequence || document.visibilityState !== "visible" || !document.hasFocus() || !isLatestMessageVisible(container)) {
      readTimerRef.current = null;
      return;
    }
    readTimerRef.current = window.setTimeout(() => {
      readTimerRef.current = null;
      const current = timelineRef.current;
      if (!current || scopeRef.current !== scope || document.visibilityState !== "visible" || !document.hasFocus() || !isLatestMessageVisible(current)) return;
      void advanceReceipt(newestSequence, true);
    }, 500);
  }, [advanceReceipt]);

  const scheduleReadReceiptCheck = useCallback(() => {
    if (readScheduleTimerRef.current !== null) window.clearTimeout(readScheduleTimerRef.current);
    const scope = scopeRef.current;
    readScheduleTimerRef.current = window.setTimeout(() => {
      readScheduleTimerRef.current = null;
      if (scopeRef.current === scope) scheduleReadReceipt();
    }, 0);
  }, [scheduleReadReceipt]);

  const applyHistoryPage = useCallback((page: MessengerHistoryPage, mode: "initial" | "prepend" | "recover" | "revalidate") => {
    const retainedFromSequence = maximumMessengerSequence(historyRef.current.retainedFromSequence, page.retainedFromSequence);
    const retainedMessages = retainMessengerMessages(messagesRef.current, retainedFromSequence);
    const currentIds = new Set(retainedMessages.map((message) => message.id));
    const incomingCount = page.messages.filter((message) => !currentIds.has(message.id)).length;
    const nearLatest = timelineRef.current
      ? isMessengerNearLatest(timelineRef.current.scrollHeight, timelineRef.current.scrollTop, timelineRef.current.clientHeight)
      : true;
    const currentMessages = new Map(retainedMessages.map((message) => [message.id, message]));
    const incomingMessages = page.messages.map((message) => {
      const current = currentMessages.get(message.id);
      return current && reactionMessageLocksRef.current.has(message.id) ? { ...message, reactions: current.reactions } : message;
    });
    const merged = mergeMessengerMessages(retainedMessages, incomingMessages);
    messagesRef.current = merged;
    setMessages(merged);
    setPending((current) => incomingMessages.reduce(removeCanonicalPending, current));
    const mergedOldestSequence = merged[0]?.sequence ?? null;
    const reachedRetentionFloor = mergedOldestSequence === null || compareMessengerSequences(mergedOldestSequence, retainedFromSequence) <= 0;
    const pageDefinesOldestBoundary = page.oldestSequence !== null && page.oldestSequence === mergedOldestSequence;
    const nextHistory = {
      hasMoreBefore: reachedRetentionFloor ? false : pageDefinesOldestBoundary ? page.hasMoreBefore : historyRef.current.hasMoreBefore,
      oldestSequence: mergedOldestSequence,
      retainedFromSequence,
      resolvedThroughSequence: mode === "revalidate"
        ? historyRef.current.resolvedThroughSequence
        : maximumMessengerSequence(historyRef.current.resolvedThroughSequence, page.resolvedThroughSequence),
      serverLastSequence: maximumMessengerSequence(historyRef.current.serverLastSequence, page.serverLastSequence)
    };
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    if (mode === "initial") initialScrollRef.current = true;
    if ((mode === "recover" || mode === "revalidate") && incomingCount > 0) {
      if (nearLatest) scrollAfterMergeRef.current = true;
      else setNewMessageCount((current) => current + incomingCount);
    }
    const newest = merged.at(-1)?.sequence;
    if (newest) void advanceReceipt(newest, false);
    scheduleReadReceiptCheck();
  }, [advanceReceipt, scheduleReadReceiptCheck]);

  const loadInitialHistory = useCallback(async (nextConversation: MessengerConversation, controller: AbortController) => {
    setLoadingHistory(true);
    setError(null);
    setConnectionState(navigator.onLine ? "connecting" : "offline");
    const scope = `${workspaceId}:${nextConversation.id}`;
    scopeRef.current = scope;
    try {
      const page = await messengerClient.listMessages(workspaceId, nextConversation.id, { limit: 50, signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      applyHistoryPage(page, "initial");
      const caughtUp = compareMessengerSequences(historyRef.current.resolvedThroughSequence, historyRef.current.serverLastSequence) >= 0;
      setConnectionState(!navigator.onLine ? "offline" : caughtUp && recoveryControllerRef.current === null ? "live" : "recovering");
    } catch (historyError) {
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      setError(handleRequestError(historyError, "Messages failed to load"));
    } finally {
      if (!controller.signal.aborted && scopeRef.current === scope) setLoadingHistory(false);
    }
  }, [applyHistoryPage, handleRequestError, workspaceId]);

  useEffect(() => {
    const mutationControllers = mutationControllersRef.current;
    const reactionMessageLocks = reactionMessageLocksRef.current;
    const timer = window.setTimeout(() => {
      loadControllerRef.current?.abort();
      recoveryControllerRef.current?.abort();
      for (const controller of mutationControllers) controller.abort();
      mutationControllers.clear();
      reactionMessageLocks.clear();
      loadingOlderRef.current = false;
      conversationRefreshSequenceRef.current += 1;
      const controller = new AbortController();
      loadControllerRef.current = controller;
      scopeRef.current = `${workspaceId}:loading`;
      messagesRef.current = [];
      historyRef.current = initialHistory;
      receiptRef.current = null;
      setConversation(null);
      setMessages([]);
      setPending([]);
      setHistory(initialHistory);
      setError(null);
      setOlderError(null);
      setLoadingConversations(true);
      setLoadingOlder(false);
      setNewMessageCount(0);
      void refreshConversation(controller.signal)
        .then((general) => {
          if (controller.signal.aborted || !general) return;
          const storageKey = `slate:messenger:last:${workspaceId}`;
          const requestedId = requestedConversationIdRef.current;
          const selectedId = general.id;
          const compact = window.matchMedia("(max-width: 960px)").matches;
          writeLastConversation(storageKey, selectedId);
          if (requestedId !== selectedId && (!compact || requestedId !== null)) onConversationChange(selectedId, "replace");
          setMobileConversationOpen(!compact || requestedId !== null);
          void loadInitialHistory(general, controller);
        })
        .catch((conversationError) => {
          if (!controller.signal.aborted) setError(handleRequestError(conversationError, "General failed to load"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingConversations(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      scopeRef.current = `${workspaceId}:closed`;
      loadControllerRef.current?.abort();
      recoveryControllerRef.current?.abort();
      for (const controller of mutationControllers) controller.abort();
      mutationControllers.clear();
      reactionMessageLocks.clear();
      loadingOlderRef.current = false;
      conversationRefreshSequenceRef.current += 1;
      if (readTimerRef.current !== null) window.clearTimeout(readTimerRef.current);
      if (readScheduleTimerRef.current !== null) window.clearTimeout(readScheduleTimerRef.current);
      if (scrollRecoveryTimerRef.current !== null) window.clearTimeout(scrollRecoveryTimerRef.current);
    };
  }, [handleRequestError, loadInitialHistory, onConversationChange, refreshConversation, reloadVersion, workspaceId]);

  useEffect(() => {
    if (!conversation) return;
    const timer = window.setTimeout(() => {
      if (!compactLayout || requestedConversationId === conversation.id) setMobileConversationOpen(true);
      if (requestedConversationId === null && compactLayout) setMobileConversationOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [compactLayout, conversation, requestedConversationId]);

  useLayoutEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    if (prependHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    }
    if (timelineAnchorRef.current) {
      const anchor = timelineAnchorRef.current;
      timelineAnchorRef.current = null;
      const currentAnchor = findMessageElement(container, anchor.messageId);
      if (currentAnchor) {
        const currentOffset = currentAnchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTop += currentOffset - anchor.offsetTop;
      }
    }
    if (initialScrollRef.current || scrollAfterMergeRef.current) {
      container.scrollTop = container.scrollHeight;
      initialScrollRef.current = false;
      scrollAfterMergeRef.current = false;
      setNewMessageCount(0);
    }
  }, [messages, mobileConversationOpen, pending]);

  useLayoutEffect(() => {
    if (mobileConversationOpen && focusConversationAfterOpenRef.current && conversationHeadingRef.current) {
      focusConversationAfterOpenRef.current = false;
      conversationHeadingRef.current.focus();
    }
    if (!mobileConversationOpen && focusRailAfterCloseRef.current && conversationButtonRef.current) {
      focusRailAfterCloseRef.current = false;
      conversationButtonRef.current.focus();
    }
  }, [mobileConversationOpen]);

  const revalidateLoadedMessages = useCallback(async (conversationId: string, controller: AbortController, scope: string) => {
    const container = timelineRef.current;
    if (!container) return true;
    const firstVisibleSequence = findFirstVisibleMessageSequence(container, messagesRef.current);
    if (!firstVisibleSequence) return true;
    const page = await messengerClient.listMessages(workspaceId, conversationId, {
      afterSequence: previousMessengerSequence(firstVisibleSequence),
      limit: 100,
      signal: controller.signal
    });
    if (controller.signal.aborted || scopeRef.current !== scope) return false;
    const relevantMessages = selectMessengerRevalidationMessages(messagesRef.current, page.messages);
    if (!isMessengerNearLatest(container.scrollHeight, container.scrollTop, container.clientHeight)) {
      timelineAnchorRef.current = captureTimelineAnchor(container);
    }
    applyHistoryPage({ ...page, messages: relevantMessages }, "revalidate");
    return true;
  }, [applyHistoryPage, workspaceId]);

  const recoverMessages = useCallback(async (manual = false) => {
    const currentConversation = conversationRef.current;
    if (!currentConversation) return;
    if (recoveryControllerRef.current) {
      recoveryRequestedRef.current = true;
      return;
    }
    recoveryRequestedRef.current = false;
    const controller = new AbortController();
    recoveryControllerRef.current = controller;
    const scope = scopeRef.current;
    if (manual) setRefreshing(true);
    setConnectionState(navigator.onLine ? "recovering" : "offline");
    try {
      while (true) {
        let cursor = historyRef.current.resolvedThroughSequence;
        while (true) {
          const page = await messengerClient.listMessages(workspaceId, currentConversation.id, { afterSequence: cursor, limit: 100, signal: controller.signal });
          if (controller.signal.aborted || scopeRef.current !== scope) return;
          applyHistoryPage(page, "recover");
          if (!page.hasMoreAfter) break;
          if (page.resolvedThroughSequence === cursor) throw new Error("Messenger recovery cursor did not advance");
          cursor = page.resolvedThroughSequence;
          await yieldToBrowser();
        }
        const revalidated = await revalidateLoadedMessages(currentConversation.id, controller, scope);
        if (!revalidated) return;
        await refreshConversation(controller.signal);
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        const knownServerLastSequence = maximumMessengerSequence(
          historyRef.current.serverLastSequence,
          conversationRef.current?.lastMessageSequence ?? "0"
        );
        if (compareMessengerSequences(historyRef.current.resolvedThroughSequence, knownServerLastSequence) >= 0) break;
        await yieldToBrowser();
      }
      if (!controller.signal.aborted && scopeRef.current === scope) {
        setConnectionState(navigator.onLine ? "live" : "offline");
        setError(null);
        onUnreadRefresh();
      }
    } catch (recoveryError) {
      if (!controller.signal.aborted && scopeRef.current === scope) setError(handleRequestError(recoveryError, "Messages failed to refresh"));
    } finally {
      if (recoveryControllerRef.current === controller) recoveryControllerRef.current = null;
      if (manual) setRefreshing(false);
      if (recoveryRequestedRef.current && scopeRef.current === scope) {
        recoveryRequestedRef.current = false;
        setRecoveryVersion((current) => current + 1);
      }
    }
  }, [applyHistoryPage, handleRequestError, onUnreadRefresh, refreshConversation, revalidateLoadedMessages, workspaceId]);

  useEffect(() => {
    if (!realtimeEvent || realtimeEvent.value.workspaceId !== workspaceId) return;
    if (realtimeEvent.value.type === "typing.changed") {
      const { conversationId, payload } = realtimeEvent.value;
      const userId = typeof payload.userId === "string" ? payload.userId : null;
      const active = payload.active === "start";
      if (!conversationId || conversationId !== conversationRef.current?.id || !userId || userId === activeUser.id) return;
      const existingTimer = typingTimersRef.current.get(userId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      if (!active) {
        typingTimersRef.current.delete(userId);
        setTypingUserIds((current) => current.filter((id) => id !== userId));
        return;
      }
      setTypingUserIds((current) => current.includes(userId) ? current : [...current, userId]);
      typingTimersRef.current.set(userId, window.setTimeout(() => {
        typingTimersRef.current.delete(userId);
        setTypingUserIds((current) => current.filter((id) => id !== userId));
      }, 3_500));
      return;
    }
    if (realtimeEvent.value.type === "ai.invocation.changed" && typeof realtimeEvent.value.payload.invocationId === "string") {
      const invocationId = realtimeEvent.value.payload.invocationId;
      void messengerClient.getAiInvocation(workspaceId, invocationId).then((invocation) => {
        messagesRef.current = messagesRef.current.map((message) => message.id === invocation.sourceMessageId ? { ...message, aiInvocation: invocation } : message);
        setMessages(messagesRef.current);
      }).catch(() => undefined);
    }
    const currentConversationId = conversationRef.current?.id;
    if (realtimeEvent.value.conversationId && realtimeEvent.value.conversationId !== currentConversationId) {
      void refreshConversation().catch(() => undefined);
      return;
    }
    recoveryRequestedRef.current = true;
    if (!recoveryControllerRef.current) setRecoveryVersion((current) => current + 1);
  }, [activeUser.id, realtimeEvent, refreshConversation, workspaceId]);

  const retryAiInvocation = useCallback(async (invocation: MessengerAiInvocation) => {
    const currentConversation = conversationRef.current;
    if (!currentConversation) return;
    const confirmProviderRedispatch = invocation.errorCode === "provider_outcome_unknown";
    if (confirmProviderRedispatch && !window.confirm("The previous provider request may have completed. Send it again anyway?")) return;
    try {
      const updated = await messengerClient.retryAiInvocation(workspaceId, currentConversation.id, invocation.sourceMessageId, confirmProviderRedispatch);
      messagesRef.current = messagesRef.current.map((message) => message.id === updated.sourceMessageId ? { ...message, aiInvocation: updated } : message);
      setMessages(messagesRef.current);
    } catch (retryError) {
      setError(handleRequestError(retryError, "Slate AI retry failed"));
    }
  }, [handleRequestError, workspaceId]);

  const openAiHandoff = useCallback(async (invocationId: string) => {
    try {
      const result = await messengerClient.openAiHandoff(workspaceId, invocationId);
      const nextUrl = createWorkspaceNavigationUrl(window.location.href, { aiConversationId: result.conversationId, view: "ai", workspaceId });
      window.history.pushState(null, "", nextUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (handoffError) {
      setError(handleRequestError(handoffError, "AI Assistant handoff failed"));
    }
  }, [handleRequestError, workspaceId]);

  useEffect(() => {
    if (recoveryVersion === 0) return;
    const timer = window.setTimeout(() => void recoverMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [recoverMessages, recoveryVersion]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (realtimeState !== "live") clearTypingUsers();
      if (realtimeState === "offline") setConnectionState("offline");
      if (realtimeState === "degraded") setConnectionState("degraded");
      if (realtimeState === "connecting") setConnectionState((current) => current === "recovering" ? current : "connecting");
      if (realtimeState === "live") {
        recoveryRequestedRef.current = true;
        if (!recoveryControllerRef.current) setRecoveryVersion((current) => current + 1);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clearTypingUsers, realtimeState]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (realtimeState !== "live" && document.visibilityState === "visible" && navigator.onLine) void recoverMessages();
    }, 10_000);
    const recoverVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void recoverMessages(true);
      scheduleReadReceipt();
    };
    const markOffline = () => setConnectionState("offline");
    window.addEventListener("focus", recoverVisible);
    window.addEventListener("online", recoverVisible);
    window.addEventListener("offline", markOffline);
    document.addEventListener("visibilitychange", recoverVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recoverVisible);
      window.removeEventListener("online", recoverVisible);
      window.removeEventListener("offline", markOffline);
      document.removeEventListener("visibilitychange", recoverVisible);
    };
  }, [realtimeState, recoverMessages, scheduleReadReceipt]);

  const loadOlder = useCallback(async () => {
    const currentConversation = conversationRef.current;
    const beforeSequence = historyRef.current.oldestSequence;
    const container = timelineRef.current;
    const scope = scopeRef.current;
    if (!currentConversation || !beforeSequence || loadingOlderRef.current || !container) return;
    const controller = new AbortController();
    loadingOlderRef.current = true;
    mutationControllersRef.current.add(controller);
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await messengerClient.listMessages(workspaceId, currentConversation.id, { beforeSequence, limit: 50, signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      const currentContainer = timelineRef.current;
      if (!currentContainer) return;
      prependHeightRef.current = currentContainer.scrollHeight;
      applyHistoryPage(page, "prepend");
    } catch (olderError) {
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      prependHeightRef.current = null;
      setOlderError(handleRequestError(olderError, "Earlier messages failed to load"));
    } finally {
      mutationControllersRef.current.delete(controller);
      loadingOlderRef.current = false;
      if (scopeRef.current === scope) setLoadingOlder(false);
    }
  }, [applyHistoryPage, handleRequestError, workspaceId]);

  const attemptSend = useCallback(async (item: PendingMessengerMessage) => {
    const currentConversation = conversationRef.current;
    if (!currentConversation) return;
    const scope = scopeRef.current;
    setPending((current) => current.map((pendingItem) => pendingItem.clientRequestId === item.clientRequestId ? { ...pendingItem, errorCode: null, errorMessage: null, retryAt: null, status: "sending" } : pendingItem));
    if (!navigator.onLine) {
      setPending((current) => current.map((pendingItem) => pendingItem.clientRequestId === item.clientRequestId ? { ...pendingItem, errorCode: "network_error", errorMessage: "You're offline. Reconnect to retry.", retryAt: null, status: "failed" } : pendingItem));
      setConnectionState("offline");
      return;
    }
    const controller = new AbortController();
    mutationControllersRef.current.add(controller);
    try {
      const result = await messengerClient.sendMessage(workspaceId, currentConversation.id, {
        attachmentIds: item.attachments?.map((attachment) => attachment.id),
        aiAttachmentIds: item.aiAttachmentIds,
        body: item.body || null,
        clientRequestId: item.clientRequestId
      }, { signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      messagesRef.current = mergeMessengerMessages(messagesRef.current, [result.message]);
      setMessages(messagesRef.current);
      setPending((current) => removeCanonicalPending(current, result.message).filter((pendingItem) => pendingItem.clientRequestId !== item.clientRequestId));
      historyRef.current = {
        ...historyRef.current,
        serverLastSequence: compareMessengerSequences(result.message.sequence, historyRef.current.serverLastSequence) > 0
          ? result.message.sequence
          : historyRef.current.serverLastSequence
      };
      setHistory(historyRef.current);
      await refreshConversation(controller.signal);
      onUnreadRefresh();
      const caughtUp = compareMessengerSequences(historyRef.current.resolvedThroughSequence, historyRef.current.serverLastSequence) >= 0;
      const recoveryActive = recoveryControllerRef.current !== null;
      setConnectionState(!navigator.onLine ? "offline" : caughtUp && !recoveryActive ? "live" : "recovering");
      if (navigator.onLine && !caughtUp && !recoveryActive) void recoverMessages();
    } catch (sendError) {
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      const clientError = sendError instanceof MessengerClientError ? sendError : null;
      const errorMessage = handleRequestError(sendError, "Message was not sent");
      setPending((current) => current.map((pendingItem) => pendingItem.clientRequestId === item.clientRequestId ? {
        ...pendingItem,
        errorCode: clientError?.code ?? "send_failed",
        errorMessage,
        retryAt: clientError?.retryAfterMs ? Date.now() + clientError.retryAfterMs : null,
        status: "failed"
      } : pendingItem));
      if (clientError?.status === 403) void refreshConversation().catch(() => undefined);
    } finally {
      mutationControllersRef.current.delete(controller);
    }
  }, [handleRequestError, onUnreadRefresh, recoverMessages, refreshConversation, workspaceId]);

  const queueSend = useCallback((body: string, attachmentLocalIds: string[], aiAttachmentLocalIds: string[]) => {
    const container = timelineRef.current;
    const nearLatest = !container || isMessengerNearLatest(container.scrollHeight, container.scrollTop, container.clientHeight);
    const attachmentByLocalId = new Map(attachmentUploads.items.flatMap((item) => item.attachment ? [[item.localId, item.attachment.id] as const] : []));
    const attachments = attachmentUploads.consumeReady(attachmentLocalIds);
    const item: PendingMessengerMessage = {
      attachments,
      aiAttachmentIds: aiAttachmentLocalIds.flatMap((localId) => {
        const attachmentId = attachmentByLocalId.get(localId);
        return attachmentId ? [attachmentId] : [];
      }),
      body,
      clientRequestId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      retryAt: null,
      status: "sending"
    };
    setPending((current) => [...current, item]);
    if (nearLatest) scrollAfterMergeRef.current = true;
    else setNewMessageCount((current) => current + 1);
    void attemptSend(item);
    return true;
  }, [attachmentUploads, attemptSend]);

  const retryPending = useCallback((clientRequestId: string) => {
    const item = pending.find((pendingItem) => pendingItem.clientRequestId === clientRequestId);
    if (!item || item.status !== "failed" || item.retryAt && item.retryAt > Date.now()) return;
    void attemptSend(item);
  }, [attemptSend, pending]);

  const editPending = useCallback((clientRequestId: string) => {
    const item = pending.find((pendingItem) => pendingItem.clientRequestId === clientRequestId);
    if (!item) return;
    if (item.attachments) attachmentUploads.restore(item.attachments);
    setPending((current) => current.filter((pendingItem) => pendingItem.clientRequestId !== clientRequestId));
    setDraftSeed((current) => ({ body: item.body, id: (current?.id ?? 0) + 1 }));
  }, [attachmentUploads, pending]);

  const mutateReaction = useCallback(async (messageId: string, emoji: MessengerReactionEmoji, removeReactionId?: string) => {
    const currentConversation = conversationRef.current;
    const original = messagesRef.current.find((message) => message.id === messageId);
    if (!currentConversation || !original || reactionMessageLocksRef.current.has(messageId)) return;
    reactionMessageLocksRef.current.add(messageId);
    const originalReactions = original.reactions;
    const scope = scopeRef.current;
    const controller = new AbortController();
    mutationControllersRef.current.add(controller);
    const optimisticReactionId = removeReactionId ? null : `pending:${crypto.randomUUID()}`;
    const updateReaction = (message: MessengerMessage, reactionId: string | null) => {
      const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
      const reactions = removeReactionId
        ? message.reactions.flatMap((reaction) => reaction.emoji !== emoji ? [reaction] : reaction.count <= 1 ? [] : [{ ...reaction, count: reaction.count - 1, ownReactionId: null, reactors: reaction.reactors.filter((reactor) => reactor.id !== activeUser.id) }])
        : existing
          ? message.reactions.map((reaction) => reaction.emoji === emoji && !reaction.ownReactionId ? { ...reaction, count: reaction.count + 1, ownReactionId: reactionId, reactors: [...reaction.reactors, activeUser] } : reaction)
          : [...message.reactions, { count: 1, emoji, ownReactionId: reactionId, reactors: [activeUser] }];
      return { ...message, reactions };
    };
    messagesRef.current = messagesRef.current.map((message) => message.id === messageId ? updateReaction(message, optimisticReactionId) : message);
    setMessages(messagesRef.current);
    try {
      if (removeReactionId) {
        await messengerClient.removeReaction(workspaceId, currentConversation.id, messageId, removeReactionId, { signal: controller.signal });
      } else {
        const reaction = await messengerClient.addReaction(workspaceId, currentConversation.id, messageId, emoji, { signal: controller.signal });
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        messagesRef.current = messagesRef.current.map((message) => message.id === messageId ? {
          ...message,
          reactions: message.reactions.map((summary) => summary.emoji === emoji && summary.ownReactionId === optimisticReactionId ? { ...summary, ownReactionId: reaction.id } : summary)
        } : message);
        setMessages(messagesRef.current);
      }
    } catch (reactionError) {
      if (controller.signal.aborted || scopeRef.current !== scope) return;
      messagesRef.current = messagesRef.current.map((message) => message.id === messageId ? { ...message, reactions: originalReactions } : message);
      setMessages(messagesRef.current);
      setError(handleRequestError(reactionError, "Reaction update failed"));
      if (reactionError instanceof MessengerClientError && reactionError.status === 403) void refreshConversation().catch(() => undefined);
    } finally {
      mutationControllersRef.current.delete(controller);
      reactionMessageLocksRef.current.delete(messageId);
    }
  }, [activeUser, handleRequestError, refreshConversation, workspaceId]);

  function handleTimelineScroll() {
    const container = timelineRef.current;
    if (!container) return;
    if (container.scrollTop <= 64 && historyRef.current.hasMoreBefore && !loadingOlder) void loadOlder();
    if (isMessengerNearLatest(container.scrollHeight, container.scrollTop, container.clientHeight)) setNewMessageCount(0);
    if (scrollRecoveryTimerRef.current !== null) window.clearTimeout(scrollRecoveryTimerRef.current);
    scrollRecoveryTimerRef.current = window.setTimeout(() => {
      scrollRecoveryTimerRef.current = null;
      if (navigator.onLine && !loadingOlderRef.current) void recoverMessages();
    }, 400);
    scheduleReadReceipt();
  }

  function scrollToLatest() {
    const container = timelineRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ behavior: reducedMotion ? "auto" : "smooth", top: container.scrollHeight });
    setNewMessageCount(0);
    scheduleReadReceipt();
  }

  const openConversation = useCallback((conversationId: string, providedConversation?: MessengerConversation) => {
    const nextConversation = providedConversation ?? conversations.find((item) => item.id === conversationId);
    if (!nextConversation) return;
    const changedConversation = conversationRef.current?.id !== nextConversation.id;
    if (changedConversation) {
      clearTypingUsers();
      loadControllerRef.current?.abort();
      recoveryControllerRef.current?.abort();
      messagesRef.current = [];
      historyRef.current = initialHistory;
      receiptRef.current = nextConversation.receipt;
      conversationRef.current = nextConversation;
      setConversation(nextConversation);
      setMessages([]);
      setPending([]);
      setHistory(initialHistory);
      setError(null);
      setOlderError(null);
      const controller = new AbortController();
      loadControllerRef.current = controller;
      void loadInitialHistory(nextConversation, controller);
    }
    const shouldCreateHistoryEntry = compactLayout && requestedConversationId !== nextConversation.id;
    focusConversationAfterOpenRef.current = true;
    setMobileConversationOpen(true);
    writeLastConversation(`slate:messenger:last:${workspaceId}`, nextConversation.id);
    if (requestedConversationId !== nextConversation.id) onConversationChange(nextConversation.id, shouldCreateHistoryEntry ? "push" : "replace");
    if (shouldCreateHistoryEntry) markMessengerRailOrigin(workspaceId, nextConversation.id);
  }, [clearTypingUsers, compactLayout, conversations, loadInitialHistory, onConversationChange, requestedConversationId, workspaceId]);

  const createDirectConversation = useCallback(async (recipientUserId: string) => {
    const controller = new AbortController();
    mutationControllersRef.current.add(controller);
    try {
      const result = await messengerClient.openDirectConversation(workspaceId, recipientUserId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setConversations((current) => {
        const remaining = current.filter((item) => item.id !== result.conversation.id);
        return [...remaining, result.conversation];
      });
      openConversation(result.conversation.id, result.conversation);
    } catch (createError) {
      setError(handleRequestError(createError, "Direct message could not be opened"));
    } finally {
      mutationControllersRef.current.delete(controller);
    }
  }, [handleRequestError, openConversation, workspaceId]);

  function closeConversation() {
    focusRailAfterCloseRef.current = true;
    setMobileConversationOpen(false);
    const returnThroughHistory = Boolean(conversation && hasMessengerRailOrigin(workspaceId, conversation.id));
    if (returnThroughHistory) window.history.back();
    else onConversationChange(null, "replace");
  }

  const conversationError = !conversation ? error : null;
  return (
    <section aria-label="Messenger" className={`${styles.page}${detailsOpen ? ` ${styles.pageDetailsOpen}` : ""}`}>
      <ConversationRail
        canCreateDirect={members.some((member) => member.id === activeUser.id && (member.role === "owner" || member.role === "editor"))}
        conversation={conversation}
        conversationButtonRef={conversationButtonRef}
        conversations={conversations}
        error={conversationError}
        loading={loadingConversations}
        mobileConversationOpen={mobileConversationOpen}
        onCreateDirect={(recipientUserId) => void createDirectConversation(recipientUserId)}
        onRetry={() => setReloadVersion((current) => current + 1)}
        onSelect={openConversation}
        recipients={members.filter((member) => member.id !== activeUser.id).map((member): MessengerRecipient => ({ color: member.color, email: member.email, id: member.id, initials: member.initials, name: member.name }))}
      />
      {conversation && mobileConversationOpen ? (
        <section className={styles.conversation}>
          <ConversationHeader connectionState={connectionState} conversation={conversation} detailsOpen={detailsOpen} headingRef={conversationHeadingRef} onBack={closeConversation} onDetailsToggle={() => setDetailsOpen((current) => !current)} onRefresh={() => void recoverMessages(true)} refreshing={refreshing} workspaceName={workspaceName} />
          {error && <div className={styles.inlineError} role="alert"><span>{error}</span><button onClick={() => void recoverMessages(true)} type="button">Retry</button></div>}
          <MessageTimeline
            canReact={conversation.capabilities.canReact && connectionState !== "offline"}
            containerRef={timelineRef}
            hasMoreBefore={history.hasMoreBefore}
            loading={loadingHistory}
            loadingOlder={loadingOlder}
            messages={messages}
            newMessageCount={newMessageCount}
            olderError={olderError}
            onAddReaction={(messageId, emoji) => void mutateReaction(messageId, emoji)}
            onDiscardPending={(clientRequestId) => setPending((current) => {
              const discarded = current.find((item) => item.clientRequestId === clientRequestId);
              if (discarded?.attachments) attachmentUploads.abandonDetached(discarded.attachments);
              return current.filter((item) => item.clientRequestId !== clientRequestId);
            })}
            onEditPending={editPending}
            onLoadOlder={() => void loadOlder()}
            onOpenAiHandoff={(invocationId) => void openAiHandoff(invocationId)}
            onRemoveReaction={(messageId, reactionId) => {
              const message = messagesRef.current.find((item) => item.id === messageId);
              const emoji = message?.reactions.find((reaction) => reaction.ownReactionId === reactionId)?.emoji;
              if (emoji) void mutateReaction(messageId, emoji, reactionId);
            }}
            onRetryPending={retryPending}
            onRetryAiInvocation={(invocation) => void retryAiInvocation(invocation)}
            onScroll={handleTimelineScroll}
            onScrollToLatest={scrollToLatest}
            pending={pending}
            typingUsers={conversation.participants.filter((participant) => typingUserIds.includes(participant.userId))}
            workspaceId={workspaceId}
          />
          <MessageComposer
            allowAiAttachments={conversation.kind === "general"}
            attachments={attachmentUploads.items}
            canSend={conversation.capabilities.canSend}
            conversationTitle={conversation.title}
            draftSeed={draftSeed}
            offline={connectionState === "offline"}
            onAddFiles={attachmentUploads.addFiles}
            onRemoveAttachment={attachmentUploads.remove}
            onRetryAttachment={attachmentUploads.retry}
            onSend={queueSend}
            onTypingChange={publishTyping}
          />
        </section>
      ) : (
        <section className={styles.mobilePlaceholder}><span>Choose a conversation</span></section>
      )}
      {conversation && mobileConversationOpen && detailsOpen && <MessengerDetailsPanel connectionState={connectionState} conversation={conversation} />}
    </section>
  );
}

function writeLastConversation(key: string, conversationId: string) {
  try {
    window.localStorage.setItem(key, conversationId);
  } catch {
    return;
  }
}

function markMessengerRailOrigin(workspaceId: string, conversationId: string) {
  const currentState = isRecord(window.history.state) ? window.history.state : {};
  window.history.replaceState({ ...currentState, slateMessengerRailOrigin: `${workspaceId}:${conversationId}` }, "", window.location.href);
}

function hasMessengerRailOrigin(workspaceId: string, conversationId: string) {
  return isRecord(window.history.state) && window.history.state.slateMessengerRailOrigin === `${workspaceId}:${conversationId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLatestMessageVisible(container: HTMLDivElement) {
  if (!isMessengerNearLatest(container.scrollHeight, container.scrollTop, container.clientHeight)) return false;
  const messageElements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  const latestMessage = messageElements.item(messageElements.length - 1);
  if (!latestMessage) return false;
  const containerBounds = container.getBoundingClientRect();
  const messageBounds = latestMessage.getBoundingClientRect();
  return messageBounds.bottom >= containerBounds.top && messageBounds.top <= containerBounds.bottom && messageBounds.bottom <= containerBounds.bottom + 4;
}

function captureTimelineAnchor(container: HTMLDivElement): TimelineAnchor | null {
  const containerBounds = container.getBoundingClientRect();
  const messageElements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const messageElement of messageElements) {
    const bounds = messageElement.getBoundingClientRect();
    const messageId = messageElement.dataset.messageId;
    if (messageId && bounds.bottom >= containerBounds.top) {
      return { messageId, offsetTop: bounds.top - containerBounds.top };
    }
  }
  return null;
}

function findFirstVisibleMessageSequence(container: HTMLDivElement, messages: MessengerMessage[]) {
  const containerBounds = container.getBoundingClientRect();
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const messageElements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const messageElement of messageElements) {
    const bounds = messageElement.getBoundingClientRect();
    const messageId = messageElement.dataset.messageId;
    if (messageId && bounds.bottom >= containerBounds.top && bounds.top <= containerBounds.bottom) {
      return messagesById.get(messageId)?.sequence ?? null;
    }
  }
  return null;
}

function previousMessengerSequence(sequence: string) {
  const value = BigInt(sequence);
  return value > BigInt(0) ? (value - BigInt(1)).toString() : "0";
}

function findMessageElement(container: HTMLDivElement, messageId: string) {
  return [...container.querySelectorAll<HTMLElement>("[data-message-id]")]
    .find((messageElement) => messageElement.dataset.messageId === messageId) ?? null;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function humanizeMessengerError(error: MessengerClientError, fallback: string) {
  if (error.code === "messenger_unavailable") return "Messenger is not enabled for this environment yet.";
  if (error.code === "network_error") return "Messenger is offline. Existing messages remain available in this tab.";
  if (error.code === "workspace_write_denied") return "Your role no longer allows this action.";
  if (error.code === "rate_limited") return "Too many requests. Wait before retrying.";
  if (error.code === "idempotency_conflict") return "This retry no longer matches the original message. Edit it to create a new send.";
  if (error.code === "message_too_large") return "The message exceeds the 8,000 character limit.";
  return error.message || fallback;
}
