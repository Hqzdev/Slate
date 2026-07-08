import type { WebsocketProvider } from "y-websocket";

export type RealtimeConnectionStatus = "connected" | "connecting" | "idle" | "offline" | "reconnecting";

type RealtimeStatusEvent = {
  status: "connected" | "connecting" | "disconnected";
};

const reconnectingStatuses = new Set<RealtimeConnectionStatus>(["connecting", "reconnecting"]);

export function getRealtimeStatusText(status: RealtimeConnectionStatus) {
  if (status === "connected") return "Realtime live";
  if (status === "idle") return "Realtime idle";
  if (status === "offline") return "Realtime offline";
  if (status === "reconnecting") return "Realtime reconnecting";
  return "Realtime connecting";
}

export function getRealtimeStatusDetail(status: RealtimeConnectionStatus) {
  if (status === "connected") return "Shared document is connected";
  if (status === "idle") return "No shared document is open";
  if (status === "offline") return "Local edits stay queued until the network returns";
  if (status === "reconnecting") return "Trying to restore the shared document connection";
  return "Opening shared document connection";
}

export function isRealtimeRecovering(status: RealtimeConnectionStatus) {
  return reconnectingStatuses.has(status);
}

export function watchRealtimeConnection(provider: WebsocketProvider, emit: (status: RealtimeConnectionStatus) => void) {
  const getDisconnectedStatus = () => navigator.onLine ? "reconnecting" : "offline";

  const emitCurrentStatus = () => {
    if (!navigator.onLine) {
      emit("offline");
      return;
    }

    if (provider.wsconnected) {
      emit("connected");
      return;
    }

    emit(provider.wsconnecting ? "connecting" : "reconnecting");
  };

  const handleStatus = (event: RealtimeStatusEvent) => {
    if (event.status === "connected") {
      emit("connected");
      return;
    }

    if (event.status === "connecting") {
      emit(navigator.onLine ? "connecting" : "offline");
      return;
    }

    emit(getDisconnectedStatus());
  };

  const handleSync = (synced: boolean) => {
    if (synced) {
      emit("connected");
      return;
    }

    emitCurrentStatus();
  };

  const handleConnectionProblem = () => emit(getDisconnectedStatus());

  const handleOffline = () => emit("offline");

  const handleOnline = () => {
    emit(provider.wsconnected ? "connected" : "reconnecting");
    provider.connect();
  };

  provider.on("status", handleStatus);
  provider.on("sync", handleSync);
  provider.on("connection-close", handleConnectionProblem);
  provider.on("connection-error", handleConnectionProblem);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);
  window.setTimeout(emitCurrentStatus, 0);

  return () => {
    provider.off("status", handleStatus);
    provider.off("sync", handleSync);
    provider.off("connection-close", handleConnectionProblem);
    provider.off("connection-error", handleConnectionProblem);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
  };
}
