"use client";

import { FileIcon } from "@/components/Icons";
import Image from "next/image";
import { messengerClient } from "@/lib/client/messengerClient";
import type { MessengerAttachment } from "@/lib/client/messengerTypes";
import styles from "./Messenger.module.css";

type MessageAttachmentsProps = {
  attachments: MessengerAttachment[];
  conversationId: string;
  workspaceId: string;
};

export function MessageAttachments({ attachments, conversationId, workspaceId }: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <div aria-label={`${attachments.length} message ${attachments.length === 1 ? "attachment" : "attachments"}`} className={styles.messageAttachments}>
      {attachments.map((attachment) => {
        const originalUrl = messengerClient.attachmentContentUrl(workspaceId, conversationId, attachment.id);
        if (attachment.kind === "image") {
          const thumbnailUrl = messengerClient.attachmentContentUrl(workspaceId, conversationId, attachment.id, "thumbnail");
          return (
            <article className={`${styles.attachmentCard} ${styles.imageAttachment}`} key={attachment.id}>
              <a aria-label={`Open ${attachment.fileName}`} href={originalUrl} rel="noreferrer" target="_blank">
                <Image alt={attachment.fileName} height={attachment.height ?? 360} loading="lazy" src={thumbnailUrl} unoptimized width={attachment.width ?? 480} />
              </a>
              <AttachmentMeta attachment={attachment} originalUrl={originalUrl} />
            </article>
          );
        }
        if (attachment.kind === "video") {
          const posterUrl = messengerClient.attachmentContentUrl(workspaceId, conversationId, attachment.id, "poster");
          return (
            <article className={`${styles.attachmentCard} ${styles.videoAttachment}`} key={attachment.id}>
              <video aria-label={attachment.fileName} controls playsInline poster={posterUrl} preload="metadata" src={originalUrl} />
              <AttachmentMeta attachment={attachment} originalUrl={originalUrl} />
            </article>
          );
        }
        return (
          <article className={`${styles.attachmentCard} ${styles.fileAttachment}`} key={attachment.id}>
            <span aria-hidden="true" className={styles.fileAttachmentIcon}><FileIcon /></span>
            <AttachmentMeta attachment={attachment} originalUrl={originalUrl} />
          </article>
        );
      })}
    </div>
  );
}

function AttachmentMeta({ attachment, originalUrl }: { attachment: MessengerAttachment; originalUrl: string }) {
  return (
    <div className={styles.attachmentMeta}>
      <span>
        <strong title={attachment.fileName}>{attachment.fileName}</strong>
        <small>{attachmentDetails(attachment)}</small>
      </span>
      <span className={styles.attachmentLinks}>
        <a href={originalUrl} rel="noreferrer" target="_blank">Open</a>
        <a download={attachment.fileName} href={originalUrl}>Download</a>
      </span>
    </div>
  );
}

function attachmentDetails(attachment: MessengerAttachment) {
  const values = [formatBytes(attachment.byteSize), simplifiedContentType(attachment.contentType)];
  if (attachment.width && attachment.height) values.push(`${attachment.width}×${attachment.height}`);
  if (attachment.durationMs !== null) values.push(formatDuration(attachment.durationMs));
  return values.join(" · ");
}

function simplifiedContentType(value: string) {
  return value.split("/").at(-1)?.toUpperCase() ?? "FILE";
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return "File";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDuration(value: number) {
  const totalSeconds = Math.max(0, Math.round(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
