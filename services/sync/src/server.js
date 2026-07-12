import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import Redis from "ioredis";
import { PrismaClient } from "../generated/prisma/index.js";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { canvasStateValidator } from "./canvasState.js";
import { maximumRealtimeMessageBytes, maximumRealtimeStateBytes, realtimeUpdateValidator } from "./realtimeUpdateValidator.js";
import { RoomPersistence } from "./roomPersistence.js";
import { canonicalDocumentWhere, parseRoomName, TextReplacementError, TextReplacementService, validBearerAuthorization } from "./textReplacement.js";

const sharedWebEnvironmentKeys = new Set(["DATABASE_URL", "REALTIME_GRANT_SECRET", "REDIS_URL", "SYNC_INTERNAL_API_SECRET"]);

loadEnvFile(new URL("../.env", import.meta.url));
loadEnvFile(new URL("../../../apps/web/.env", import.meta.url), sharedWebEnvironmentKeys);

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 1234);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const persistDebounceMs = Number(process.env.PERSIST_DEBOUNCE_MS ?? 700);
const maximumPersistRetryMs = 30_000;
const maximumShutdownPersistAttempts = 3;
const shutdownPersistRetryMs = 250;
const shadowIdleReleaseMs = 30_000;
const maximumInternalRequestBytes = 1_048_576;
const textReplacementPath = "/internal/realtime/text-replace";
const accessRevocationChannel = "slate:sync:access-revoked";
const documents = new Map();
const documentLoads = new Map();
const prisma = new PrismaClient();
const redisPublisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
const redisSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
const redisOrigin = Symbol("redis-origin");
const textReplacementOrigin = Symbol("text-replacement-origin");
let shuttingDown = false;
let shutdownPromise = null;

redisPublisher.on("error", () => {});
redisSubscriber.on("error", () => {});

