import { MessengerClient, MessengerClientError } from "./messengerClient";
import { MessengerContractError, parseMessengerRealtimeFrame, type MessengerRealtimeEvent } from "./messengerTypes";

export type MessengerRealtimeState = "connecting" | "degraded" | "live" | "offline";

type MessengerRealtimeConnectionOptions = {
  client?: MessengerClient;
  createSocket?: (url: string) => WebSocket;
  onAccessDenied: () => void;
  onAuthenticationRequired: () => void;
  onEvent: (event: MessengerRealtimeEvent) => void;
  onStateChange: (state: MessengerRealtimeState) => void;
  random?: () => number;
  workspaceId: string;
};

export class MessengerRealtimeConnection {
  private readonly client: MessengerClient;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly eventIds = new Set<string>();
  private readonly eventOrder: string[] = [];
  private readonly random: () => number;
  private attempt = 0;
  private controller: AbortController | null = null;
  private reconnectTimer: number | null = null;
  private rotationTimer: number | null = null;
  private socket: WebSocket | null = null;
  private stopped = true;

  constructor(private readonly options: MessengerRealtimeConnectionOptions) {
    this.client = options.client ?? new MessengerClient();
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.rotationTimer !== null) window.clearTimeout(this.rotationTimer);
    this.reconnectTimer = null;
    this.rotationTimer = null;
    this.socket?.close(1000, "Messenger view closed");
    this.socket = null;
  }

  reconnectNow() {
    if (this.stopped || !navigator.onLine) return;
    this.controller?.abort();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Messenger reconnecting");
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.rotationTimer !== null) window.clearTimeout(this.rotationTimer);
    this.reconnectTimer = null;
    this.rotationTimer = null;
    void this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    if (!navigator.onLine) {
      this.options.onStateChange("offline");
      return;
    }
    this.options.onStateChange("connecting");
    const controller = new AbortController();
    this.controller = controller;
    try {
      const authorization = await this.client.authorizeRealtime(this.options.workspaceId, { signal: controller.signal });
      if (this.stopped || controller.signal.aborted) return;
      const url = new URL(authorization.socketUrl);
      url.searchParams.set("grant", authorization.grant);
      const socket = this.createSocket(url.toString());
      this.socket = socket;
      const rotationDelay = Math.max(1, Date.parse(authorization.expiresAt) - Date.now() - 5_000 - Math.floor(this.random() * 5_000));
      this.rotationTimer = window.setTimeout(() => this.reconnectNow(), rotationDelay);
      socket.addEventListener("message", (event) => this.receive(event));
      socket.addEventListener("close", (event) => this.closed(socket, event));
      socket.addEventListener("error", () => {});
    } catch (error) {
      if (controller.signal.aborted || this.stopped) return;
      if (error instanceof MessengerClientError && error.status === 401) return this.options.onAuthenticationRequired();
      if (error instanceof MessengerClientError && (error.status === 403 || error.status === 404)) return this.options.onAccessDenied();
      this.options.onStateChange(navigator.onLine ? "degraded" : "offline");
      this.scheduleReconnect();
    }
  }

  private receive(message: MessageEvent) {
    if (typeof message.data !== "string" || message.data.length > 16_384) return this.socket?.close(1008, "Invalid Messenger frame");
    try {
      const frame = parseMessengerRealtimeFrame(JSON.parse(message.data));
      if (frame.type === "ready") {
        this.attempt = 0;
        this.options.onStateChange("live");
        return;
      }
      if (frame.workspaceId !== this.options.workspaceId || this.eventIds.has(frame.eventId)) return;
      this.eventIds.add(frame.eventId);
      this.eventOrder.push(frame.eventId);
      if (this.eventOrder.length > 500) this.eventIds.delete(this.eventOrder.shift() as string);
      this.options.onEvent(frame);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof MessengerContractError) this.socket?.close(1008, "Invalid Messenger frame");
    }
  }

  private closed(socket: WebSocket, event: CloseEvent) {
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.rotationTimer !== null) window.clearTimeout(this.rotationTimer);
    this.rotationTimer = null;
    if (this.stopped) return;
    if (event.code === 4003) return this.options.onAccessDenied();
    this.options.onStateChange(navigator.onLine ? "degraded" : "offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer !== null || !navigator.onLine) return;
    const ceiling = Math.min(30_000, 500 * (2 ** Math.min(this.attempt, 6)));
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, Math.floor(this.random() * ceiling));
  }
}
