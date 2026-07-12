"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { SearchIcon } from "@/components/Icons";
import type { MessengerConversation } from "@/lib/client/messengerTypes";
import styles from "./Messenger.module.css";

export type MessengerRecipient = {
  color: string;
  email: string;
  id: string;
  initials: string;
  name: string;
};

type ConversationRailProps = {
  canCreateDirect: boolean;
  conversation: MessengerConversation | null;
  conversationButtonRef?: Ref<HTMLButtonElement>;
  conversations: MessengerConversation[];
  error: string | null;
  loading: boolean;
  mobileConversationOpen: boolean;
  onCreateDirect: (recipientUserId: string) => void;
  onRetry: () => void;
  onSelect: (conversationId: string) => void;
  recipients: MessengerRecipient[];
};

export function ConversationRail({ canCreateDirect, conversation, conversationButtonRef, conversations, error, loading, mobileConversationOpen, onCreateDirect, onRetry, onSelect, recipients }: ConversationRailProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const filteredRecipients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? recipients.filter((recipient) => `${recipient.name} ${recipient.email}`.toLocaleLowerCase().includes(normalized)) : recipients;
  }, [query, recipients]);
  const filteredConversations = useMemo(() => {
    const normalized = conversationQuery.trim().toLocaleLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((item) => `${item.title} ${item.lastMessage?.body ?? ""}`.toLocaleLowerCase().includes(normalized));
  }, [conversationQuery, conversations]);
  const channelConversations = filteredConversations.filter((item) => item.kind === "general");
  const directConversations = filteredConversations.filter((item) => item.kind === "direct");
  const chooseRecipient = (recipientUserId: string) => {
    setPickerOpen(false);
    setQuery("");
    onCreateDirect(recipientUserId);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  return (
    <aside className={`${styles.rail}${mobileConversationOpen ? ` ${styles.railMobileHidden}` : ""}`}>
      <div className={styles.railHeading}>
        <div>
          <h2>Messages</h2>
          <small>Workspace conversations</small>
        </div>
        {canCreateDirect && <div className={styles.newMessageWrap} ref={pickerRef}>
          <button aria-controls="new-conversation-picker" aria-expanded={pickerOpen} aria-haspopup="dialog" className={styles.newMessage} onClick={() => setPickerOpen((current) => !current)} type="button">+ New message</button>
          {pickerOpen && <div className={styles.recipientPicker} id="new-conversation-picker" role="dialog" aria-label="New conversation">
            <div className={styles.recipientPickerHeading}><strong>New conversation</strong><span>Choose a teammate to start a direct chat.</span></div>
            <div className={styles.recipientSearch}>
              <SearchIcon />
              <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search members…" type="search" value={query} />
              {query && <button aria-label="Clear member search" onClick={() => setQuery("")} type="button">×</button>}
            </div>
            <div className={styles.recipientList}>
              <span>Members</span>
              {filteredRecipients.map((recipient) => <button aria-label={`Message ${recipient.name}`} className={styles.recipientRow} key={recipient.id} onClick={() => chooseRecipient(recipient.id)} type="button">
                <span className={styles.recipientAvatar} data-color={recipient.color}>{recipient.initials}</span>
                <span className={styles.recipientCopy}><strong>{recipient.name}</strong><small>{recipient.email}</small></span>
                <span aria-hidden="true" className={styles.recipientArrow}>→</span>
              </button>)}
              {filteredRecipients.length === 0 && <div className={styles.recipientEmpty}><strong>{recipients.length === 0 ? "You’re the only member here." : "No members found"}</strong><span>{recipients.length === 0 ? "Invite someone to start a conversation." : "Try another name or email."}</span></div>}
            </div>
          </div>}
        </div>}
      </div>
      <div className={styles.conversationSearch}><input aria-label="Search conversations" onChange={(event) => setConversationQuery(event.target.value)} placeholder="Search conversations" type="search" value={conversationQuery} /></div>
      <nav aria-label="Messenger conversations" className={styles.conversationList}>
        {channelConversations.length > 0 && <ConversationGroup label="Channels">
          {channelConversations.map((item) => <ConversationRow active={conversation?.id === item.id && mobileConversationOpen} buttonRef={conversation?.id === item.id ? conversationButtonRef : undefined} conversation={item} key={item.id} onSelect={onSelect} />)}
        </ConversationGroup>}
        {directConversations.length > 0 && <ConversationGroup label="Direct messages">
          {directConversations.map((item) => <ConversationRow active={conversation?.id === item.id && mobileConversationOpen} buttonRef={conversation?.id === item.id ? conversationButtonRef : undefined} conversation={item} key={item.id} onSelect={onSelect} />)}
        </ConversationGroup>}
        {!loading && conversationQuery && filteredConversations.length === 0 && <div className={styles.railStatus}>No conversations found.</div>}
        {loading && <div className={styles.railStatus} role="status">Loading General…</div>}
        {!loading && error && <div className={styles.railError} role="alert"><span>{error}</span><button onClick={onRetry} type="button">Retry</button></div>}
        {!loading && !error && !conversation && <div className={styles.railStatus}>General is not available.</div>}
      </nav>
    </aside>
  );
}

function ConversationGroup({ children, label }: { children: ReactNode; label: string }) {
  return <section className={styles.conversationGroup}>
    <h3>{label}</h3>
    <div>{children}</div>
  </section>;
}

function ConversationRow({ active, buttonRef, conversation, onSelect }: { active: boolean; buttonRef?: Ref<HTMLButtonElement>; conversation: MessengerConversation; onSelect: (conversationId: string) => void }) {
  const lastMessagePreview = conversation.lastMessage?.body ?? "No messages yet";
  const timestamp = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const otherParticipant = conversation.participants.find((participant) => participant.userId !== conversation.receipt?.userId);
  return <button aria-current={active ? "page" : undefined} className={active ? styles.conversationActive : undefined} onClick={() => onSelect(conversation.id)} ref={buttonRef} type="button">
    <span className={styles.conversationIcon}>{conversation.kind === "direct" && otherParticipant ? otherParticipant.initials : "#"}</span>
    <span className={styles.conversationCopy}>
      <span><strong>{conversation.title}</strong><time dateTime={conversation.lastMessageAt ?? undefined}>{timestamp}</time></span>
      <span><small>{lastMessagePreview}</small>{conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b>}</span>
    </span>
  </button>;
}