function loadEnvFile(url, allowedKeys = null) {
  try {
    const content = readFileSync(url, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;
      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim();
      if (key && (!allowedKeys || allowedKeys.has(key)) && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function roomChannel(roomName) {
  return `slate:sync:${roomName}`;
}

function seedDocumentFromCanonical(doc, parsedRoom, canonicalDocument) {
  if (parsedRoom.roomType === "canvas") {
    const canvasState = canonicalDocument.canvasState === null
      ? canvasStateValidator.createDefault()
      : canvasStateValidator.clone(canonicalDocument.canvasState);
    if (!canvasState) {
      throw new Error("Canonical canvas state is invalid");
    }
    doc.getMap("canvas").set("snapshot", canvasState);
    return canonicalDocument.canvasState === null;
  }

  const text = doc.getText(parsedRoom.roomType === "file" ? "source" : "note");
  if (canonicalDocument.content && text.length === 0) {
    text.insert(0, canonicalDocument.content);
  }
  return false;
}

async function getDocument(roomName) {
  const existing = documents.get(roomName);
  if (existing) return existing;
  const pending = documentLoads.get(roomName);
  if (pending) return pending;

  const load = loadDocument(roomName);
  documentLoads.set(roomName, load);
  try {
    return await load;
  } finally {
    if (documentLoads.get(roomName) === load) {
      documentLoads.delete(roomName);
    }
  }
}

async function loadDocument(roomName) {
  const parsedRoom = parseRoomName(roomName);
  if (!parsedRoom) throw new Error("Invalid room name");
  const canonicalDocument = await prisma.document.findFirst({
    select: { canvasState: true, content: true },
    where: canonicalDocumentWhere(parsedRoom)
  });
  if (!canonicalDocument) throw new Error("Document room not found");

  const realtimeState = await prisma.documentRealtime.findUnique({
    where: { documentId: parsedRoom.documentId }
  });
  let doc = new Y.Doc();
  let lastPersistError = null;
  let lastPersistedAt = null;
  let loadedFromPersistence = false;
  let recoveredFromFallback = false;
  let roomDocumentPrepared = false;

  if (realtimeState?.roomName === roomName) {
    const restoredDocument = new Y.Doc();
    try {
      if (realtimeState.state.byteLength > maximumRealtimeStateBytes) {
        throw new Error("Persisted realtime state exceeds the maximum size");
      }
      Y.applyUpdate(restoredDocument, new Uint8Array(realtimeState.state), redisOrigin);
      if (!realtimeUpdateValidator.prepareRoomDocument(parsedRoom.roomType, restoredDocument)) {
        throw new Error("Persisted realtime state is invalid or exceeds the maximum size");
      }
      doc.destroy();
      doc = restoredDocument;
      roomDocumentPrepared = true;
      loadedFromPersistence = true;
      lastPersistedAt = realtimeState.updatedAt;
    } catch (error) {
      restoredDocument.destroy();
      lastPersistError = `restore failed: ${error instanceof Error ? error.message : "unknown error"}`;
      recoveredFromFallback = true;
      recoveredFromFallback = seedDocumentFromCanonical(doc, parsedRoom, canonicalDocument) || recoveredFromFallback;
    }
  } else {
    recoveredFromFallback = Boolean(realtimeState);
    recoveredFromFallback = seedDocumentFromCanonical(doc, parsedRoom, canonicalDocument) || recoveredFromFallback;
  }

  if (!roomDocumentPrepared && !realtimeUpdateValidator.prepareRoomDocument(parsedRoom.roomType, doc)) {
    doc.destroy();
    throw new Error("Document realtime state is invalid or exceeds the maximum size");
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  const sockets = new Set();
  const room = {
    awareness,
    channel: roomChannel(roomName),
    dirty: false,
    documentId: parsedRoom.documentId,
    doc,
    lastPersistError,
    lastPersistedAt,
    loadedFromPersistence,
    persistenceRetired: false,
    persistPromise: Promise.resolve(),
    persistRetryCount: 0,
    persistedRevision: 0,
    persistTimer: null,
    recoveredFromFallback,
    revision: 0,
    roomName,
    roomType: parsedRoom.roomType,
    shadowReleaseTimer: null,
    sockets,
    textReplacementPromise: Promise.resolve(),
    updatesSincePersist: 0,
    workspaceId: parsedRoom.workspaceId
  };

  doc.on("update", (update, origin) => {
    realtimeUpdateValidator.observeAppliedUpdate(room, update);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(room, encoding.toUint8Array(encoder), origin);

    if (origin !== redisOrigin) {
      room.revision += 1;
      room.dirty = room.revision > room.persistedRevision;
      room.updatesSincePersist = room.revision - room.persistedRevision;
      queuePersist(room);
      void redisPublisher.publish(room.channel, Buffer.from(update).toString("base64")).catch(() => undefined);
    }
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    broadcast(room, encoding.toUint8Array(encoder), origin);
  });

  documents.set(roomName, room);
  await redisSubscriber.subscribe(room.channel);
  if (room.recoveredFromFallback) {
    room.revision = 1;
    room.dirty = true;
    room.updatesSincePersist = 1;
    await roomPersistence.persist(room);
    if (room.persistenceRetired) {
      throw new Error("Document room changed during recovery");
    }
  }
  return room;
}

function queuePersist(room) {
  if (shuttingDown || room.persistenceRetired) return;
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
  }

  const delay = room.lastPersistError
    ? Math.min(persistDebounceMs * (2 ** room.persistRetryCount), maximumPersistRetryMs)
    : persistDebounceMs;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void roomPersistence.persist(room);
  }, delay);
}

function retireRoom(room) {
  if (documents.get(room.roomName) === room) documents.delete(room.roomName);
  cancelShadowRelease(room);
  realtimeUpdateValidator.release(room);
  void redisSubscriber.unsubscribe(room.channel);
  if (room.sockets.size === 0) {
    room.awareness.destroy();
    room.doc.destroy();
  } else {
    for (const socket of room.sockets) socket.close(4009, "Document room changed");
  }
}

function cancelShadowRelease(room) {
  if (!room.shadowReleaseTimer) return;
  clearTimeout(room.shadowReleaseTimer);
  room.shadowReleaseTimer = null;
}

function scheduleShadowRelease(room) {
  if (room.persistenceRetired || room.sockets.size > 0) return;
  cancelShadowRelease(room);
  room.shadowReleaseTimer = setTimeout(() => {
    room.shadowReleaseTimer = null;
    if (room.sockets.size === 0) realtimeUpdateValidator.release(room);
  }, shadowIdleReleaseMs);
}

const roomPersistence = new RoomPersistence(prisma, queuePersist, retireRoom);

const textReplacementService = new TextReplacementService({
  applyUpdate: (room, update) => {
    const applied = realtimeUpdateValidator.apply(room, update, textReplacementOrigin);
    scheduleShadowRelease(room);
    return applied;
  },
  getRoom: getDocument,
  isAvailable: () => !shuttingDown,
  persistRoom: (room) => roomPersistence.persist(room),
  receiptSecret: process.env.SYNC_INTERNAL_API_SECRET ?? ""
});

async function readInternalJson(request) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumInternalRequestBytes) {
    throw new TextReplacementError("payload_too_large", "Request body exceeds the maximum size", 413);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumInternalRequestBytes) {
      throw new TextReplacementError("payload_too_large", "Request body exceeds the maximum size", 413);
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TextReplacementError("invalid_request", "Request body contains invalid JSON", 400);
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

async function handleTextReplacementRequest(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed", message: "Only POST is supported" }, { allow: "POST" });
    return;
  }

  const secret = process.env.SYNC_INTERNAL_API_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    sendJson(response, 503, { error: "internal_auth_unavailable", message: "Internal sync authentication is not configured" });
    return;
  }
  if (!validBearerAuthorization(request.headers.authorization, secret)) {
    sendJson(response, 401, { error: "unauthorized", message: "Internal sync authentication failed" });
    return;
  }
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    sendJson(response, 400, { error: "invalid_request", message: "Content-Type must be application/json" });
    return;
  }

  try {
    const input = await readInternalJson(request);
    const result = await textReplacementService.execute(input);
    sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof TextReplacementError) {
      sendJson(response, error.status, {
        error: error.code,
        message: error.message,
        ...error.details
      });
      return;
    }
    sendJson(response, 503, { error: "realtime_unavailable", message: "Realtime document update failed" });
  }
}

