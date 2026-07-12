import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import Redis from "ioredis";
import pg from "pg";
import { WebSocketServer } from "ws";
import { AccessRepository } from "./accessRepository.js";
import { readConfiguration, loadEnvironment } from "./configuration.js";
import { ConnectionRegistry } from "./connectionRegistry.js";
import { parseEnvelope } from "./eventContract.js";
import { GrantVerifier } from "./grantVerifier.js";
import { OutboxLeaseRepository } from "./outboxLeaseRepository.js";
import { OutboxPublisher } from "./outboxPublisher.js";

loadEnvironment();

const configuration = readConfiguration();
const pool = new pg.Pool({ connectionString: configuration.databaseUrl, max: 10 });
const publisherRedis = new Redis(configuration.redisUrl, { maxRetriesPerRequest: null });
const subscriberRedis = new Redis(configuration.redisUrl, { maxRetriesPerRequest: null });
const accessRepository = new AccessRepository(pool);
const grantVerifier = new GrantVerifier(configuration);
const registry = new ConnectionRegistry(accessRepository);
const leaseRepository = new OutboxLeaseRepository(pool, {
  batchSize: configuration.leaseBatchSize,
  leaseDurationMs: configuration.leaseDurationMs,
  owner: `${process.pid}-${randomUUID()}`
});
const outboxPublisher = new OutboxPublisher(leaseRepository, publisherRedis, {
  pollIntervalMs: configuration.pollIntervalMs
});
const httpServer = createServer((request, response) => void handleHttpRequest(request, response));
const websocketServer = new WebSocketServer({ maxPayload: 16_384, noServer: true, perMessageDeflate: false });
let shuttingDown = false;

publisherRedis.on("error", () => {});
subscriberRedis.on("error", () => {});
pool.on("error", () => {});

httpServer.on("upgrade", (request, socket, head) => {
  void handleUpgrade(request, socket, head);
});

subscriberRedis.on("pmessage", (_pattern, _channel, message) => {
  try {
    const envelope = parseEnvelope(JSON.parse(message));
    if (envelope) void registry.dispatch(envelope);
  } catch {}
});

await subscriberRedis.psubscribe("slate:messenger:workspace:*");
outboxPublisher.start();
httpServer.listen(configuration.port, configuration.host, () => {
  console.log(`Slate Messenger realtime listening on ws://${configuration.host}:${configuration.port}/messenger`);
});

const heartbeat = setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);

async function handleUpgrade(request, socket, head) {
  try {
    if (shuttingDown || !validOrigin(request.headers.origin)) return rejectUpgrade(socket, 403);
    const url = new URL(request.url ?? "", "http://messenger.local");
    if (url.pathname !== "/messenger") return rejectUpgrade(socket, 404);
    const grant = url.searchParams.get("grant");
    if (!grant || url.searchParams.size !== 1) return rejectUpgrade(socket, 401);
    const claims = grantVerifier.verify(grant);
    if (!claims) return rejectUpgrade(socket, 401);
    const access = await accessRepository.authorize(claims);
    if (!access) return rejectUpgrade(socket, 403);
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      initializeSession(websocket, claims, access.conversationIds);
    });
  } catch {
    rejectUpgrade(socket, 503);
  }
}

function initializeSession(socket, claims, conversationIds) {
  const session = { claims, conversationIds, socket };
  socket.isAlive = true;
  registry.add(session);
  const expirationDelay = Math.max(1, claims.exp * 1_000 - Date.now());
  const expirationTimer = setTimeout(() => socket.close(4001, "Messenger grant expired"), expirationDelay);
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", () => socket.close(1008, "Messenger socket is server-only"));
  socket.once("close", () => {
    clearTimeout(expirationTimer);
    registry.remove(session);
  });
  socket.once("error", () => {});
  socket.send(JSON.stringify({ expiresAt: new Date(claims.exp * 1_000).toISOString(), type: "ready", v: 1 }));
}

async function handleHttpRequest(request, response) {
  if (request.method === "GET" && request.url === "/health/live") {
    response.writeHead(shuttingDown ? 503 : 200, { "cache-control": "no-store", "content-type": "application/json" });
    response.end(JSON.stringify({ status: shuttingDown ? "stopping" : "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/health/ready") {
    try {
      await Promise.all([pool.query("SELECT 1"), publisherRedis.ping(), subscriberRedis.ping()]);
      response.writeHead(shuttingDown ? 503 : 200, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ database: "ready", redis: "ready", status: shuttingDown ? "stopping" : "ready" }));
    } catch {
      response.writeHead(503, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unavailable" }));
    }
    return;
  }
  if (request.method === "GET" && request.url === "/metrics") {
    try {
      const backlog = await pool.query(`SELECT status, COUNT(*)::bigint AS count FROM "MessengerOutboxEvent" WHERE status IN ('pending', 'failed') GROUP BY status`);
      const counts = new Map(backlog.rows.map((row) => [row.status, row.count]));
      const metrics = [
        "# TYPE slate_messenger_realtime_connections gauge",
        `slate_messenger_realtime_connections ${websocketServer.clients.size}`,
        "# TYPE slate_messenger_outbox_events gauge",
        `slate_messenger_outbox_events{status=\"pending\"} ${counts.get("pending") ?? "0"}`,
        `slate_messenger_outbox_events{status=\"failed\"} ${counts.get("failed") ?? "0"}`,
        "# TYPE slate_messenger_realtime_process_uptime_seconds gauge",
        `slate_messenger_realtime_process_uptime_seconds ${Math.floor(process.uptime())}`
      ].join("\n");
      response.writeHead(200, { "cache-control": "no-store", "content-type": "text/plain; version=0.0.4" });
      response.end(`${metrics}\n`);
    } catch {
      response.writeHead(503, { "cache-control": "no-store" });
      response.end();
    }
    return;
  }
  response.writeHead(404, { "cache-control": "no-store" });
  response.end();
}

function validOrigin(origin) {
  try {
    return typeof origin === "string" && configuration.allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function rejectUpgrade(socket, status) {
  if (socket.destroyed) return;
  const label = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Service Unavailable";
  socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  registry.closeAll(4010, "Messenger service is restarting");
  await new Promise((resolve) => httpServer.close(resolve));
  await outboxPublisher.stop();
  await Promise.allSettled([subscriberRedis.quit(), publisherRedis.quit(), pool.end()]);
}

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
