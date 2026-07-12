import assert from "node:assert/strict";
import test from "node:test";
import { MediaWorker } from "../src/worker.js";

test("stops an idle worker and releases owned leases", async () => {
  let released = false;
  const worker = new MediaWorker({
    claim: async () => [],
    release: async () => {
      released = true;
    }
  }, { process: async () => assert.fail("no jobs expected") }, { pollIntervalMs: 30_000 });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await worker.stop();
  assert.equal(released, true);
});