function broadcast(room, message, origin) {
  for (const socket of room.sockets) {
    if (socket !== origin) sendSocketMessage(socket, message);
  }
}

function sendSocketMessage(socket, message) {
  if (socket.readyState !== socket.OPEN) return false;
  try {
    socket.send(message);
    return true;
  } catch {
    socket.terminate();
    return false;
  }
}

function readAwarenessUpdate(update) {
  const decoder = decoding.createDecoder(update);
  const clients = [];
  const len = decoding.readVarUint(decoder);

  for (let index = 0; index < len; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));
    clients.push({ clientId, state });
  }

  return clients;
}

function handleMessage(room, socket, payload) {
  if (shuttingDown || room.persistenceRetired) return;
  const decoder = decoding.createDecoder(new Uint8Array(payload));
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  if (messageType === messageSync) {
    const syncMessageType = decoding.readVarUint(decoder);

    if (!socket.identity.canWrite && syncMessageType !== syncProtocol.messageYjsSyncStep1) {
      return;
    }

    encoding.writeVarUint(encoder, messageSync);

    if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
      syncProtocol.readSyncStep1(decoder, encoder, room.doc);
    } else if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
      applyRealtimeUpdate(room, socket, decoding.readVarUint8Array(decoder));
    } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
      applyRealtimeUpdate(room, socket, decoding.readVarUint8Array(decoder));
    } else {
      throw new Error("Unknown sync message type");
    }
  }

  if (messageType === messageAwareness) {
    const update = decoding.readVarUint8Array(decoder);
    const clients = readAwarenessUpdate(update);
    const identityUpdate = awarenessProtocol.modifyAwarenessUpdate(update, (state) => {
      if (state === null) return null;

      return {
        ...state,
        user: socket.identity
      };
    });

    for (const client of clients) {
      if (client.state === null) {
        socket.awarenessClients.delete(client.clientId);
      } else {
        socket.awarenessClients.add(client.clientId);
      }
    }

    awarenessProtocol.applyAwarenessUpdate(room.awareness, identityUpdate, socket);
  }

  if (messageType === messageQueryAwareness) {
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys()))
    );
  }

  if (encoding.length(encoder) > 1 && socket.readyState === socket.OPEN) {
    sendSocketMessage(socket, encoding.toUint8Array(encoder));
  }
}

