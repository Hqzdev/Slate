import assert from "node:assert/strict";
import test from "node:test";
import { BridgeConfiguration } from "../src/configuration.js";
import { RepositorySyncService } from "../src/repositorySyncService.js";

class FakeRunner {
  constructor(status = "") {
    this.status = status;
  }

  async run(_repositoryPath, argumentsList) {
    if (argumentsList[0] === "branch") return "sync/slate";
    if (argumentsList[0] === "remote") return "git@github.com:Hqzdev/Slate.git";
    if (argumentsList[0] === "status") return this.status;
    if (argumentsList[0] === "diff") return "";
    return "";
  }
}

test("Git Bridge rejects protected automatic branches", () => {
  assert.throws(() => new BridgeConfiguration({
    SLATE_GIT_BRIDGE_REPOSITORIES: JSON.stringify([{ branch: "main", id: "slate", path: "/tmp/slate" }]),
    SLATE_GIT_BRIDGE_TOKEN: "a".repeat(32)
  }), /protected branch/);
});

test("Git Bridge reports a clean configured repository as synced", async () => {
  const service = new RepositorySyncService({ autoSync: true, branch: "sync/slate", id: "slate", path: "/tmp/slate", remote: "origin" }, new FakeRunner());
  const status = await service.getStatus();
  assert.equal(status.state, "synced");
  assert.deepEqual(status.changedFiles, []);
});

test("Git Bridge refuses sensitive paths before staging", async () => {
  const service = new RepositorySyncService({ autoSync: true, branch: "sync/slate", id: "slate", path: "/tmp/slate", remote: "origin" }, new FakeRunner("?? apps/web/.env.local"));
  await assert.rejects(() => service.sync(), /sensitive path/);
});

test("Git Bridge requires a manual sync for untracked files", async () => {
  const service = new RepositorySyncService({ autoSync: true, branch: "sync/slate", id: "slate", path: "/tmp/slate", remote: "origin" }, new FakeRunner("?? services/git-bridge/src/server.js"));
  await assert.rejects(() => service.sync(false), /manual Git Sync/);
});
