import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { MessengerDomainError } from "./errors";

const keyLength = 32;
const nonceLength = 12;
const authenticationTagLength = 16;
const keyAlgorithm = "aes-256-gcm-v1";
const payloadEncoding = "server_aead_v1";
const keyIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export type PreparedMessengerKeyEnvelope = {
  algorithm: string;
  kmsKeyId: string;
  version: number;
  wrapNonce: Buffer;
  wrappedDataKey: Buffer;
};

export type StoredMessengerKeyEnvelope = PreparedMessengerKeyEnvelope & {
  workspaceId: string;
};

export type EncryptedMessengerBody = {
  bodyCiphertext: Buffer;
  bodyEncoding: "server_aead_v1";
  bodyKeyVersion: number;
  bodyNonce: Buffer;
};

export type MessengerRequestFingerprintInput = {
  attachmentIds?: string[];
  aiAttachmentIds?: string[];
  authorUserId: string;
  body: string;
  conversationId: string;
  workspaceId: string;
};

export type MessengerKeyProvider = {
  createRequestFingerprint(input: MessengerRequestFingerprintInput): string;
  prepareWorkspaceKey(workspaceId: string, version: number): PreparedMessengerKeyEnvelope;
  unwrapWorkspaceKey(envelope: StoredMessengerKeyEnvelope): Buffer;
};

type AesMessengerKeyProviderOptions = {
  activeKeyId: string;
  fingerprintKey: Buffer;
  keys: Record<string, Buffer>;
  randomBytesFactory?: (size: number) => Buffer;
};

export class AesMessengerKeyProvider implements MessengerKeyProvider {
  private readonly keys = new Map<string, Buffer>();
  private readonly randomBytesFactory: (size: number) => Buffer;

  constructor(private readonly options: AesMessengerKeyProviderOptions) {
    if (!keyIdPattern.test(options.activeKeyId) || options.fingerprintKey.length !== keyLength) {
      throw new MessengerDomainError("messenger_key_configuration_invalid", "Messenger key configuration is invalid", 503);
    }
    for (const [keyId, key] of Object.entries(options.keys)) {
      if (!keyIdPattern.test(keyId) || key.length !== keyLength) {
        throw new MessengerDomainError("messenger_key_configuration_invalid", "Messenger key configuration is invalid", 503);
      }
      this.keys.set(keyId, Buffer.from(key));
    }
    if (!this.keys.has(options.activeKeyId)) {
      throw new MessengerDomainError("messenger_key_configuration_invalid", "Active Messenger wrapping key is missing", 503);
    }
    this.randomBytesFactory = options.randomBytesFactory ?? randomBytes;
  }

  prepareWorkspaceKey(workspaceId: string, version: number): PreparedMessengerKeyEnvelope {
    if (!workspaceId || version < 1) {
      throw new MessengerDomainError("messenger_key_request_invalid", "Messenger key request is invalid", 503);
    }
    const dataKey = this.randomBytesFactory(keyLength);
    const wrapNonce = this.randomBytesFactory(nonceLength);
    const wrappingKey = this.requireWrappingKey(this.options.activeKeyId);
    const cipher = createCipheriv("aes-256-gcm", wrappingKey, wrapNonce);
    cipher.setAAD(this.keyAssociatedData(workspaceId, version, this.options.activeKeyId));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const wrappedDataKey = Buffer.concat([ciphertext, cipher.getAuthTag()]);
    dataKey.fill(0);
    return {
      algorithm: keyAlgorithm,
      kmsKeyId: this.options.activeKeyId,
      version,
      wrapNonce,
      wrappedDataKey
    };
  }