function applyRealtimeUpdate(room, socket, update) {
  if (!realtimeUpdateValidator.apply(room, update, socket)) {
    socket.close(4008, "Invalid document update");
  }
}

function safelyHandleMessage(room, socket, payload) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    handleMessage(room, socket, payload);
  } catch {
    socket.close(4008, "Invalid document message");
  }
}

function messageByteLength(payload) {
  if (typeof payload?.byteLength === "number") return payload.byteLength;
  if (Array.isArray(payload)) return payload.reduce((total, entry) => total + entry.byteLength, 0);
  return maximumRealtimeMessageBytes + 1;
}

function roomNameFromRequest(request) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const roomName = decodeURIComponent(url.pathname.slice(1));
  return roomName || "default";
}

async function authorizeConnection(request, roomName) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const grant = url.searchParams.get("grant") ?? "";
  return verifyRealtimeGrant(grant, roomName);
}

function verifyRealtimeGrant(token, roomName) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signRealtimeGrant(encodedPayload);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");
  if (signatureBuffer.length !== expectedSignatureBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) return null;

  const payload = parseRealtimeGrantPayload(encodedPayload);
  if (!payload) return null;
  if (payload.roomName !== roomName) return null;
  if (payload.expiresAt <= Date.now()) return null;

  return {
    user: {
      canWrite: payload.canWrite,
      color: payload.color,
      email: payload.email,
      id: payload.id,
      initials: payload.initials,
      name: payload.name,
      role: payload.role
    }
  };
}

function parseRealtimeGrantPayload(encodedPayload) {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof payload.canWrite !== "boolean" ||
      typeof payload.color !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.id !== "string" ||
      typeof payload.initials !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.roomName !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function signRealtimeGrant(encodedPayload) {
  return createHmac("sha256", realtimeGrantSecret()).update(encodedPayload).digest("base64url");
}

function realtimeGrantSecret() {
  const secret = process.env.REALTIME_GRANT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_GRANT_SECRET is required");
  }
  return "slate-local-realtime-grant-secret";
}

async function healthPayload() {
  const database = await prisma.$queryRaw`SELECT 1 as ok`.then(() => "connected").catch(() => "error");
  const persistedDocuments = await prisma.documentRealtime.count().catch(() => null);
  const redis = redisPublisher.status === "ready" && redisSubscriber.status === "ready" ? "connected" : "connecting";
  const roomStates = Array.from(documents.values()).map((room) => ({
    dirty: room.dirty,
    lastPersistError: room.lastPersistError,
    lastPersistedAt: room.lastPersistedAt,
    loadedFromPersistence: room.loadedFromPersistence,
    recoveredFromFallback: room.recoveredFromFallback,
    roomName: room.roomName,
    sockets: room.sockets.size,
    updatesSincePersist: room.updatesSincePersist
  }));
  const persistenceOk = database === "connected" && persistedDocuments !== null && roomStates.every((room) => !room.lastPersistError);
  return {
    database,
    ok: database === "connected" && persistenceOk,
    persistence: {
      persistedDocuments,
      rooms: roomStates,
      status: persistenceOk ? "ready" : "degraded"
    },
    redis,
    rooms: documents.size
  };
}

redisSubscriber.on("message", (channel, message) => {
  if (shuttingDown) return;
  if (channel === accessRevocationChannel) {
    try {
      const revocation = JSON.parse(message);
      if (typeof revocation.userId !== "string" || typeof revocation.workspaceId !== "string") return;
      for (const room of documents.values()) {
        if (room.workspaceId !== revocation.workspaceId) continue;
        for (const socket of room.sockets) {
          if (socket.identity?.id === revocation.userId) socket.close(4003, "Workspace access revoked");
        }
      }
    } catch {}
    return;
  }
  for (const room of documents.values()) {
    if (room.channel === channel) {
      realtimeUpdateValidator.apply(room, Buffer.from(message, "base64"), redisOrigin);
      scheduleShadowRelease(room);
      break;
    }
  }
});

