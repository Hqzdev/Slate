import { Worker } from "bullmq";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://slate:slate@127.0.0.1:5432/slate?schema=public";
const runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS ?? 5000);
const runOutputLimit = Number(process.env.RUN_OUTPUT_LIMIT ?? 20000);
const nodeContainerImage = process.env.NODE_CONTAINER_IMAGE ?? "node:22-alpine";
const nodeContainerMemory = process.env.NODE_CONTAINER_MEMORY ?? "128m";
const nodeContainerCpus = process.env.NODE_CONTAINER_CPUS ?? "0.5";
const pool = new pg.Pool({ connectionString: databaseUrl });

async function markRun(runId, status, output, error = null) {
  await pool.query(
    'update "JobRun" set status = $1::"JobStatus", output = $2, error = $3, "updatedAt" = now() where id = $4',
    [status, output, error, runId]
  );
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
    let outputTruncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void options.onTimeout?.();
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const nextOutput = stdout + chunk.toString();
      stdout = nextOutput.slice(0, runOutputLimit);
      outputTruncated = outputTruncated || nextOutput.length > runOutputLimit;
    });
    child.stderr.on("data", (chunk) => {
      const nextOutput = stderr + chunk.toString();
      stderr = nextOutput.slice(0, runOutputLimit);
      outputTruncated = outputTruncated || nextOutput.length > runOutputLimit;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, outputTruncated, stderr: error.message, stdout, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, outputTruncated, stderr, stdout, timedOut });
    });
  });
}

function safeFileName(value) {
  const fileName = typeof value === "string" && value.trim() ? value.trim() : "main.js";
  const normalized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs") ? normalized : `${normalized}.js`;
}

function formatRunOutput({ command, duration, environmentId, result }) {
  return [
    command,
    `environment=${environmentId}`,
    `duration=${duration}`,
    `exitCode=${result.timedOut ? "timeout" : result.code}`,
    result.outputTruncated ? `output=truncated:${runOutputLimit}` : null,
    result.stdout.trim(),
    result.stderr.trim()
  ].filter(Boolean).join("\n");
}

async function runNodeSyntaxCheck(jobData) {
  const startedAt = Date.now();
  const source = typeof jobData.source === "string" ? jobData.source : "";
  const fileName = typeof jobData.fileName === "string" && jobData.fileName.trim() ? jobData.fileName.trim() : "document.js";
  const workDir = join(tmpdir(), "slate-runs");
  const filePath = join(workDir, `${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  await mkdir(workDir, { recursive: true });
  await writeFile(filePath, source, "utf8");

  try {
    const result = await runProcess(process.execPath, ["--check", filePath], runTimeoutMs);
    const lines = [
      `$ node --check ${fileName}`,
      `environment=node-syntax-check`,
      `duration=${formatDuration(startedAt)}`,
      `exitCode=${result.timedOut ? "timeout" : result.code}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean);
    return {
      error: result.timedOut ? "Run timed out" : result.code === 0 ? null : "Syntax check failed",
      output: lines.join("\n"),
      status: result.timedOut || result.code !== 0 ? "failed" : "completed"
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
      onTimeout: async () => {
        await runProcess("docker", ["kill", containerName], 2000);
      }
    });
    const output = formatRunOutput({
      command: `$ docker run ${nodeContainerImage} node ${fileName}`,
      duration: formatDuration(startedAt),
      environmentId: "node-container",
      result
    });
    return {
      error: result.timedOut ? "Run timed out" : result.code === 0 ? null : "Container run failed",
      output,
      status: result.timedOut || result.code !== 0 ? "failed" : "completed"
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
    status: "completed"
  };
}

async function executeRun(jobData) {
  if (jobData.environmentId === "node-container") return runNodeContainer(jobData);
  if (jobData.environmentId === "node-syntax-check") return runNodeSyntaxCheck(jobData);
  return runDryRun(jobData);
}

const worker = new Worker(
  "slate-runs",
  async (job) => {
    const runId = job.data.runId;
    await markRun(runId, "running", "Executor received the job.");
    const result = await executeRun(job.data);
    await markRun(runId, result.status, result.output, result.error);
    if (result.status === "completed" || result.status === "failed") {
      await recordRunActivity(runId, result.status, result.error);
    }
  },
  { connection: { url: redisUrl } }
);

worker.on("failed", async (job, error) => {
  if (!job?.data?.runId) return;
  await markRun(job.data.runId, "failed", "", error.message);
  await recordRunActivity(job.data.runId, "failed", error.message);
});

process.on("SIGINT", async () => {
  await worker.close();
  await pool.end();
  process.exit(0);
});

console.log(`Slate execution worker listening on ${redisUrl}`);
