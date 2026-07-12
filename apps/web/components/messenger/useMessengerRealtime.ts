"use client";

import { useEffect, useRef, useState } from "react";
import { MessengerRealtimeConnection, type MessengerRealtimeState } from "@/lib/client/messengerRealtimeConnection";
import type { MessengerRealtimeEvent } from "@/lib/client/messengerTypes";

export function useMessengerRealtime(
  workspaceId: string | null,
  onAccessDenied: () => void,
  onAuthenticationRequired: () => void,
  onUnreadRefresh: () => void
) {
  const [state, setState] = useState<MessengerRealtimeState>("connecting");
  const [event, setEvent] = useState<{ sequence: number; value: MessengerRealtimeEvent } | null>(null);
  const eventSequence = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;
    const connection = new MessengerRealtimeConnection({
      onAccessDenied,
      onAuthenticationRequired,
      onEvent: (value) => {
        eventSequence.current += 1;
        setEvent({ sequence: eventSequence.current, value });
        if (value.type !== "typing.changed") onUnreadRefresh();
      },
      onStateChange: setState,
      workspaceId
    });
    const reconnect = () => connection.reconnectNow();
    connection.start();
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
      connection.stop();
    };
  }, [onAccessDenied, onAuthenticationRequired, onUnreadRefresh, workspaceId]);

  return { event, state };
}
