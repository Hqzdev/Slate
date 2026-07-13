import { createServer } from "node:http";
import { BridgeConfiguration } from "./configuration.js";
import { RepositorySyncService } from "./repositorySyncService.js";

class GitBridgeServer {
  constructor(configuration) {
    this.configuration = configuration;
    this.services = new Map(configuration.repositories.map((repository) => [repository.id, new RepositorySyncService(repository)]));
    this.server = createServer((request, response) => void this.handle(request, response));
  }

  start() {
    for (const service of this.services.values()) service.startWatching();
    this.server.listen(this.configuration.port, "127.0.0.1", () => {
      console.log(`Slate Git Bridge listening on http://127.0.0.1:${this.configuration.port}`);
    });
  }

  stop() {
    for (const service of this.services.values()) service.stopWatching();
    this.server.close();
  }

  async handle(request, response) {
    try {
      if (!this.isAuthorized(request)) return this.respond(response, 401, { error: "Unauthorized" });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") return this.respond(response, 200, { status: "ok" });
      const match = url.pathname.match(/^\/v1\/repositories\/([^/]+)(?:\/(sync))?$/);
      if (!match) return this.respond(response, 404, { error: "Not found" });
      const service = this.services.get(decodeURIComponent(match[1]));
      if (!service) return this.respond(response, 404, { error: "Repository not configured" });
      if (request.method === "GET" && !match[2]) return this.respond(response, 200, { repository: await service.getStatus() });
      if (request.method === "POST" && match[2] === "sync") return this.respond(response, 200, { repository: await service.sync() });
      return this.respond(response, 405, { error: "Method not allowed" });
    } catch (error) {
      return this.respond(response, 409, { error: error.message });
    }
  }

  isAuthorized(request) {
    return request.headers.authorization === `Bearer ${this.configuration.token}`;
  }

  respond(response, status, body) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
}

const configuration = new BridgeConfiguration();
const server = new GitBridgeServer(configuration);
process.once("SIGINT", () => server.stop());
process.once("SIGTERM", () => server.stop());
server.start();
