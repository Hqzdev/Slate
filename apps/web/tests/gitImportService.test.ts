import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitHubRepositoryUrl } from "../lib/server/gitImportService";

test("normalizes public GitHub repository URLs", () => {
  assert.equal(
    normalizeGitHubRepositoryUrl(" https://github.com/slate-labs/workspace.git "),
    "https://github.com/slate-labs/workspace.git"
  );
  assert.equal(
    normalizeGitHubRepositoryUrl("https://github.com/slate-labs/workspace"),
    "https://github.com/slate-labs/workspace.git"
  );
});

test("rejects Git import URLs outside the public GitHub repository contract", () => {
  for (const value of [
    "",
    "http://github.com/slate-labs/workspace",
    "https://github.com/slate-labs/workspace?ref=main",
    "https://token@github.com/slate-labs/workspace",
    "https://gitlab.com/slate-labs/workspace",
    "https://github.com/slate-labs/workspace/tree/main",
    "https://github.com/slate labs/workspace"
  ]) {
    assert.throws(() => normalizeGitHubRepositoryUrl(value));
  }
});
