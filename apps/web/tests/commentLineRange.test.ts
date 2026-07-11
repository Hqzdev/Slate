import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommentLineRange } from "../lib/comments/commentLineRange";

test("accepts document-level comments without a line range", () => {
  assert.equal(normalizeCommentLineRange(null, null), null);
  assert.equal(normalizeCommentLineRange(undefined, undefined), null);
});

test("normalizes a selected line range", () => {
  assert.deepEqual(normalizeCommentLineRange(12, 15), { end: 15, start: 12 });
});

test("rejects incomplete or invalid line ranges", () => {
  assert.throws(() => normalizeCommentLineRange(12, null), /incomplete/);
  assert.throws(() => normalizeCommentLineRange("12", 12), /whole numbers/);
  assert.throws(() => normalizeCommentLineRange(0, 12), /positive/);
  assert.throws(() => normalizeCommentLineRange(15, 12), /invalid/);
});