void redisSubscriber.subscribe(accessRevocationChannel).catch(() => undefined);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await healthPayload()));
    return;
  }
  if (requestUrl.pathname === textReplacementPath) {
    await handleTextReplacementRequest(request, response);
    return;
  }

  response.writeHead(404);
  response.end();
});

const webSocketServer = new WebSocketServer({ maxPayload: maximumRealtimeMessageBytes, server });

webSocketServer.on("connection", async (socket, request) => {
  const roomName = roomNameFromRequest(request);
  const pendingMessages = [];
  let pendingMessageBytes = 0;
  let room = null;

  socket.binaryType = "arraybuffer";
  socket.awarenessClients = new Set();
  socket.on("message", (payload) => {
    if (room) {
      safelyHandleMessage(room, socket, payload);
      return;
    }

    pendingMessageBytes += messageByteLength(payload);
    if (pendingMessageBytes > maximumRealtimeStateBytes) {
      pendingMessages.length = 0;
      socket.close(1009, "Pending messages are too large");
      return;
    }
    pendingMessages.push(payload);
  });

  const authorization = await authorizeConnection(request, roomName);

  if (!authorization) {
    socket.close(1008, "Unauthorized");
    return;
  }

  socket.identity = authorization.user;

  try {
    room = await getDocument(roomName);
  } catch {
    socket.close(1011, "Room failed to load");
    return;
  }

  if (socket.readyState !== socket.OPEN) return;

  room.sockets.add(socket);
  cancelShadowRelease(room);

  socket.on("close", () => {
    room.sockets.delete(socket);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(socket.awarenessClients), socket);
    if (room.sockets.size === 0) {
      if (room.persistenceRetired) {
        cancelShadowRelease(room);
        realtimeUpdateValidator.release(room);
        room.awareness.destroy();
        room.doc.destroy();
      } else {
        scheduleShadowRelease(room);
        if (room.dirty && !shuttingDown) {
          void roomPersistence.persist(room);
        }
      }
    }
  });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  if (!sendSocketMessage(socket, encoding.toUint8Array(encoder))) return;

  for (const payload of pendingMessages) {
    if (socket.readyState !== socket.OPEN) break;
    safelyHandleMessage(room, socket, payload);
  }
  pendingMessages.length = 0;
  pendingMessageBytes = 0;
});

function waitForShutdownRetry(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, shutdownPersistRetryMs * (2 ** attempt));
  });
}

async function persistRoomsForShutdown() {
  for (let attempt = 0; attempt < maximumShutdownPersistAttempts; attempt += 1) {
    const dirtyRooms = Array.from(documents.values()).filter((room) => room.dirty && !room.persistenceRetired);
    if (dirtyRooms.length === 0) return true;
    await Promise.all(dirtyRooms.map((room) => roomPersistence.persist(room)));
    const hasDirtyRooms = Array.from(documents.values()).some((room) => room.dirty && !room.persistenceRetired);
    if (!hasDirtyRooms) return true;
    if (attempt + 1 < maximumShutdownPersistAttempts) {
      await waitForShutdownRetry(attempt);
    }
  }
  return false;
}

async function performShutdown() {
  shuttingDown = true;
  server.close();
  webSocketServer.close();
  for (const room of documents.values()) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    cancelShadowRelease(room);
    for (const socket of room.sockets) {
      socket.close(1001, "Server shutting down");
    }
  }
  const persisted = await persistRoomsForShutdown();
  redisPublisher.disconnect();
  redisSubscriber.disconnect();
  await prisma.$disconnect();
  process.exit(persisted ? 0 : 1);
}

function shutdown() {
  if (!shutdownPromise) shutdownPromise = performShutdown();
  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

server.listen(port, host, () => {
  console.log(`Slate sync listening on ws://${host}:${port}`);
});
