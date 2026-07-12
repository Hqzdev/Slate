"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerAttachmentUploadTransport } from "@/lib/client/messengerAttachmentUpload";
import { messengerAttachmentTypeLimit, resolveMessengerAttachmentContentType } from "@/lib/client/messengerAttachmentPolicy";
import { messengerClient, MessengerClientError } from "@/lib/client/messengerClient";
import type { MessengerRealtimeEvent, MessengerUploadAttachment } from "@/lib/client/messengerTypes";

export type MessengerComposerAttachment = {
  attachment: MessengerUploadAttachment | null;
  byteSize: number;
  canRetry: boolean;
  contentType: string;
  error: string | null;
  fileName: string;
  localId: string;
  phase: "failed" | "processing" | "ready" | "removing" | "reserving" | "uploading";
  progress: number;
};

export function useMessengerAttachmentUploads(
  workspaceId: string,
  conversationId: string | null,
  realtimeEvent: { sequence: number; value: MessengerRealtimeEvent } | null
) {
  const [items, setItems] = useState<MessengerComposerAttachment[]>([]);
  const filesRef = useRef(new Map<string, File>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const timersRef = useRef(new Map<string, number>());
  const itemsRef = useRef<MessengerComposerAttachment[]>([]);
  const scopeRef = useRef({ conversationId, workspaceId });
  const scheduleStatusRef = useRef<(localId: string, delay?: number) => void>(() => undefined);

  const commit = useCallback((update: (current: MessengerComposerAttachment[]) => MessengerComposerAttachment[]) => {
    setItems((current) => {
      const next = update(current);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const updateItem = useCallback((localId: string, update: Partial<MessengerComposerAttachment>) => {
    commit((current) => current.map((item) => item.localId === localId ? { ...item, ...update } : item));
  }, [commit]);

  const scheduleStatus = useCallback((localId: string, delay = 1_000) => {
    const currentTimer = timersRef.current.get(localId);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(localId);
      const item = itemsRef.current.find((candidate) => candidate.localId === localId);
      const attachmentId = item?.attachment?.id;
      if (!item || !attachmentId || !conversationId || item.phase !== "processing") return;
      const controller = new AbortController();
      controllersRef.current.set(localId, controller);
      void messengerClient.getAttachment(workspaceId, conversationId, attachmentId, { signal: controller.signal })
        .then((attachment) => {
          if (controller.signal.aborted) return;
          if (attachment.status === "ready") {
            updateItem(localId, { attachment, canRetry: false, error: null, phase: "ready", progress: 100 });
            return;
          }
          if (attachment.status === "rejected" || attachment.status === "expired" || attachment.status === "deleting") {
            updateItem(localId, { attachment, canRetry: false, error: attachmentError(attachment), phase: "failed" });
            return;
          }
          updateItem(localId, { attachment });
          scheduleStatusRef.current(localId, 1_200);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          updateItem(localId, { canRetry: true, error: humanizeUploadError(error), phase: "failed" });
        })
        .finally(() => {
          if (controllersRef.current.get(localId) === controller) controllersRef.current.delete(localId);
        });
    }, delay);
    timersRef.current.set(localId, timer);
  }, [conversationId, updateItem, workspaceId]);

  useEffect(() => {
    scheduleStatusRef.current = scheduleStatus;
  }, [scheduleStatus]);

  const startUpload = useCallback(async (localId: string, file: File) => {
    if (!conversationId) return;
    const controller = new AbortController();
    controllersRef.current.set(localId, controller);
    updateItem(localId, { attachment: null, canRetry: false, error: null, phase: "reserving", progress: 0 });
    try {
      const reservation = await messengerClient.reserveAttachment(workspaceId, conversationId, {
        byteSize: file.size,
        declaredContentType: file.type,
        fileName: file.name
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      updateItem(localId, { attachment: reservation.attachment, phase: "uploading", progress: 1 });
      const etag = await messengerAttachmentUploadTransport.upload(reservation.upload, file, {
        onProgress: (progress) => updateItem(localId, { progress }),
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      const attachment = await messengerClient.completeAttachment(workspaceId, conversationId, reservation.attachment.id, etag, { signal: controller.signal });
      if (controller.signal.aborted) return;
      filesRef.current.delete(localId);
      if (attachment.status === "ready") {
        updateItem(localId, { attachment, canRetry: false, error: null, phase: "ready", progress: 100 });
        return;
      }
      updateItem(localId, { attachment, error: null, phase: "processing", progress: 100 });
      scheduleStatus(localId);
    } catch (error) {
      if (controller.signal.aborted) return;
      updateItem(localId, { canRetry: true, error: humanizeUploadError(error), phase: "failed" });
    } finally {
      if (controllersRef.current.get(localId) === controller) controllersRef.current.delete(localId);
    }
  }, [conversationId, scheduleStatus, updateItem, workspaceId]);

  const addFiles = useCallback((files: File[]) => {
    if (!conversationId || files.length === 0) return;
    const availableCount = Math.max(0, 10 - itemsRef.current.length);
    const accepted = files.slice(0, availableCount);
    const currentBytes = itemsRef.current.reduce((total, item) => total + item.byteSize, 0);
    let nextBytes = currentBytes;
    const nextItems = accepted.map((file): MessengerComposerAttachment => {
      const localId = crypto.randomUUID();
      const contentType = resolveContentType(file);
      const typeLimit = messengerAttachmentTypeLimit(contentType);
      const withinTotal = nextBytes + file.size <= 300 * 1024 * 1024;
      nextBytes += file.size;
      const error = !typeLimit
        ? "This file type is not supported."
        : file.size < 1 || file.size > typeLimit
          ? "This file exceeds the allowed size."
          : !withinTotal
            ? "Attachments may total at most 300 MiB."
            : null;
      if (!error) {
        filesRef.current.set(localId, file.type === contentType
          ? file
          : new File([file], file.name, { lastModified: file.lastModified, type: contentType }));
      }
      return {
        attachment: null,
        byteSize: file.size,
        canRetry: false,
        contentType,
        error,
        fileName: file.name,
        localId,
        phase: error ? "failed" : "reserving",
        progress: 0
      };
    });
    commit((current) => [...current, ...nextItems]);
    for (const item of nextItems) {
      const file = filesRef.current.get(item.localId);
      if (file) void startUpload(item.localId, file);
    }
  }, [commit, conversationId, startUpload]);

  const remove = useCallback((localId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.localId === localId);
    if (!item || !conversationId) return;
    controllersRef.current.get(localId)?.abort();
    controllersRef.current.delete(localId);
    const timer = timersRef.current.get(localId);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(localId);
    filesRef.current.delete(localId);
    updateItem(localId, { phase: "removing" });
    const attachmentId = item.attachment?.id;
    if (!attachmentId) {
      commit((current) => current.filter((candidate) => candidate.localId !== localId));
      return;
    }
    void messengerClient.abandonAttachment(workspaceId, conversationId, attachmentId)
      .catch(() => undefined)
      .finally(() => commit((current) => current.filter((candidate) => candidate.localId !== localId)));
  }, [commit, conversationId, updateItem, workspaceId]);

  const retry = useCallback((localId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.localId === localId);
    if (!item || item.phase !== "failed") return;
    if (item.attachment && new Set(["uploaded", "scanning"]).has(item.attachment.status)) {
      updateItem(localId, { canRetry: false, error: null, phase: "processing" });
      scheduleStatus(localId, 0);
      return;
    }
    const file = filesRef.current.get(localId);
    if (!file) return;
    if (item.attachment?.id && conversationId) {
      void messengerClient.abandonAttachment(workspaceId, conversationId, item.attachment.id).catch(() => undefined);
    }
    void startUpload(localId, file);
  }, [conversationId, scheduleStatus, startUpload, updateItem, workspaceId]);

  const consumeReady = useCallback((localIds: string[]) => {
    const selected = itemsRef.current.filter((item) => localIds.includes(item.localId) && item.phase === "ready" && item.attachment);
    commit((current) => current.filter((item) => !localIds.includes(item.localId)));
    return selected.map((item) => item.attachment as MessengerUploadAttachment);
  }, [commit]);

  const restore = useCallback((attachments: MessengerUploadAttachment[]) => {
    const restored = attachments.map((attachment): MessengerComposerAttachment => ({
      attachment,
      byteSize: Number(attachment.byteSize),
      canRetry: false,
      contentType: attachment.contentType,
      error: null,
      fileName: attachment.fileName,
      localId: crypto.randomUUID(),
      phase: "ready",
      progress: 100
    }));
    commit((current) => [...current, ...restored].slice(0, 10));
  }, [commit]);

  const abandonDetached = useCallback((attachments: MessengerUploadAttachment[]) => {
    if (!conversationId) return;
    for (const attachment of attachments) {
      void messengerClient.abandonAttachment(workspaceId, conversationId, attachment.id).catch(() => undefined);
    }
  }, [conversationId, workspaceId]);

  useEffect(() => {
    if (!realtimeEvent || realtimeEvent.value.type !== "attachment.changed") return;
    const attachmentId = realtimeEvent.value.payload.attachmentId;
    if (typeof attachmentId !== "string") return;
    const item = itemsRef.current.find((candidate) => candidate.attachment?.id === attachmentId && candidate.phase === "processing");
    if (item) scheduleStatus(item.localId, 0);
  }, [realtimeEvent, scheduleStatus]);

  useEffect(() => {
    if (scopeRef.current.workspaceId === workspaceId && scopeRef.current.conversationId === conversationId) return;
    const previousScope = scopeRef.current;
    for (const controller of controllersRef.current.values()) controller.abort();
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    if (previousScope.conversationId) {
      for (const item of itemsRef.current) {
        if (item.attachment?.id) void messengerClient.abandonAttachment(previousScope.workspaceId, previousScope.conversationId, item.attachment.id).catch(() => undefined);
      }
    }
    controllersRef.current.clear();
    timersRef.current.clear();
    filesRef.current.clear();
    itemsRef.current = [];
    setItems([]);
    scopeRef.current = { conversationId, workspaceId };
  }, [conversationId, workspaceId]);

  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) controller.abort();
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
  }, []);

  return { abandonDetached, addFiles, consumeReady, items, remove, restore, retry };
}

function attachmentError(attachment: MessengerUploadAttachment) {
  if (attachment.rejectionCode === "malware_detected") return "This file was rejected by the security scan.";
  if (attachment.status === "expired") return "This upload expired before it could be sent.";
  return "This file could not be processed safely.";
}

function humanizeUploadError(error: unknown) {
  if (error instanceof MessengerClientError) {
    if (error.code === "network_error") return "Upload paused because the server is unreachable.";
    if (error.code === "attachment_quota_exceeded") return "Attachment storage quota was exceeded.";
    if (error.code === "invalid_attachment") return "The selected file does not match the upload policy.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Attachment upload failed.";
}

function resolveContentType(file: File) {
  return resolveMessengerAttachmentContentType(file);
}
