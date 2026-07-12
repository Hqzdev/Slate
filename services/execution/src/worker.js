import { Worker } from "bullmq";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Redis from "ioredis";
import pg from "pg";
import { classifyProcessFailure, formatRunOutput, safeFileName, staleRunCutoff } from "./executionUtils.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://slate:slate@127.0.0.1:5432/slate?schema=public";
const healthHost = process.env.HEALTH_HOST ?? "127.0.0.1";
const healthPort = Number(process.env.HEALTH_PORT ?? 1235);
const runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS ?? 5000);
const runOutputLimit = Number(process.env.RUN_OUTPUT_LIMIT ?? 20000);
const staleRunMs = Number(process.env.STALE_RUN_MS ?? 10 * 60 * 1000);
const nodeContainerImage = process.env.NODE_CONTAINER_IMAGE ?? "node:22-alpine";
const nodeContainerMemory = process.env.NODE_CONTAINER_MEMORY ?? "128m";
const nodeContainerCpus = process.env.NODE_CONTAINER_CPUS ?? "0.5";
const pool = new pg.Pool({ connectionString: databaseUrl });
const redisHealthClient = new Redis(redisUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1
});

redisHealthClient.on("error", () => {});

async function markRun(runId, status, output, error = null) {
  await pool.query(
    'update "JobRun" set status = $1::"JobStatus", output = $2, error = $3, "updatedAt" = now() where id = $4 and status <> \'cancelled\'::"JobStatus"',
    [status, output, error, runId]
  );
}

async function runCancelled(runId) {
  const result = await pool.query('select status from "JobRun" where id = $1', [runId]);
  return result.rows[0]?.status === "cancelled";
}

async function recordRunActivity(runId, status, error = null) {
  const result = await pool.query('select "documentId", kind, "userId", "workspaceId" from "JobRun" where id = $1', [runId]);
  const run = result.rows[0];
  if (!run) return;
  await pool.query(
    'insert into "ActivityEvent" (id, type, metadata, "actorUserId", "workspaceId", "documentId", "createdAt") values (concat($1::text, $2::text), $3, $4::jsonb, $5, $6, $7, now()) on conflict (id) do nothing',
    [
      runId,
      status,
      status === "completed" ? "run.completed" : "run.failed",
      JSON.stringify({ environmentId: run.kind, error, runId }),
      run.userId,
      run.workspaceId,
      run.documentId
    ]
  );
  await pool.query(
    'insert into "AuditEvent" (id, type, metadata, "actorUserId", "workspaceId", "documentId", "createdAt") values (concat($1::text, $2::text, \'audit\'), $3, $4::jsonb, $5, $6, $7, now()) on conflict (id) do nothing',
    [
      runId,
      status,
      status === "completed" ? "run.completed" : "run.failed",
      JSON.stringify({ environmentId: run.kind, error, runId }),
      run.userId,
      run.workspaceId,
      run.documentId
    ]
  );
}

function formatDuration(startedAt) {
  return `${Date.now() - startedAt}ms`;
}

function runProcess(command, args, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let cancelled = false;
    let outputTruncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void options.onTimeout?.();
      child.kill("SIGKILL");
    }, timeoutMs);
    const cancellationTimer = options.shouldCancel ? setInterval(() => {
      void options.shouldCancel().then((shouldCancel) => {
        if (!shouldCancel || cancelled || timedOut) return;
        cancelled = true;
        void options.onCancelled?.();
        child.kill("SIGKILL");
      }).catch(() => undefined);
    }, 250) : null;
    const publishProgress = () => options.onOutput?.({ cancelled, code: null, outputTruncated, stderr, stdout, timedOut });

    const complete = (code) => {
      clearTimeout(timer);
      if (cancellationTimer !== null) clearInterval(cancellationTimer);
      resolve({ cancelled, code: code ?? 1, outputTruncated, stderr, stdout, timedOut });
    };

    child.stdout.on("data", (chunk) => {
      const nextOutput = stdout + chunk.toString();
      stdout = nextOutput.slice(0, runOutputLimit);
      outputTruncated = outputTruncated || nextOutput.length > runOutputLimit;
      publishProgress();
    });
    child.stderr.on("data", (chunk) => {
      const nextOutput = stderr + chunk.toString();
      stderr = nextOutput.slice(0, runOutputLimit);
      outputTruncated = outputTruncated || nextOutput.length > runOutputLimit;
      publishProgress();
    });
    child.on("error", (error) => {
      stderr = error.message;
      complete(1);
    });
    child.on("close", (code) => {
      complete(code);
    });
  });
}

