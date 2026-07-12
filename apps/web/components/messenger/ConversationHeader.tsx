"use client";

import type { Ref } from "react";
import { PanelRightCloseIcon, PanelShowIcon, RefreshIcon, UsersIcon } from "@/components/Icons";
import type { MessengerConversation } from "@/lib/client/messengerTypes";
import styles from "./Messenger.module.css";

export type MessengerConnectionState = "connecting" | "degraded" | "live" | "offline" | "recovering";

type ConversationHeaderProps = {
  connectionState: MessengerConnectionState;
  conversation: MessengerConversation;
  headingRef?: Ref<HTMLHeadingElement>;
  onBack: () => void;
  onDetailsToggle: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  detailsOpen: boolean;
  workspaceName: string;
};

const connectionLabels: Record<MessengerConnectionState, string> = {
  connecting: "Syncing",
  degraded: "Degraded",
  live: "Up to date",
  offline: "Offline",
  recovering: "Catching up"
};

export function ConversationHeader({ connectionState, conversation, detailsOpen, headingRef, onBack, onDetailsToggle, onRefresh, refreshing, workspaceName }: ConversationHeaderProps) {
  const connectionLabel = connectionLabels[connectionState];
  const conversationMark = conversation.kind === "general" ? "#" : conversation.participants[0]?.initials ?? "DM";
  const conversationDescription = conversation.kind === "general" ? `${conversation.participants.length} ${conversation.participants.length === 1 ? "member" : "members"}` : `Direct message · ${workspaceName}`;
  return (
    <header className={styles.conversationHeader}>
      <button aria-label="Back to conversations" className={styles.mobileBack} onClick={onBack} type="button">←</button>
      <span className={styles.headerAvatar}>{conversationMark}</span>
      <div className={styles.headerCopy}>
        <h2 ref={headingRef} tabIndex={-1}>{conversation.title}</h2>
        <span>{conversation.kind === "general" && <UsersIcon />}{conversationDescription}</span>
      </div>
      <span aria-label={`Connection status: ${connectionLabel}`} className={`${styles.connectionState} ${styles[`connection${connectionState}`]}`} role="status"><i aria-hidden="true" /><span>{connectionLabel}</span></span>
      <button aria-label="Refresh messages" className={styles.headerAction} disabled={refreshing} onClick={onRefresh} title="Refresh messages" type="button"><RefreshIcon /></button>
      <button aria-controls="messenger-details" aria-expanded={detailsOpen} aria-label={detailsOpen ? "Hide conversation details" : "Show conversation details"} className={styles.headerAction} onClick={onDetailsToggle} title={detailsOpen ? "Hide details" : "Show details"} type="button">{detailsOpen ? <PanelRightCloseIcon /> : <PanelShowIcon />}</button>
    </header>
  );
}
