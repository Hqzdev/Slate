import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateCommentInput } from "../lib/comments/commentInput";

test("parses document and line context from a comment request", () => {
  assert.deepEqual(parseCreateCommentInput({
    body: "Check this branch",
    fileNodeId: "file-1",
    lineEnd: 14,
    lineStart: 12
  }), {
    body: "Check this branch",
    fileNodeId: "file-1",
    lineEnd: 14,
    lineStart: 12,
    shapeId: null
  });
});

test("parses canvas shape context without accepting invalid identifiers", () => {
  assert.deepEqual(parseCreateCommentInput({ body: "Move this", fileNodeId: 4, shapeId: "shape-1" }), {
    body: "Move this",
    fileNodeId: null,
    lineEnd: undefined,
    lineStart: undefined,
    shapeId: "shape-1"
  });
});

test("returns an empty safe input for a malformed request body", () => {
  assert.deepEqual(parseCreateCommentInput(null), {
    body: "",
    fileNodeId: null,
    lineEnd: undefined,
    lineStart: undefined,
    shapeId: null
  });
});