async function runNodeSyntaxCheck(jobData) {
  const startedAt = Date.now();
  const runId = typeof jobData.runId === "string" ? jobData.runId : null;
  const source = typeof jobData.source === "string" ? jobData.source : "";
  const fileName = typeof jobData.fileName === "string" && jobData.fileName.trim() ? jobData.fileName.trim() : "document.js";
  const workDir = join(tmpdir(), "slate-runs");
  const filePath = join(workDir, `${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  await mkdir(workDir, { recursive: true });
  await writeFile(filePath, source, "utf8");

  try {
    let outputWrites = Promise.resolve();
    const formatOutput = (result) => [
      `$ node --check ${fileName}`,
      `environment=node-syntax-check`,
      `duration=${formatDuration(startedAt)}`,
      `exitCode=${result.cancelled ? "cancelled" : result.timedOut ? "timeout" : result.code}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n");
    const result = await runProcess(process.execPath, ["--check", filePath], runTimeoutMs, {
      onOutput: (current) => {
        if (!runId) return;
        outputWrites = outputWrites.then(() => markRun(runId, "running", formatOutput(current))).catch(() => undefined);
      },
      shouldCancel: () => runId ? runCancelled(runId) : Promise.resolve(false)
    });
    await outputWrites;
    return {
      error: classifyProcessFailure(result, "Syntax check failed"),
      output: formatOutput(result),
      status: result.cancelled ? "cancelled" : result.timedOut || result.code !== 0 ? "failed" : "completed"
    };
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

async function runNodeContainer(jobData) {
  const startedAt = Date.now();
  const source = typeof jobData.source === "string" ? jobData.source : "";
  const fileName = safeFileName(jobData.fileName);
  const runId = typeof jobData.runId === "string" ? jobData.runId : randomUUID();
  const containerName = `slate-run-${runId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
  const workDir = join(tmpdir(), "slate-runs", runId);
  const filePath = join(workDir, fileName);
  await mkdir(workDir, { recursive: true });
  await writeFile(filePath, source, "utf8");

  try {
    let outputWrites = Promise.resolve();
    const formatOutput = (result) => formatRunOutput({
      command: `$ docker run ${nodeContainerImage} node ${fileName}`,
      duration: formatDuration(startedAt),
      environmentId: "node-container",
      outputLimit: runOutputLimit,
      result
    });
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--pull",
      "never",
      "--network",
      "none",
      "--memory",
      nodeContainerMemory,
      "--cpus",
      nodeContainerCpus,
      "--pids-limit",
      "64",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--mount",
      `type=bind,source=${workDir},target=/workspace,readonly`,
      "--workdir",
      "/workspace",
      nodeContainerImage,
      "node",
      `/workspace/${fileName}`
    ];
    const result = await runProcess("docker", args, runTimeoutMs, {
      onCancelled: async () => {
        await runProcess("docker", ["kill", containerName], 2000);
      },
      onOutput: (current) => {
        outputWrites = outputWrites.then(() => markRun(runId, "running", formatOutput(current))).catch(() => undefined);
      },
      onTimeout: async () => {
        await runProcess("docker", ["kill", containerName], 2000);
      },
      shouldCancel: () => runCancelled(runId)
    });
    await outputWrites;
    const output = formatOutput(result);
    return {
      error: classifyProcessFailure(result, "Container run failed"),
      output,
      status: result.cancelled ? "cancelled" : result.timedOut || result.code !== 0 ? "failed" : "completed"
    };
  } finally {
    await rm(workDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function runDryRun(jobData) {
  const startedAt = Date.now();
  const source = typeof jobData.source === "string" ? jobData.source : "";
  const fileName = typeof jobData.fileName === "string" && jobData.fileName.trim() ? jobData.fileName.trim() : "document";
  const lineCount = source.length === 0 ? 0 : source.split(/\r?\n/).length;
  return {
    error: null,
    output: [
      `$ slate run ${fileName}`,
      `environment=dry-run`,
      `duration=${formatDuration(startedAt)}`,
      `lines=${lineCount}`,
      "Run request reached the execution worker. No user code was executed."
    ].join("\n"),
    status: await runCancelled(jobData.runId) ? "cancelled" : "completed"
  };
}

async function executeRun(jobData) {
  if (jobData.environmentId === "node-container") return runNodeContainer(jobData);
  if (jobData.environmentId === "node-syntax-check") return runNodeSyntaxCheck(jobData);
  return runDryRun(jobData);
}

async function cleanupStaleRuns() {
  const cutoff = staleRunCutoff(new Date(), staleRunMs);
  const result = await pool.query(
    'update "JobRun" set status = $1::"JobStatus", error = $2, output = $3, "updatedAt" = now() where status = $4::"JobStatus" and "updatedAt" < $5 returning id',
    ["failed", "Execution worker lost the run heartbeat", "Run marked failed after the execution worker recovered stale state.", "running", cutoff]
  );

  for (const row of result.rows) {
    await recordRunActivity(row.id, "failed", "Execution worker lost the run heartbeat");
  }
}

const worker = new Worker(
  "slate-runs",
  async (job) => {
    const runId = job.data.runId;
    if (await runCancelled(runId)) return;
    await markRun(runId, "running", "Executor received the job.");
    const result = await executeRun(job.data);
    if (result.status === "cancelled" || await runCancelled(runId)) return;
    await markRun(runId, result.status, result.output, result.error);
    if (result.status === "completed" || result.status === "failed") {
      await recordRunActivity(runId, result.status, result.error);
    }
  },
  {
    connection: { url: redisUrl },
    lockDuration: runTimeoutMs + 5000,
    maxStalledCount: 1,
    stalledInterval: 30000
  }
);

async function healthPayload() {
  const [database, redis] = await Promise.all([databaseHealth(), redisHealth()]);
  const workerReady = !worker.closing && !worker.isPaused();
  const ok = database === "connected" && redis === "connected" && workerReady;

  return {
    database,
    ok,
    redis,
    service: "execution",
    worker: workerReady ? "running" : "stopped"
  };
}

async function databaseHealth() {
  try {
    await pool.query("select 1 as ok");
    return "connected";
  } catch {
    return "error";
  }
}

async function redisHealth() {
  try {
    await redisHealthClient.ping();
    return "connected";
  } catch {
    return "error";
  }
}

const healthServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    const payload = await healthPayload();
    response.writeHead(payload.ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
    return;
  }

  response.writeHead(404);
  response.end();
});

healthServer.listen(healthPort, healthHost, () => {
  console.log(`Slate execution health listening on http://${healthHost}:${healthPort}/health`);
});

void cleanupStaleRuns().catch((error) => {
  console.error(`Stale run cleanup failed: ${error.message}`);
});

worker.on("failed", async (job, error) => {
  if (!job?.data?.runId) return;
  await markRun(job.data.runId, "failed", "", error.message);
  await recordRunActivity(job.data.runId, "failed", error.message);
});

process.on("SIGINT", async () => {
  healthServer.close();
  redisHealthClient.disconnect();
  await worker.close();
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  healthServer.close();
  redisHealthClient.disconnect();
  await worker.close();
  await pool.end();
  process.exit(0);
});

console.log(`Slate execution worker listening on ${redisUrl}`);
