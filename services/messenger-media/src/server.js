import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";
import { ClamavScanner } from "./clamavScanner.js";
import { loadEnvironment, readConfiguration } from "./configuration.js";
import { ContentValidator } from "./contentValidator.js";
import { AiExtractionProcessor } from "./extractionProcessor.js";
import { AiExtractionRepository } from "./extractionRepository.js";
import { MediaJobProcessor } from "./jobProcessor.js";
import { MediaJobRepository } from "./jobRepository.js";
import { MessengerKeyring } from "./keyring.js";
import { MediaProcessor } from "./mediaProcessor.js";
import { ProcessRunner } from "./processRunner.js";
import { MediaStorage } from "./storage.js";
import { MediaWorker } from "./worker.js";

loadEnvironment();

const configuration = readConfiguration();
const pool = new pg.Pool({ connectionString: configuration.databaseUrl, max: configuration.leaseBatchSize + 2 });
const clamav = new ClamavScanner({ host: configuration.clamavHost, port: configuration.clamavPort });
const storage = new MediaStorage(configuration.storage);
const repository = new MediaJobRepository(pool, {
  batchSize: configuration.leaseBatchSize,
  leaseDurationMs: configuration.leaseDurationMs,
  owner: `${process.pid}-${randomUUID()}`
});
const processor = new MediaJobProcessor({
  clamav,
  contentValidator: new ContentValidator(),
  mediaProcessor: new MediaProcessor(new ProcessRunner()),
  repository,
  storage,
  temporaryDirectory: configuration.temporaryDirectory
});
const worker = new MediaWorker(repository, processor, { pollIntervalMs: configuration.pollIntervalMs });
const extractionRepository = new AiExtractionRepository(pool, {
  batchSize: Math.min(3, configuration.leaseBatchSize),
  leaseDurationMs: configuration.extractionLeaseDurationMs,
  owner: `${process.pid}-${randomUUID()}`
});
const extractionWorker = new MediaWorker(extractionRepository, new AiExtractionProcessor({
  clamav,
  keyring: new MessengerKeyring(),
  processRunner: new ProcessRunner(),
  repository: extractionRepository,
  storage,
  temporaryDirectory: configuration.temporaryDirectory
}), { pollIntervalMs: configuration.pollIntervalMs });
const server = createServer((request, response) => void handleHttpRequest(request, response));
async function handleHttpRequest(request, response) {
  if (request.method === "GET" && request.url === "/health/live") {
    response.writeHead(stopping ? 503 : 200, { "cache-control": "no-store", "content-type": "application/json" });
    response.end(JSON.stringify({ status: stopping ? "stopping" : "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/health/ready") {
    try {
      await Promise.all([pool.query("SELECT 1"), clamav.ping(), storage.ping()]);
      response.writeHead(stopping ? 503 : 200, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ database: "ready", scanner: "ready", status: stopping ? "stopping" : "ready", storage: "ready" }));
    } catch {
      response.writeHead(503, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unavailable" }));
    }
    return;
  }
  if (request.method === "GET" && request.url === "/metrics") {
    try {
      const [mediaJobs, extractions] = await Promise.all([
        pool.query(`SELECT status, COUNT(*)::bigint AS count FROM "MessengerMediaJob" GROUP BY status`),
        pool.query(`SELECT "extractionStatus" AS status, COUNT(*)::bigint AS count FROM "MessengerAiInvocationAttachment" GROUP BY "extractionStatus"`)
      ]);
      const mediaCounts = new Map(mediaJobs.rows.map((row) => [row.status, row.count]));
      const extractionCounts = new Map(extractions.rows.map((row) => [row.status, row.count]));
      const metrics = [
        ...["pending", "processing", "completed", "failed"].map((status) => `slate_messenger_media_jobs{status=\"${status}\"} ${mediaCounts.get(status) ?? "0"}`),
        ...["pending", "processing", "completed", "failed"].map((status) => `slate_messenger_ai_extractions{status=\"${status}\"} ${extractionCounts.get(status) ?? "0"}`),
        `slate_messenger_media_process_uptime_seconds ${Math.floor(process.uptime())}`
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
let stopping = false;

pool.on("error", (error) => {
  process.stderr.write(`${JSON.stringify({ code: "media_worker_pool_error", errorType: error.name })}\n`);
});
worker.start();
extractionWorker.start();
server.listen(configuration.port, configuration.host, () => {
  console.log(`Slate Messenger media worker health listening on http://${configuration.host}:${configuration.port}/health/live`);
});

async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve) => server.close(resolve));
  await worker.stop();
  await extractionWorker.stop();
  await pool.end();
}

process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
