import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const sensitivePath = /(^|\/)(\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)$|id_(?:rsa|ed25519)|credentials?(?:\.|$)|secrets?(?:\.|$))/i;

export class GitCommandRunner {
  async run(repositoryPath, argumentsList) {
    try {
      const result = await executeFile("git", argumentsList, { cwd: repositoryPath, maxBuffer: 1024 * 1024, windowsHide: true });
      return result.stdout.trim();
    } catch (error) {
      const message = error.stderr?.trim() || error.message;
      throw new Error(message);
    }
  }
}

export class RepositorySyncService {
  constructor(repository, runner = new GitCommandRunner(), options = {}) {
    this.repository = repository;
    this.runner = runner;
    this.debounceMs = options.debounceMs ?? 1500;
    this.commitMessage = options.commitMessage ?? "chore(sync): workspace changes";
    this.lastError = null;
    this.lastSyncAt = null;
    this.state = "checking";
    this.syncing = false;
    this.watcher = null;
    this.timer = null;
  }

  async getStatus() {
    const snapshot = await this.collectSnapshot();
    return {
      autoSync: this.repository.autoSync,
      branch: snapshot.branch,
      changedFiles: snapshot.changedFiles,
      id: this.repository.id,
      lastError: this.lastError,
      lastSyncAt: this.lastSyncAt,
      remote: snapshot.remote,
      state: this.resolveState(snapshot)
    };
  }

  async sync(includeUntracked = true) {
    if (this.syncing) throw new Error("A Git sync is already running");
    this.syncing = true;

    try {
      const snapshot = await this.collectSnapshot();
      this.assertSyncable(snapshot, includeUntracked);
      if (snapshot.changedFiles.length === 0) {
        this.lastError = null;
        this.lastSyncAt = new Date().toISOString();
        return this.getStatus();
      }
      if (await this.hasRemoteBranch()) {
        await this.runner.run(this.repository.path, ["fetch", this.repository.remote, this.repository.branch]);
        await this.assertRemoteIsNotAhead();
      }
      await this.runner.run(this.repository.path, ["add", "-A"]);
      await this.runner.run(this.repository.path, ["commit", "--no-gpg-sign", "-m", this.commitMessage]);
      await this.runner.run(this.repository.path, ["push", this.repository.remote, `HEAD:${this.repository.branch}`]);
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
      return this.getStatus();
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  startWatching() {
    if (!this.repository.autoSync || this.watcher) return;
    this.watcher = watch(this.repository.path, { recursive: true }, (_eventType, fileName) => {
      if (this.shouldScheduleFor(fileName)) this.scheduleSync();
    });
    this.watcher.on("error", (error) => {
      this.lastError = error.message;
    });
  }

  stopWatching() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  scheduleSync() {
    if (this.syncing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync(false).catch(() => undefined);
    }, this.debounceMs);
  }

  shouldScheduleFor(fileName) {
    const path = String(fileName ?? "").replaceAll("\\", "/");
    return Boolean(path) && !path.startsWith(".git/") && !path.startsWith("node_modules/");
  }

  async collectSnapshot() {
    const [branch, remote, status, indexDirty] = await Promise.all([
      this.runner.run(this.repository.path, ["branch", "--show-current"]),
      this.runner.run(this.repository.path, ["remote", "get-url", this.repository.remote]),
      this.runner.run(this.repository.path, ["status", "--porcelain=v1", "--untracked-files=all"]),
      this.runner.run(this.repository.path, ["diff", "--cached", "--quiet"]).then(() => false).catch(() => true)
    ]);
    const statusLines = status ? status.split("\n") : [];
    const changedFiles = statusLines.map((line) => line.slice(3).trim()).filter(Boolean);
    const untrackedFiles = statusLines.filter((line) => line.startsWith("?? ")).map((line) => line.slice(3).trim()).filter(Boolean);
    return { branch, changedFiles, indexDirty, remote, untrackedFiles };
  }

  resolveState(snapshot) {
    if (this.syncing) return "syncing";
    if (this.lastError) return "needs_attention";
    if (snapshot.branch !== this.repository.branch || snapshot.indexDirty || snapshot.untrackedFiles.length > 0) return "needs_attention";
    return snapshot.changedFiles.length === 0 ? "synced" : "changes_detected";
  }

  assertSyncable(snapshot, includeUntracked) {
    if (snapshot.branch !== this.repository.branch) throw new Error(`Checkout is on ${snapshot.branch || "a detached HEAD"}; Git Bridge only syncs ${this.repository.branch}`);
    if (snapshot.indexDirty) throw new Error("The Git index already contains staged changes");
    if (!includeUntracked && snapshot.untrackedFiles.length > 0) throw new Error("Untracked files require a manual Git Sync");
    const blockedFile = snapshot.changedFiles.find((filePath) => sensitivePath.test(filePath));
    if (blockedFile) throw new Error(`Refusing to sync sensitive path ${blockedFile}`);
  }

  async assertRemoteIsNotAhead() {
    const remoteReference = `${this.repository.remote}/${this.repository.branch}`;
    const behind = Number(await this.runner.run(this.repository.path, ["rev-list", "--count", `HEAD..${remoteReference}`]));
    if (behind > 0) throw new Error(`Remote branch ${remoteReference} is ahead by ${behind} commits`);
  }

  async hasRemoteBranch() {
    const output = await this.runner.run(this.repository.path, ["ls-remote", "--heads", this.repository.remote, this.repository.branch]);
    return Boolean(output);
  }
}
