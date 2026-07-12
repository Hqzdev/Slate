import assert from "node:assert/strict";
import test from "node:test";
import { AesMessengerKeyProvider, MessengerPayloadCodec } from "../lib/server/messenger/cryptography";
import { MessengerDomainError } from "../lib/server/messenger/errors";

function createCrypto() {
  let randomValue = 0;
  const provider = new AesMessengerKeyProvider({
    activeKeyId: "test-key-v1",
    fingerprintKey: Buffer.alloc(32, 9),
    keys: { "test-key-v1": Buffer.alloc(32, 7) },
    randomBytesFactory(size) {
      randomValue += 1;
      return Buffer.alloc(size, randomValue);
    }
  });
  return {
    codec: new MessengerPayloadCodec(provider, (size) => Buffer.alloc(size, 5)),
    provider
  };
}

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof MessengerDomainError);
  assert.equal(error.code, code);
  return true;
}

test("wraps workspace keys and decrypts message bodies with bound AAD", () => {
  const { codec, provider } = createCrypto();
  const prepared = provider.prepareWorkspaceKey("workspace-1", 1);
  const dataKey = provider.unwrapWorkspaceKey({ ...prepared, workspaceId: "workspace-1" });
  assert.deepEqual(dataKey, Buffer.alloc(32, 1));
  const encrypted = codec.encryptBody({
    body: "confidential message",
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  });
  const decrypted = codec.decryptBody({
    bodyCiphertext: encrypted.bodyCiphertext,
    bodyEncoding: encrypted.bodyEncoding,
    bodyNonce: encrypted.bodyNonce,
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  });
  assert.equal(decrypted, "confidential message");
  dataKey.fill(0);
});

test("rejects ciphertext tampering and cross-conversation transplantation", () => {
  const { codec, provider } = createCrypto();
  const prepared = provider.prepareWorkspaceKey("workspace-1", 1);
  const dataKey = provider.unwrapWorkspaceKey({ ...prepared, workspaceId: "workspace-1" });
  const encrypted = codec.encryptBody({
    body: "message",
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  });
  const tampered = Buffer.from(encrypted.bodyCiphertext);
  tampered[0] ^= 1;
  assert.throws(() => codec.decryptBody({
    bodyCiphertext: tampered,
    bodyEncoding: encrypted.bodyEncoding,
    bodyNonce: encrypted.bodyNonce,
    conversationId: "conversation-1",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  }), (error) => assertCode(error, "message_decryption_failed"));
  assert.throws(() => codec.decryptBody({
    bodyCiphertext: encrypted.bodyCiphertext,
    bodyEncoding: encrypted.bodyEncoding,
    bodyNonce: encrypted.bodyNonce,
    conversationId: "conversation-2",
    dataKey,
    keyVersion: 1,
    messageId: "message-1",
    workspaceId: "workspace-1"
  }), (error) => assertCode(error, "message_decryption_failed"));
  dataKey.fill(0);
});

test("rejects tampered wrapped keys and unknown wrapping key identifiers", () => {
  const { provider } = createCrypto();
  const prepared = provider.prepareWorkspaceKey("workspace-1", 1);
  const tampered = Buffer.from(prepared.wrappedDataKey);
  tampered[0] ^= 1;
  assert.throws(
    () => provider.unwrapWorkspaceKey({ ...prepared, workspaceId: "workspace-1", wrappedDataKey: tampered }),
    (error) => assertCode(error, "messenger_key_unwrap_failed")
  );
  assert.throws(
    () => provider.unwrapWorkspaceKey({ ...prepared, kmsKeyId: "missing", workspaceId: "workspace-1" }),
    (error) => assertCode(error, "messenger_key_unavailable")
  );
});

test("creates stable keyed fingerprints without exposing plaintext", () => {
  const { provider } = createCrypto();
  const input = {
    authorUserId: "user-1",
    body: "low entropy body",
    conversationId: "conversation-1",
    workspaceId: "workspace-1"
  };
  const first = provider.createRequestFingerprint(input);
  const replay = provider.createRequestFingerprint(input);
  const changed = provider.createRequestFingerprint({ ...input, body: "different body" });
  const otherWorkspace = provider.createRequestFingerprint({ ...input, workspaceId: "workspace-2" });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.notEqual(first, otherWorkspace);
  assert.equal(first.includes("low entropy body"), false);
});

test("keeps historical envelopes decryptable while a new wrapping key is active", () => {
  const oldProvider = new AesMessengerKeyProvider({
    activeKeyId: "old-key",
    fingerprintKey: Buffer.alloc(32, 3),
    keys: { "old-key": Buffer.alloc(32, 1) },
    randomBytesFactory: (size) => Buffer.alloc(size, 6)
  });
  const oldEnvelope = oldProvider.prepareWorkspaceKey("workspace-1", 1);
  const rotatedProvider = new AesMessengerKeyProvider({
    activeKeyId: "new-key",
    fingerprintKey: Buffer.alloc(32, 3),
    keys: {
      "new-key": Buffer.alloc(32, 2),
      "old-key": Buffer.alloc(32, 1)
    }
  });
  const historicalDataKey = rotatedProvider.unwrapWorkspaceKey({ ...oldEnvelope, workspaceId: "workspace-1" });
  assert.deepEqual(historicalDataKey, Buffer.alloc(32, 6));
  assert.equal(rotatedProvider.prepareWorkspaceKey("workspace-1", 2).kmsKeyId, "new-key");
  historicalDataKey.fill(0);
});

test("binds AI attachment extracts to invocation and attachment identities", () => {
  const { codec, provider } = createCrypto();
  const prepared = provider.prepareWorkspaceKey("workspace-1", 1);
  const dataKey = provider.unwrapWorkspaceKey({ ...prepared, workspaceId: "workspace-1" });
  const encrypted = codec.encryptAiExtract({
    attachmentId: "attachment-1",
    dataKey,
    extract: "reviewed attachment text",
    invocationId: "invocation-1",
    keyVersion: 1,
    workspaceId: "workspace-1"
  });
  assert.equal(codec.decryptAiExtract({
    attachmentId: "attachment-1",
    ciphertext: encrypted.ciphertext,
    dataKey,
    invocationId: "invocation-1",
    keyVersion: 1,
    nonce: encrypted.nonce,
    workspaceId: "workspace-1"
  }), "reviewed attachment text");
  assert.throws(() => codec.decryptAiExtract({
    attachmentId: "attachment-2",
    ciphertext: encrypted.ciphertext,
    dataKey,
    invocationId: "invocation-1",
    keyVersion: 1,
    nonce: encrypted.nonce,
    workspaceId: "workspace-1"
  }), (error) => assertCode(error, "ai_extract_decryption_failed"));
  dataKey.fill(0);
});
