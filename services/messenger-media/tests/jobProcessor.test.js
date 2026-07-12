import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { MediaJobProcessor } from "../src/jobProcessor.js";

function createFixture(overrides = {}) {
  const actions = [];
  const job = {
    attemptCount: 1,
    conversationId: "conversation-1",
    createdByUserId: "user-1",
    declaredByteSize: "5",
    declaredContentType: "text/plain",
    id: "attachment-1",
    jobId: "job-1",
    kind: "file",
    storageKey: "original-key",
    workspaceId: "workspace-1"
  };
  const dependencies = {
    clamav: { scan: async () => ({ clean: true, signature: null }) },
    contentValidator: { validate: async () => "text/plain" },
    mediaProcessor: { process: async () => ({ durationMs: null, height: null, preview: null, width: null }) },
    repository: {
      markReady: async (_job, result) => {
        actions.push(["ready", result]);
        return "ready";
      },
      reject: async (_job, code) => actions.push(["reject", code]),
      retry: async (_job, code) => actions.push(["retry", code])
    },
    storage: {
      delete: async (key) => actions.push(["delete", key]),
      download: async (_key, path) => writeFile(path, "clean", { mode: 0o600 }),
      upload: async (key) => actions.push(["upload", key])
    },
    temporaryDirectory: tmpdir(),
    ...overrides
  };
  return { actions, job, processor: new MediaJobProcessor(dependencies) };
}

test("hashes clean content and marks the leased job ready", async () => {
  const fixture = createFixture();
  assert.equal(await fixture.processor.process(fixture.job), "ready");
  assert.equal(fixture.actions[0][0], "ready");
  assert.equal(fixture.actions[0][1].checksumSha256, "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e");
});

test("rejects malware without exposing the scanner signature", async () => {
  const fixture = createFixture({ clamav: { scan: async () => ({ clean: false, signature: "Eicar-Signature" }) } });
  assert.equal(await fixture.processor.process(fixture.job), "rejected");
  assert.deepEqual(fixture.actions, [["reject", "malware_detected"]]);
});

test("retries transient scanner failures and terminally rejects exhausted work", async () => {
  const retry = createFixture({ clamav: { scan: async () => { throw new Error("clamav_timeout"); } } });
  assert.equal(await retry.processor.process(retry.job), "retry");
  assert.deepEqual(retry.actions, [["retry", "clamav_timeout"]]);
  const exhausted = createFixture({ clamav: { scan: async () => { throw new Error("offline"); } } });
  exhausted.job.attemptCount = 8;
  assert.equal(await exhausted.processor.process(exhausted.job), "rejected");
  assert.deepEqual(exhausted.actions, [["reject", "processing_unavailable"]]);
});

test("removes generated variants when access is revoked during finalization", async () => {
  const fixture = createFixture({
    mediaProcessor: {
      async process(input) {
        await writeFile(input.previewPath, "preview");
        return { durationMs: null, height: 10, preview: { contentType: "image/webp", path: input.previewPath, type: "thumbnail" }, width: 10 };
      }
    },
    repository: {
      markReady: async () => "rejected",
      reject: async () => {},
      retry: async () => {}
    }
  });
  fixture.job.kind = "image";
  assert.equal(await fixture.processor.process(fixture.job), "rejected");
  assert.deepEqual(fixture.actions.map(([action]) => action), ["upload", "delete"]);
});
