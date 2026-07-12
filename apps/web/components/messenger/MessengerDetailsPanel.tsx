"use client";

import type { MessengerConversation } from "@/lib/client/messengerTypes";
import type { MessengerConnectionState } from "./ConversationHeader";
import styles from "./Messenger.module.css";

type MessengerDetailsPanelProps = {
  connectionState: MessengerConnectionState;
  conversation: MessengerConversation;
};

export function MessengerDetailsPanel({ connectionState, conversation }: MessengerDetailsPanelProps) {
  const conversationMark = conversation.kind === "general" ? "#" : conversation.participants[0]?.initials ?? "DM";
  const conversationDescription = conversation.kind === "general" ? "Workspace group" : "Direct message";
  return (
    <aside className={styles.details} id="messenger-details">
      <div className={styles.detailsHeading}>
        <span className={styles.detailsMark}>{conversationMark}</span>
        <div><strong>{conversation.title}</strong><small>{conversationDescription}</small></div>
      </div>
      <section>
        <span>About</span>
        <p>Everyone in this workspace shares this conversation. Membership follows workspace access.</p>
      </section>
      <section>
        <span>Members · {conversation.participants.length}</span>
        <div className={styles.memberList}>
          {conversation.participants.map((participant) => (
            <div key={participant.userId}>
              <span className={styles.memberAvatar} data-color={participant.color}>{participant.initials}</span>
              <span><strong>{participant.name}</strong><small>{participant.email}</small></span>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.detailsConnection}>
        <span>Delivery</span>
        <p><i data-state={connectionState} /> REST recovery · {connectionState === "live" ? "current" : connectionState}</p>
      </section>
    </aside>
  );
}
