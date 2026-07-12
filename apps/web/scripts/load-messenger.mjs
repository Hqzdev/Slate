import { randomUUID } from "node:crypto";

const baseUrl = required("MESSENGER_LOAD_BASE_URL").replace(/\/$/u, "");
const workspaceId = required("MESSENGER_LOAD_WORKSPACE_ID");
const conversationId = required("MESSENGER_LOAD_CONVERSATION_ID");
const cookies = readCookies(required("MESSENGER_LOAD_SESSION_COOKIES"));
const forecastConcurrency = integer(process.env.MESSENGER_LOAD_FORECAST_CONCURRENCY ?? "10", 1, 5_000);
const concurrency = forecastConcurrency * 2;
const durationMs = integer(process.env.MESSENGER_LOAD_DURATION_SECONDS ?? "30", 5, 3_600) * 1_000;
const maximumP95Ms = integer(process.env.MESSENGER_LOAD_MAXIMUM_P95_MS ?? "750", 50, 60_000);
const allowWrites = process.env.MESSENGER_LOAD_ALLOW_WRITES === "true";
const deadline = Date.now() + durationMs;
const latencies = [];
let failures = 0;
let requests = 0;

await Promise.all(Array.from({ length: concurrency }, (_, index) => runVirtualUser(index)));

latencies.sort((left, right) => left - right);
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0;
const failureRate = requests === 0 ? 1 : failures / requests;
const result = { concurrency, failureRate, failures, forecastConcurrency, p95, requests };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (failureRate > 0.01 || p95 > maximumP95Ms) process.exitCode = 1;

async function runVirtualUser(index) {
  const cookie = cookies[index % cookies.length];
  while (Date.now() < deadline) {
    await measured(`/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/unread`, { cookie });
    await measured(`/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`, { cookie });
    if (allowWrites) {
      await measured(`/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/conversations/${encodeURIComponent(conversationId)}/messages`, {
        body: JSON.stringify({ body: `Load verification ${index}`, clientRequestId: randomUUID() }),
        cookie,
        method: "POST"
      });
    }
  }
}

async function measured(path, input) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      body: input.body,
      headers: {
        accept: "application/json",
        cookie: input.cookie,
        origin: baseUrl,
        ...(input.body ? { "content-type": "application/json" } : {})
      },
      method: input.method ?? "GET"
    });
    if (!response.ok) failures += 1;
    await response.arrayBuffer();
  } catch {
    failures += 1;
  } finally {
    requests += 1;
    latencies.push(performance.now() - startedAt);
  }
}

function readCookies(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || !item)) throw new Error("MESSENGER_LOAD_SESSION_COOKIES must be a non-empty JSON string array");
  return parsed;
}

function integer(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("Messenger load configuration is invalid");
  return parsed;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
