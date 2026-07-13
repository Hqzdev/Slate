import { resolve } from "node:path";

const protectedBranches = new Set(["main", "master", "production"]);

export class BridgeConfiguration {
  constructor(environment = process.env) {
    this.port = this.readPort(environment.SLATE_GIT_BRIDGE_PORT);
    this.token = this.readToken(environment.SLATE_GIT_BRIDGE_TOKEN);
    this.repositories = this.readRepositories(environment.SLATE_GIT_BRIDGE_REPOSITORIES);
  }

  readPort(value) {
    const port = Number(value ?? 1238);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("SLATE_GIT_BRIDGE_PORT must be a valid unprivileged port");
    return port;
  }

  readToken(value) {
    if (!value || value.length < 32) throw new Error("SLATE_GIT_BRIDGE_TOKEN must contain at least 32 characters");
    return value;
  }

  readRepositories(value) {
    if (!value) throw new Error("SLATE_GIT_BRIDGE_REPOSITORIES is required");
    let parsed;

    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("SLATE_GIT_BRIDGE_REPOSITORIES must be valid JSON");
    }

    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("SLATE_GIT_BRIDGE_REPOSITORIES must contain at least one repository");
    const repositories = parsed.map((repository) => this.readRepository(repository));
    const ids = new Set(repositories.map((repository) => repository.id));
    if (ids.size !== repositories.length) throw new Error("SLATE_GIT_BRIDGE_REPOSITORIES contains duplicate ids");
    return repositories;
  }

  readRepository(value) {
    if (!value || typeof value !== "object") throw new Error("Each Git Bridge repository must be an object");
    const id = this.readText(value.id, "repository id");
    const path = resolve(this.readText(value.path, "repository path"));
    const remote = this.readText(value.remote ?? "origin", "repository remote");
    const branch = this.readText(value.branch, "repository branch");
    if (protectedBranches.has(branch)) throw new Error(`Git Bridge cannot auto-sync protected branch ${branch}`);
    return { autoSync: value.autoSync === true, branch, id, path, remote };
  }

  readText(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
    return value.trim();
  }
}
