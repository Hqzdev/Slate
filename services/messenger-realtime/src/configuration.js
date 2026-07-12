import { readFileSync } from "node:fs";

const sharedKeys = new Set([
  "DATABASE_URL",
  "MESSENGER_REALTIME_ALLOWED_ORIGINS",
  "MESSENGER_REALTIME_GRANT_ACTIVE_KID",
  "MESSENGER_REALTIME_GRANT_KEYS",
  "REDIS_URL"
]);

export function loadEnvironment() {
  loadEnvFile(new URL("../.env", import.meta.url));
  loadEnvFile(new URL("../../../apps/web/.env", import.meta.url), sharedKeys);
}

export function readConfiguration(environment = process.env) {
  const port = parseInteger(environment.PORT ?? "1236", 1, 65_535, "PORT");
  const allowedOrigins = new Set((environment.MESSENGER_REALTIME_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean));
  if (allowedOrigins.size === 0) throw new Error("MESSENGER_REALTIME_ALLOWED_ORIGINS is required");
  return {
    allowedOrigins,
    databaseUrl: requireValue(environment.DATABASE_URL, "DATABASE_URL"),
    grantActiveKid: environment.MESSENGER_REALTIME_GRANT_ACTIVE_KID ?? null,
    grantKeys: environment.MESSENGER_REALTIME_GRANT_KEYS ?? null,
    host: environment.HOST ?? "127.0.0.1",
    leaseBatchSize: parseInteger(environment.MESSENGER_OUTBOX_BATCH_SIZE ?? "100", 1, 500, "MESSENGER_OUTBOX_BATCH_SIZE"),
    leaseDurationMs: parseInteger(environment.MESSENGER_OUTBOX_LEASE_MS ?? "30000", 5_000, 300_000, "MESSENGER_OUTBOX_LEASE_MS"),
    pollIntervalMs: parseInteger(environment.MESSENGER_OUTBOX_POLL_MS ?? "250", 25, 10_000, "MESSENGER_OUTBOX_POLL_MS"),
    port,
    redisUrl: environment.REDIS_URL ?? "redis://127.0.0.1:6379"
  };
}

function loadEnvFile(url, allowedKeys = null) {
  try {
    const content = readFileSync(url, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if ((!allowedKeys || allowedKeys.has(key)) && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {}
}

function normalizeOrigin(value) {
  if (!value) return "";
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MESSENGER_REALTIME_ALLOWED_ORIGINS contains an invalid origin");
  }
  return url.origin;
}

function parseInteger(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`);
  return parsed;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
