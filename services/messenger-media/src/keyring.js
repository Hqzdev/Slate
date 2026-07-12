import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class MessengerKeyring {
  constructor(environment = process.env) {
    this.keys = readKeys(environment);
  }

  encryptExtract(job, extract) {
    const dataKey = this.unwrapDataKey(job);
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
      cipher.setAAD(Buffer.from(`slate:messenger:ai-extract:v1:${job.workspaceId}:${job.invocationId}:${job.attachmentId}:${job.keyVersion}`, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(extract, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return { ciphertext, keyVersion: job.keyVersion, nonce };
    } finally {
      dataKey.fill(0);
    }
  }

  unwrapDataKey(job) {
    if (job.keyAlgorithm !== "aes-256-gcm-v1" || job.wrapNonce.length !== 12 || job.wrappedDataKey.length <= 16) throw new Error("key_envelope_invalid");
    const wrappingKey = this.keys.get(job.kmsKeyId);
    if (!wrappingKey) throw new Error("wrapping_key_unavailable");
    const tag = job.wrappedDataKey.subarray(job.wrappedDataKey.length - 16);
    const ciphertext = job.wrappedDataKey.subarray(0, job.wrappedDataKey.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, job.wrapNonce);
    decipher.setAAD(Buffer.from(`slate:messenger:key-envelope:v1:${job.workspaceId}:${job.keyVersion}:${job.kmsKeyId}`, "utf8"));
    decipher.setAuthTag(tag);
    const dataKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (dataKey.length !== 32) throw new Error("data_key_invalid");
    return dataKey;
  }
}

function readKeys(environment) {
  const activeKeyId = environment.MESSENGER_KEY_ID?.trim() || "local-development-v1";
  const keys = new Map();
  if (environment.MESSENGER_KEY_ENCRYPTION_KEYS) {
    const parsed = JSON.parse(environment.MESSENGER_KEY_ENCRYPTION_KEYS);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MESSENGER_KEY_ENCRYPTION_KEYS is invalid");
    for (const [keyId, value] of Object.entries(parsed)) keys.set(keyId, decodeKey(value));
  }
  if (environment.MESSENGER_KEY_ENCRYPTION_KEY) keys.set(activeKeyId, decodeKey(environment.MESSENGER_KEY_ENCRYPTION_KEY));
  if (keys.size === 0 && environment.NODE_ENV !== "production") {
    keys.set(activeKeyId, createHash("sha256").update("slate-local-messenger-wrapping-key-v1", "utf8").digest());
  }
  if (keys.size === 0) throw new Error("Messenger wrapping keys are required");
  return keys;
}

function decodeKey(value) {
  if (typeof value !== "string") throw new Error("Messenger wrapping key is invalid");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Messenger wrapping key is invalid");
  return key;
}
