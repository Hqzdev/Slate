"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { messengerClient, MessengerClientError } from "@/lib/client/messengerClient";
import { MessengerUnreadRequestScope } from "@/lib/client/messengerUnreadRequestScope";

type MessengerUnreadState = {
  errorCode: string | null;
  loading: boolean;
  total: number | null;
};

export function useMessengerUnread(workspaceId: string | null) {
  const [state, setState] = useState<MessengerUnreadState>({ errorCode: null, loading: false, total: null });
  const activeScopeRef = useRef<MessengerUnreadRequestScope | null>(null);
  const requestScope = useMemo(() => new MessengerUnreadRequestScope(workspaceId), [workspaceId]);

  const refresh = useCallback(async () => {
    if (activeScopeRef.current !== requestScope) return;
    if (!requestScope.workspaceId) {
      setState({ errorCode: null, loading: false, total: null });
      return;
    }
    const request = requestScope.begin();
    if (!request) return;
    setState((current) => ({ ...current, errorCode: null, loading: true }));
    try {
      const unread = await messengerClient.listUnread(requestScope.workspaceId, { signal: request.controller.signal });
      if (activeScopeRef.current !== requestScope || !requestScope.isCurrent(request)) return;
      setState({ errorCode: null, loading: false, total: unread.total });
    } catch (error) {
      if (activeScopeRef.current !== requestScope || !requestScope.isCurrent(request)) return;
      const errorCode = error instanceof MessengerClientError ? error.code : "network_error";
      setState({ errorCode, loading: false, total: null });
    } finally {
      requestScope.finish(request);
    }
  }, [requestScope]);

  useLayoutEffect(() => {
    activeScopeRef.current = requestScope;
    requestScope.activate();
    return () => {
      requestScope.deactivate();
      if (activeScopeRef.current === requestScope) activeScopeRef.current = null;
    };
  }, [requestScope]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  return { ...state, refresh };
}
