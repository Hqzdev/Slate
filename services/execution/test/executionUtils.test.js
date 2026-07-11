import assert from "node:assert/strict";
import test from "node:test";
import { classifyProcessFailure, formatRunOutput, safeFileName, staleRunCutoff } from "../src/executionUtils.js";

test("safeFileName keeps supported JavaScript extensions", () => {
  assert.equal(safeFileName("app.mjs"), "app.mjs");
  assert.equal(safeFileName("worker.cjs"), "worker.cjs");
});

test("safeFileName normalizes unsafe names", () => {
  assert.equal(safeFileName("../bad name"), ".._bad_name.js");
  assert.equal(safeFileName(""), "main.js");
});

test("formatRunOutput includes timeout and truncation metadata", () => {
  const output = formatRunOutput({
    command: "$ docker run node",
    duration: "50ms",
    environmentId: "node-container",
    outputLimit: 100,
    result: {
      code: 1,
      outputTruncated: true,
      stderr: " error ",
      stdout: " ok ",
      timedOut: true
    }
  });

  assert.match(output, /exitCode=timeout/);
  assert.match(output, /output=truncated:100/);
  assert.match(output, /ok/);
  assert.match(output, /error/);
});

test("classifyProcessFailure detects docker daemon failures", () => {
  assert.equal(
    classifyProcessFailure({
      code: 1,
      stderr: "Cannot connect to the Docker daemon",
      timedOut: false
    }, "Container run failed"),
    "Docker daemon unavailable"
  );
});

test("classifyProcessFailure detects missing runtime", () => {
  assert.equal(
    classifyProcessFailure({
      code: 1,
      stderr: "spawn docker ENOENT",
      timedOut: false
    }, "Container run failed"),
    "Execution runtime unavailable"
  );
});

test("staleRunCutoff subtracts the stale window", () => {
  assert.equal(staleRunCutoff(new Date("2026-01-01T00:10:00.000Z"), 300000).toISOString(), "2026-01-01T00:05:00.000Z");
});
