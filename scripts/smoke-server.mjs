const webUrl = process.env.SLATE_WEB_URL ?? "http://127.0.0.1:3000";
const syncHealthUrl = process.env.SLATE_SYNC_HEALTH_URL ?? "http://127.0.0.1:1234/health";
const executionHealthUrl = process.env.SLATE_EXECUTION_HEALTH_URL ?? "http://127.0.0.1:1235/health";
const runTimeoutMs = Number(process.env.SLATE_SMOKE_RUN_TIMEOUT_MS ?? 15000);

class CookieJar {
  #cookies = new Map();

  apply(headers) {
    const cookies = this.#readSetCookie(headers);
    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) continue;
      this.#cookies.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
    }
  }

  header() {
    return Array.from(this.#cookies.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  #readSetCookie(headers) {
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }

    const cookie = headers.get("set-cookie");
    return cookie ? [cookie] : [];
  }
}

class HttpClient {
  constructor(baseUrl, cookieJar) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookieJar = cookieJar;
  }

  async get(path) {
    return this.request(path, { method: "GET" });
  }

  async post(path, body) {
    return this.request(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
  }

  async patch(path, body) {
    return this.request(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
  }

  async request(path, options) {
    const cookie = this.cookieJar.header();
    const headers = {
      origin: this.baseUrl,
      "sec-fetch-site": "same-origin",
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {})
    };
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });
    this.cookieJar.apply(response.headers);
    const body = await this.readBody(response);

    if (!response.ok) {
      throw new Error(`${options.method} ${path} failed with ${response.status}: ${this.errorMessage(body)}`);
    }

    return body;
  }

  async readBody(response) {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  errorMessage(body) {
    if (body && typeof body === "object" && typeof body.error === "string") return body.error;
    if (typeof body === "string" && body.length > 0) return body;
    return "empty response";
  }
}

class SmokeRunner {
  constructor(client) {
    this.client = client;
    this.createdAt = Date.now();
  }

  async run() {
    await this.checkHealth(`${webUrl}/api/health`, "web");
    await this.checkHealth(syncHealthUrl, "sync");
    await this.checkHealth(executionHealthUrl, "execution");
    const user = await this.registerUser();
    const workspace = await this.createWorkspace();
    await this.checkAiConversation(workspace.id);
    const document = await this.createDocument(workspace.id);
    await this.updateDocument(document.id);
    await this.authorizeRealtime(workspace.id, document.id);
    const run = await this.createRun(document.id);
    const completedRun = await this.waitForRun(workspace.id, run.id);

    return {
      documentId: document.id,
      email: user.email,
      runId: completedRun.id,
      runStatus: completedRun.status,
      workspaceId: workspace.id
    };
  }

  async checkHealth(url, service) {
    const response = await fetch(url);
    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.ok) {
      throw new Error(`${service} health failed at ${url}: ${JSON.stringify(body)}`);
    }
  }

  async registerUser() {
    const body = await this.client.post("/api/auth/register", {
      email: `smoke-${this.createdAt}@slate.local`,
      name: "Smoke Runner",
      password: `Smoke-${this.createdAt}`
    });

    if (!body?.user?.id) {
      throw new Error("Registration response did not include user.id");
    }

    return body.user;
  }

  async createWorkspace() {
    const body = await this.client.post("/api/workspaces", {
      name: `smoke-${this.createdAt}`
    });
    const workspace = body?.activeWorkspace;

    if (!workspace?.id) {
      throw new Error("Workspace creation response did not include activeWorkspace.id");
    }

    return workspace;
  }

  async createDocument(workspaceId) {
    const body = await this.client.post(`/api/workspaces/${workspaceId}/documents`, {
      type: "code"
    });
    const document = body?.document;

    if (!document?.id) {
      throw new Error("Document creation response did not include document.id");
    }

    return document;
  }

  async checkAiConversation(workspaceId) {
    const body = await this.client.get(`/api/workspaces/${workspaceId}/ai/conversation`);

    if (body?.conversation !== null || !Array.isArray(body?.messages) || body.messages.length !== 0) {
      throw new Error("AI conversation storage is not ready");
    }
  }

  async updateDocument(documentId) {
    const body = await this.client.patch(`/api/documents/${documentId}`, {
      content: "console.log('slate smoke ok')",
      title: `smoke-${this.createdAt}.js`
    });

    if (body?.document?.id !== documentId) {
      throw new Error("Document update response did not return the updated document");
    }
  }

  async authorizeRealtime(workspaceId, documentId) {
    const room = `slate:room:${workspaceId}:file:${documentId}`;
    const body = await this.client.get(`/api/realtime/authorize?room=${encodeURIComponent(room)}`);

    if (typeof body?.grant !== "string" || body.grant.length === 0) {
      throw new Error("Realtime authorization response did not include a grant");
    }
  }

  async createRun(documentId) {
    const body = await this.client.post("/api/jobs/runs", {
      documentId,
      environmentId: "dry-run"
    });
    const run = body?.run;

    if (!run?.id) {
      throw new Error("Run creation response did not include run.id");
    }

    return run;
  }

  async waitForRun(workspaceId, runId) {
    const deadline = Date.now() + runTimeoutMs;

    while (Date.now() < deadline) {
      const body = await this.client.get(`/api/jobs/runs?workspaceId=${workspaceId}`);
      const run = body?.runs?.find((candidate) => candidate.id === runId);

      if (run?.status === "completed") return run;
      if (run?.status === "failed") {
        throw new Error(`Run failed: ${run.error ?? run.output ?? "unknown failure"}`);
      }

      await this.delay(500);
    }

    throw new Error(`Run ${runId} did not complete within ${runTimeoutMs}ms`);
  }

  async delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function main() {
  const runner = new SmokeRunner(new HttpClient(webUrl, new CookieJar()));
  const result = await runner.run();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
