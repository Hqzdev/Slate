import assert from "node:assert/strict";
import test from "node:test";
import { isAiReadableDocumentName, isAiReadableFileNode, type AiDocumentFileNode } from "../lib/server/ai/documentAccessPolicy";

test("AI document policy excludes common secret-bearing files", () => {
  for (const name of [".env", ".env.local", ".npmrc", "credentials.json", "service-account.key", "private.pem", "id_rsa"]) {
    assert.equal(isAiReadableDocumentName(name), false, name);
  }
});

test("AI document policy allows ordinary workspace documents", () => {
  for (const name of ["README.md", "architecture.canvas", "src/config.ts", "tasks.md"]) {
    assert.equal(isAiReadableDocumentName(name), true, name);
  }
});

test("AI document policy excludes files below secret-bearing folders", () => {
  const nodes: AiDocumentFileNode[] = [
    { id: "root", name: "src", parentId: null },
    { id: "secret", name: "secrets", parentId: "root" },
    { id: "hidden", name: "prod.txt", parentId: "secret" },
    { id: "public", name: "README.md", parentId: "root" }
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(isAiReadableFileNode(nodes[2], nodesById), false);
  assert.equal(isAiReadableFileNode(nodes[3], nodesById), true);
});

test("AI document policy fails closed on missing or cyclic ancestry", () => {
  const missing = { id: "missing-child", name: "note.md", parentId: "unknown" };
  assert.equal(isAiReadableFileNode(missing, new Map([[missing.id, missing]])), false);
  const first = { id: "first", name: "first", parentId: "second" };
  const second = { id: "second", name: "second", parentId: "first" };
  const cycle = new Map([[first.id, first], [second.id, second]]);
  assert.equal(isAiReadableFileNode(first, cycle), false);
});