  unwrapWorkspaceKey(envelope: StoredMessengerKeyEnvelope): Buffer {
    if (envelope.algorithm !== keyAlgorithm || envelope.wrapNonce.length !== nonceLength || envelope.wrappedDataKey.length <= authenticationTagLength) {
      throw new MessengerDomainError("messenger_key_envelope_invalid", "Messenger key envelope is invalid", 503);
    }
    const wrappingKey = this.requireWrappingKey(envelope.kmsKeyId);
    const authenticationTag = envelope.wrappedDataKey.subarray(envelope.wrappedDataKey.length - authenticationTagLength);
    const ciphertext = envelope.wrappedDataKey.subarray(0, envelope.wrappedDataKey.length - authenticationTagLength);
    try {
      const decipher = createDecipheriv("aes-256-gcm", wrappingKey, envelope.wrapNonce);
      decipher.setAAD(this.keyAssociatedData(envelope.workspaceId, envelope.version, envelope.kmsKeyId));
      decipher.setAuthTag(authenticationTag);
      const dataKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (dataKey.length !== keyLength) {
        throw new Error("Invalid data key length");
      }
      return dataKey;
    } catch {
      throw new MessengerDomainError("messenger_key_unwrap_failed", "Messenger key could not be unwrapped", 503);
    }
  }

  createRequestFingerprint(input: MessengerRequestFingerprintInput) {
    const hmac = createHmac("sha256", this.options.fingerprintKey)
      .update("slate:messenger:request:v1\0", "utf8");
    for (const value of [input.workspaceId, input.conversationId, input.authorUserId, input.body, ...(input.attachmentIds ?? []), ...(input.aiAttachmentIds ?? [])]) {
      hmac.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8").update(value, "utf8");
    }
    return hmac.digest("base64url");
  }

  private requireWrappingKey(keyId: string) {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new MessengerDomainError("messenger_key_unavailable", "Messenger wrapping key is unavailable", 503);
    }
    return key;
  }

  private keyAssociatedData(workspaceId: string, version: number, keyId: string) {
    return Buffer.from(`slate:messenger:key-envelope:v1:${workspaceId}:${version}:${keyId}`, "utf8");
  }
}

export class EnvironmentMessengerKeyProvider implements MessengerKeyProvider {
  private provider: AesMessengerKeyProvider | null = null;

  createRequestFingerprint(input: MessengerRequestFingerprintInput) {
    return this.getProvider().createRequestFingerprint(input);
  }

  prepareWorkspaceKey(workspaceId: string, version: number) {
    return this.getProvider().prepareWorkspaceKey(workspaceId, version);
  }

  unwrapWorkspaceKey(envelope: StoredMessengerKeyEnvelope) {
    return this.getProvider().unwrapWorkspaceKey(envelope);
  }

  private getProvider() {
    if (!this.provider) this.provider = this.createProvider();
    return this.provider;
  }

  private createProvider() {
    const configuredKeyId = process.env.MESSENGER_KEY_ID?.trim();
    const configuredWrappingKey = process.env.MESSENGER_KEY_ENCRYPTION_KEY?.trim();
    const configuredWrappingKeys = process.env.MESSENGER_KEY_ENCRYPTION_KEYS?.trim();
    const configuredFingerprintKey = process.env.MESSENGER_FINGERPRINT_KEY?.trim();
    if (
      process.env.NODE_ENV === "production"
      && (!configuredKeyId || (!configuredWrappingKey && !configuredWrappingKeys) || !configuredFingerprintKey)
    ) {
      throw new MessengerDomainError("messenger_key_configuration_missing", "Messenger production keys are not configured", 503);
    }
    const activeKeyId = configuredKeyId || "local-development-v1";
    const keys = configuredWrappingKeys
      ? this.decodeConfiguredKeyring(configuredWrappingKeys)
      : Object.create(null) as Record<string, Buffer>;
    if (configuredWrappingKey) keys[activeKeyId] = this.decodeConfiguredKey(configuredWrappingKey);
    if (Object.keys(keys).length === 0) {
      keys[activeKeyId] = createHash("sha256").update("slate-local-messenger-wrapping-key-v1", "utf8").digest();
    }
    const fingerprintKey = configuredFingerprintKey
      ? this.decodeConfiguredKey(configuredFingerprintKey)
      : createHash("sha256").update("slate-local-messenger-fingerprint-key-v1", "utf8").digest();
    return new AesMessengerKeyProvider({
      activeKeyId,
      fingerprintKey,
      keys
    });
  }

