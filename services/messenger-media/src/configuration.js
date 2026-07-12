import { readFileSync } from "node:fs";

const sharedKeys = new Set([
  "DATABASE_URL",
  "MESSENGER_STORAGE_ACCESS_KEY_ID",
  "MESSENGER_STORAGE_BUCKET",
  "MESSENGER_STORAGE_ENDPOINT",
  "MESSENGER_STORAGE_FORCE_PATH_STYLE",
  "MESSENGER_KEY_ENCRYPTION_KEY",
  "MESSENGER_KEY_ENCRYPTION_KEYS",
  "MESSENGER_KEY_ID",
  "MESSENGER_STORAGE_REGION",
  "MESSENGER_STORAGE_SECRET_ACCESS_KEY"
]);

export function loadEnvironment() {
  loadEnvFile(new URL("../.env", import.meta.url));
  loadEnvFile(new URL("../../../apps/web/.env", import.meta.url), sharedKeys);
}

export function readConfiguration(environment = process.env) {
  return {
    clamavHost: environment.CLAMAV_HOST ?? "127.0.0.1",
    clamavPort: integer(environment.CLAMAV_PORT ?? "3310", 1, 65_535, "CLAMAV_PORT"),
    databaseUrl: required(environment.DATABASE_URL, "DATABASE_URL"),
    host: environment.HOST ?? "127.0.0.1",
    leaseBatchSize: integer(environment.MESSENGER_MEDIA_BATCH_SIZE ?? "4", 1, 20, "MESSENGER_MEDIA_BATCH_SIZE"),
    leaseDurationMs: integer(environment.MESSENGER_MEDIA_LEASE_MS ?? "300000", 30_000, 900_000, "MESSENGER_MEDIA_LEASE_MS"),
    extractionLeaseDurationMs: integer(environment.MESSENGER_AI_EXTRACTION_LEASE_MS ?? "120000", 30_000, 900_000, "MESSENGER_AI_EXTRACTION_LEASE_MS"),
    pollIntervalMs: integer(environment.MESSENGER_MEDIA_POLL_MS ?? "500", 50, 10_000, "MESSENGER_MEDIA_POLL_MS"),
    port: integer(environment.PORT ?? "1237", 1, 65_535, "PORT"),
    storage: {
      accessKeyId: required(environment.MESSENGER_STORAGE_ACCESS_KEY_ID, "MESSENGER_STORAGE_ACCESS_KEY_ID"),
      bucket: required(environment.MESSENGER_STORAGE_BUCKET, "MESSENGER_STORAGE_BUCKET"),
      endpoint: required(environment.MESSENGER_STORAGE_ENDPOINT, "MESSENGER_STORAGE_ENDPOINT"),
      forcePathStyle: environment.MESSENGER_STORAGE_FORCE_PATH_STYLE !== "false",
      region: environment.MESSENGER_STORAGE_REGION ?? "us-east-1",
      secretAccessKey: required(environment.MESSENGER_STORAGE_SECRET_ACCESS_KEY, "MESSENGER_STORAGE_SECRET_ACCESS_KEY")
    },
    temporaryDirectory: environment.MESSENGER_MEDIA_TMP_DIR ?? "/tmp/slate-messenger-media"
  };
}

function loadEnvFile(url, allowedKeys = null) {
  try {
    const content = readFileSync(url, "utf8");
    for (const line of content.split(/\r?\n/u)) {
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

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`);
  return parsed;
}
