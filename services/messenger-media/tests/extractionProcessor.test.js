import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { AiExtractionProcessor } from "../src/extractionProcessor.js";

function createFixture(contentType = "text/plain", content = "safe attachment text") {
  const actions = [];
  const job = {
    attachmentId: "attachment-1",
    attemptCount: 1,
    detectedContentType: contentType,
    id: "selected-1",
    invocationId: "invocation-1",
    storageKey: "object-key",
    verifiedByteSize: String(Buffer.byteLength(content)),
    workspaceId: "workspace-1"
  };
  const processor = new AiExtractionProcessor({
    clamav: { scan: async () => ({ clean: true }) },
    keyring: { encryptExtract: (_job, extract) => ({ ciphertext: Buffer.from(extract), keyVersion: 1, nonce: Buffer.alloc(12) }) },
    processRunner: { run: async () => ({ stdout: content }) },
    repository: {
      complete: async (_job, _encrypted, characterCount, contentHash) => {
        actions.push(["complete", characterCount, contentHash]);
        return true;
      },
      reject: async (_job, code) => actions.push(["reject", code]),
      retry: async (_job, code) => actions.push(["retry", code])
    },
    storage: { download: async (_key, path) => writeFile(path, content, { mode: 0o600 }) },
    temporaryDirectory: tmpdir()
  });
  return { actions, job, processor };
}

test("extracts bounded clean text and persists only its encrypted form", async () => {
  const fixture = createFixture();
  assert.equal(await fixture.processor.process(fixture.job), "completed");
  assert.equal(fixture.actions[0][0], "complete");
  assert.equal(fixture.actions[0][1], 20);
  assert.match(fixture.actions[0][2], /^[a-f0-9]{64}$/u);
});

test("rejects unsupported AI sources and malware", async () => {
  const unsupported = createFixture("image/png");
  assert.equal(await unsupported.processor.process(unsupported.job), "rejected");
  assert.deepEqual(unsupported.actions, [["reject", "ai_attachment_type_rejected"]]);
  const malware = createFixture();
  malware.processor.clamav = { scan: async () => ({ clean: false }) };
  assert.equal(await malware.processor.process(malware.job), "rejected");
  assert.deepEqual(malware.actions, [["reject", "malware_detected"]]);
});

test("rejects oversized extracts before encryption", async () => {
  const fixture = createFixture("application/pdf", "small");
  fixture.processor.processRunner = { run: async () => ({ stdout: "x".repeat(32_001) }) };
  assert.equal(await fixture.processor.process(fixture.job), "rejected");
  assert.deepEqual(fixture.actions, [["reject", "ai_extract_too_large"]]);
});