  private decodeConfiguredKeyring(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid keyring");
      const keys = Object.create(null) as Record<string, Buffer>;
      for (const [keyId, encodedKey] of Object.entries(parsed)) {
        if (!keyIdPattern.test(keyId) || typeof encodedKey !== "string") throw new Error("Invalid keyring entry");
        keys[keyId] = this.decodeConfiguredKey(encodedKey);
      }
      return keys;
    } catch (error) {
      if (error instanceof MessengerDomainError) throw error;
      throw new MessengerDomainError("messenger_key_configuration_invalid", "Messenger keyring configuration is invalid", 503);
    }
  }

  private decodeConfiguredKey(value: string) {
    const key = Buffer.from(value, "base64");
    if (key.length !== keyLength || key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) {
      throw new MessengerDomainError("messenger_key_configuration_invalid", "Messenger keys must be 32-byte base64 values", 503);
    }
    return key;
  }
}

export class MessengerPayloadCodec {
  constructor(
    private readonly keyProvider: MessengerKeyProvider = new EnvironmentMessengerKeyProvider(),
    private readonly randomBytesFactory: (size: number) => Buffer = randomBytes
  ) {}

  prepareWorkspaceKey(workspaceId: string, version: number) {
    return this.keyProvider.prepareWorkspaceKey(workspaceId, version);
  }

  unwrapWorkspaceKey(envelope: StoredMessengerKeyEnvelope) {
    return this.keyProvider.unwrapWorkspaceKey(envelope);
  }

  createRequestFingerprint(input: MessengerRequestFingerprintInput) {
    return this.keyProvider.createRequestFingerprint(input);
  }

