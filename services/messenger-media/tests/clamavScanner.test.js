import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClamavScanner } from "../src/clamavScanner.js";

test("streams bounded ClamAV INSTREAM frames and parses a clean result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slate-clamav-"));
  const filePath = join(directory, "input");
  await writeFile(filePath, "scan-me");
  const socket = new EventEmitter();
  let input = Buffer.alloc(0);
  socket.setTimeout = () => {};
  socket.destroy = (error) => error && socket.emit("error", error);
  socket.write = (chunk) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    input = Buffer.concat([input, bytes]);
    if (bytes.length === 4 && bytes.equals(Buffer.alloc(4))) {
      queueMicrotask(() => {
        socket.emit("data", Buffer.from("stream: OK\0"));
        socket.emit("end");
      });
    }
    return true;
  };
  try {
    const scanner = new ClamavScanner({
      connect: () => {
        queueMicrotask(() => socket.emit("connect"));
        return socket;
      },
      host: "clamav",
      port: 3310,
      timeoutMs: 2_000
    });
    assert.deepEqual(await scanner.scan(filePath), { clean: true, signature: null });
    assert.equal(input.subarray(0, 10).toString("utf8"), "zINSTREAM\0");
    assert.equal(input.readUInt32BE(10), 7);
    assert.equal(input.subarray(14, 21).toString("utf8"), "scan-me");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
