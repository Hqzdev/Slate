import test from "node:test";
import assert from "node:assert/strict";
import { GitHubAppError, githubDocumentShape, isGitHubCommitSha, normalizeGitHubBranch } from "../lib/server/githubAppInput";

test("GitHub branch validation accepts normal branch names and rejects unsafe references", () => {
  assert.equal(normalizeGitHubBranch("feature/slate-sync"), "feature/slate-sync");
  assert.throws(() => normalizeGitHubBranch("main..backup"), GitHubAppError);
  assert.throws(() => normalizeGitHubBranch("/main"), GitHubAppError);
});

test("GitHub import accepts supported text paths and rejects traversal or binaries", () => {
  assert.deepEqual(githubDocumentShape("src/app.ts"), { language: "typescript", type: "code" });
  assert.deepEqual(githubDocumentShape("docs/readme.md"), { language: "markdown", type: "note" });
  assert.equal(githubDocumentShape("../.env"), null);
  assert.equal(githubDocumentShape("assets/logo.png"), null);
});

test("GitHub commit references require a full hexadecimal SHA", () => {
  assert.equal(isGitHubCommitSha("a".repeat(40)), true);
  assert.equal(isGitHubCommitSha("a".repeat(39)), false);
  assert.equal(isGitHubCommitSha("z".repeat(40)), false);
});