  encryptBody(input: {
    body: string;
    conversationId: string;
    dataKey: Buffer;
    keyVersion: number;
    messageId: string;
    workspaceId: string;
  }): EncryptedMessengerBody {
    this.requireDataKey(input.dataKey);
    const bodyNonce = this.randomBytesFactory(nonceLength);
    const cipher = createCipheriv("aes-256-gcm", input.dataKey, bodyNonce);
    cipher.setAAD(this.payloadAssociatedData(input));
    const ciphertext = Buffer.concat([cipher.update(input.body, "utf8"), cipher.final()]);
    return {
      bodyCiphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]),
      bodyEncoding: payloadEncoding,
      bodyKeyVersion: input.keyVersion,
      bodyNonce
    };
  }

  decryptBody(input: {
    bodyCiphertext: Buffer;
    bodyEncoding: string;
    bodyNonce: Buffer;
    conversationId: string;
    dataKey: Buffer;
    keyVersion: number;
    messageId: string;
    workspaceId: string;
  }) {
    this.requireDataKey(input.dataKey);
    if (input.bodyEncoding !== payloadEncoding || input.bodyNonce.length !== nonceLength || input.bodyCiphertext.length <= authenticationTagLength) {
      throw new MessengerDomainError("message_envelope_invalid", "Encrypted message envelope is invalid", 503);
    }
    const authenticationTag = input.bodyCiphertext.subarray(input.bodyCiphertext.length - authenticationTagLength);
    const ciphertext = input.bodyCiphertext.subarray(0, input.bodyCiphertext.length - authenticationTagLength);
    try {
      const decipher = createDecipheriv("aes-256-gcm", input.dataKey, input.bodyNonce);
      decipher.setAAD(this.payloadAssociatedData(input));
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new MessengerDomainError("message_decryption_failed", "Message could not be decrypted", 503);
    }
  }

  encryptAttachmentFileName(input: {
    attachmentId: string;
    conversationId: string;
    dataKey: Buffer;
    fileName: string;
    keyVersion: number;
    workspaceId: string;
  }) {
    this.requireDataKey(input.dataKey);
    const nonce = this.randomBytesFactory(nonceLength);
    const cipher = createCipheriv("aes-256-gcm", input.dataKey, nonce);
    cipher.setAAD(this.attachmentFileNameAssociatedData(input));
    const ciphertext = Buffer.concat([cipher.update(input.fileName, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext, keyVersion: input.keyVersion, nonce };
  }

  decryptAttachmentFileName(input: {
    attachmentId: string;
    ciphertext: Buffer;
    conversationId: string;
    dataKey: Buffer;
    keyVersion: number;
    nonce: Buffer;
    workspaceId: string;
  }) {
    this.requireDataKey(input.dataKey);
    if (input.nonce.length !== nonceLength || input.ciphertext.length <= authenticationTagLength) {
      throw new MessengerDomainError("attachment_envelope_invalid", "Encrypted attachment metadata is invalid", 503);
    }
    const tag = input.ciphertext.subarray(input.ciphertext.length - authenticationTagLength);
    const ciphertext = input.ciphertext.subarray(0, input.ciphertext.length - authenticationTagLength);
    try {
      const decipher = createDecipheriv("aes-256-gcm", input.dataKey, input.nonce);
      decipher.setAAD(this.attachmentFileNameAssociatedData(input));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new MessengerDomainError("attachment_decryption_failed", "Attachment metadata could not be decrypted", 503);
    }
  }

  encryptAiExtract(input: {
    attachmentId: string;
    dataKey: Buffer;
    extract: string;
    invocationId: string;
    keyVersion: number;
    workspaceId: string;
  }) {
    this.requireDataKey(input.dataKey);
    const nonce = this.randomBytesFactory(nonceLength);
    const cipher = createCipheriv("aes-256-gcm", input.dataKey, nonce);
    cipher.setAAD(this.aiExtractAssociatedData(input));
    const ciphertext = Buffer.concat([cipher.update(input.extract, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext, keyVersion: input.keyVersion, nonce };
  }

  decryptAiExtract(input: {
    attachmentId: string;
    ciphertext: Buffer;
    dataKey: Buffer;
    invocationId: string;
    keyVersion: number;
    nonce: Buffer;
    workspaceId: string;
  }) {
    this.requireDataKey(input.dataKey);
    if (input.nonce.length !== nonceLength || input.ciphertext.length <= authenticationTagLength) {
      throw new MessengerDomainError("ai_extract_envelope_invalid", "AI attachment extract is invalid", 503);
    }
    const tag = input.ciphertext.subarray(input.ciphertext.length - authenticationTagLength);
    const ciphertext = input.ciphertext.subarray(0, input.ciphertext.length - authenticationTagLength);
    try {
      const decipher = createDecipheriv("aes-256-gcm", input.dataKey, input.nonce);
      decipher.setAAD(this.aiExtractAssociatedData(input));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new MessengerDomainError("ai_extract_decryption_failed", "AI attachment extract could not be decrypted", 503);
    }
  }

  private payloadAssociatedData(input: {
    conversationId: string;
    keyVersion: number;
    messageId: string;
    workspaceId: string;
  }) {
    return Buffer.from(
      `slate:messenger:payload:v1:${input.workspaceId}:${input.conversationId}:${input.messageId}:body:${payloadEncoding}:${input.keyVersion}`,
      "utf8"
    );
  }

  private attachmentFileNameAssociatedData(input: {
    attachmentId: string;
    conversationId: string;
    keyVersion: number;
    workspaceId: string;
  }) {
    return Buffer.from(
      `slate:messenger:attachment:v1:${input.workspaceId}:${input.conversationId}:${input.attachmentId}:filename:${payloadEncoding}:${input.keyVersion}`,
      "utf8"
    );
  }

  private aiExtractAssociatedData(input: {
    attachmentId: string;
    invocationId: string;
    keyVersion: number;
    workspaceId: string;
  }) {
    return Buffer.from(
      `slate:messenger:ai-extract:v1:${input.workspaceId}:${input.invocationId}:${input.attachmentId}:${input.keyVersion}`,
      "utf8"
    );
  }

  private requireDataKey(dataKey: Buffer) {
    if (dataKey.length !== keyLength) {
      throw new MessengerDomainError("messenger_data_key_invalid", "Messenger data key is invalid", 503);
    }
  }
}

export const messengerPayloadCodec = new MessengerPayloadCodec();
