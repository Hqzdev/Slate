import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import Redis from "ioredis";
import { PrismaClient } from "../generated/prisma/index.js";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

loadEnvFile(new URL("../.env", import.meta.url));
loadEnvFile(new URL("../../../apps/web/.env", import.meta.url));

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;
const port = Number(process.env.PORT ?? 1234);
const authorizeUrl = process.env.AUTHORIZE_URL ?? "http://127.0.0.1:3000/api/realtime/authorize";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const persistDebounceMs = Number(process.env.PERSIST_DEBOUNCE_MS ?? 700);
const documents = new Map();
const prisma = new PrismaClient();
const redisPublisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
const redisSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
const redisOrigin = Symbol("redis-origin");

redisPublisher.on("error", () => {});
redisSubscriber.on("error", () => {});

function loadEnvFile(url) {
  try {
    const content = readFileSync(url, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;
      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function parseRoomName(roomName) {
  const match = roomName.match(/^slate:room:([^:]+):(file|note|canvas):([^:]+)$/);
  if (!match) return null;
  return {
    documentId: match[3],
    roomType: match[2],
    workspaceId: match[1]
  };
}

function roomChannel(roomName) {
  return `slate:sync:${roomName}`;
}

async function seedDocumentFromDatabase(doc, parsedRoom) {
  if (parsedRoom.roomType !== "file" && parsedRoom.roomType !== "note") return;

  const document = await prisma.document.findUnique({
    select: { content: true },
    where: { id: parsedRoom.documentId }
  });
  const text = doc.getText(parsedRoom.roomType === "file" ? "source" : "note");
  if (document?.content && text.length === 0) {
    text.insert(0, document.content);
  }
}

async function getDocument(roomName) {
  const existing = documents.get(roomName);
  if (existing) return existing;

  const parsedRoom = parseRoomName(roomName);
  if (!parsedRoom) throw new Error("Invalid room name");

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const sockets = new Set();
  const room = {
    awareness,
    channel: roomChannel(roomName),
    dirty: false,
    documentId: parsedRoom.documentId,
    doc,
    lastPersistError: null,
    lastPersistedAt: null,
    loadedFromPersistence: false,
    persistTimer: null,
    recoveredFromFallback: false,
    roomName,
    sockets,
    updatesSincePersist: 0
  };

  const realtimeState = await prisma.documentRealtime.findUnique({
    where: { documentId: parsedRoom.documentId }
  });

  if (realtimeState) {
    try {
      Y.applyUpdate(doc, new Uint8Array(realtimeState.state), redisOrigin);
      room.loadedFromPersistence = true;
      room.lastPersistedAt = realtimeState.updatedAt;
    } catch (error) {
      room.lastPersistError = `restore failed: ${error instanceof Error ? error.message : "unknown error"}`;
      room.recoveredFromFallback = true;
      await seedDocumentFromDatabase(doc, parsedRoom);
    }
  } else {
    await seedDocumentFromDatabase(doc, parsedRoom);
  }

  doc.on("update", (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(room, encoding.toUint8Array(encoder), origin);

    if (origin !== redisOrigin) {
      room.dirty = true;
      room.updatesSincePersist += 1;
      queuePersist(room);
      void redisPublisher.publish(room.channel, Buffer.from(update).toString("base64"));
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
  return room;
}

function queuePersist(room) {
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
  }

  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void persistRoom(room);
  }, persistDebounceMs);
}

async function persistRoom(room) {
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
  }

  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  try {
    await prisma.documentRealtime.upsert({
      create: {
        documentId: room.documentId,
        roomName: room.roomName,
        state
      },
      update: {
        roomName: room.roomName,
        state
      },
      where: { documentId: room.documentId }
    });
    room.dirty = false;
    room.lastPersistError = null;
    room.lastPersistedAt = new Date();
    room.updatesSincePersist = 0;
    return true;
  } catch (error) {
    room.lastPersistError = error instanceof Error ? error.message : "unknown persist error";
    return false;
  }
}

function broadcast(room, message, origin) {
  for (const socket of room.sockets) {
    if (socket !== origin && socket.readyState === socket.OPEN) {
      socket.send(message);
    }
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
      syncProtocol.readSyncStep2(decoder, room.doc, socket);
    } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
      syncProtocol.readUpdate(decoder, room.doc, socket);
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
    socket.send(encoding.toUint8Array(encoder));
  }
}

function roomNameFromRequest(request) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const roomName = decodeURIComponent(url.pathname.slice(1));
  return roomName || "default";
}

async function authorizeConnection(request, roomName) {
  const response = await fetch(`${authorizeUrl}?room=${encodeURIComponent(roomName)}`, {
    headers: {
      cookie: request.headers.cookie ?? ""
    }
  }).catch(() => null);

  if (!response?.ok) return null;

  return response.json();
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
  for (const room of documents.values()) {
    if (room.channel === channel) {
      Y.applyUpdate(room.doc, Buffer.from(message, "base64"), redisOrigin);
      break;
    }
  }
});

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await healthPayload()));
    return;
  }

  response.writeHead(404);
  response.end();
});

const webSocketServer = new WebSocketServer({ server });

webSocketServer.on("connection", async (socket, request) => {
  const roomName = roomNameFromRequest(request);
  const pendingMessages = [];
  let room = null;

  socket.binaryType = "arraybuffer";
  socket.awarenessClients = new Set();
  socket.on("message", (payload) => {
    if (room) {
      handleMessage(room, socket, payload);
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

  room.sockets.add(socket);

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  socket.send(encoding.toUint8Array(encoder));

  for (const payload of pendingMessages) {
    handleMessage(room, socket, payload);
  }

  socket.on("close", () => {
    room.sockets.delete(socket);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(socket.awarenessClients), socket);
    if (room.sockets.size === 0 && room.dirty) {
      void persistRoom(room);
    }
  });
});

async function shutdown() {
  for (const room of documents.values()) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
  }
  await Promise.all(Array.from(documents.values()).map((room) => persistRoom(room)));
  redisPublisher.disconnect();
  redisSubscriber.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

server.listen(port, () => {
  console.log(`Slate sync listening on ws://127.0.0.1:${port}`);
});
