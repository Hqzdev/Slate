import { createHash, createSign, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { type DocumentType } from "@prisma/client";
import { auditLogService } from "./auditLog";
import { GitHubAppError, githubDocumentShape, isGitHubCommitSha, normalizeGitHubBranch } from "./githubAppInput";
import { prisma } from "./prisma";
import { workspaceAccessPolicy } from "./workspaceAccessPolicy";
import { workspaceRepository } from "./workspaceRepository";

const githubApiUrl = "https://api.github.com";
const githubOauthUrl = "https://github.com/login/oauth/access_token";
const githubApiVersion = "2022-11-28";
const attemptLifetimeMs = 10 * 60 * 1000;
const maxImportedFiles = 25;
const maxImportedFileBytes = 80 * 1024;

type GitHubAppConfiguration = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  slug: string;
};

type GitHubRepositorySummary = {
  defaultBranch: string;
  id: string;
  name: string;
  owner: string;
  private: boolean;
};

type GitHubRepositoryStatus = {
  branch: string;
  canManage: boolean;
  changedFiles: number;
  installationReady: boolean;
  remoteHeadSha: string | null;
  repository: {
    defaultBranch: string;
    fullName: string;
    lastRemoteCommitSha: string | null;
  } | null;
  trackedFiles: number;
};

type GitHubTreeEntry = {
  path: string;
  sha: string;
  type: string;
};

type ImportedGitHubDocument = {
  content: string;
  contentHash: string;
  language: string | null;
  path: string;
  remoteBlobSha: string;
  type: DocumentType;
};

export class GitHubAppService {
  async createConnection(userId: string, workspaceId: string) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    const configuration = this.configuration();
    const state = randomBytes(32).toString("base64url");
    await prisma.gitHubConnectionAttempt.create({
      data: {
        expiresAt: new Date(Date.now() + attemptLifetimeMs),
        stateHash: this.hash(state),
        userId,
        workspaceId
      }
    });
    const url = new URL(`https://github.com/apps/${configuration.slug}/installations/new`);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  }

  async completeConnection(input: { code: string; installationId: string; state: string; userId: string }) {
    const installationId = this.parseIdentifier(input.installationId, "installation");
    const attempt = await prisma.gitHubConnectionAttempt.findUnique({ where: { stateHash: this.hash(input.state) } });
    if (!attempt || attempt.userId !== input.userId || attempt.consumedAt || attempt.expiresAt <= new Date()) {
      throw new GitHubAppError("GitHub connection request has expired", 400);
    }

    const userToken = await this.exchangeAuthorizationCode(input.code);
    try {
      const installations = await this.userInstallations(userToken);
      if (!installations.has(installationId.toString())) {
        throw new GitHubAppError("GitHub installation is not authorized for this user", 403);
      }
      const installation = await this.appRequest<{ account?: { login?: unknown } }>(`/app/installations/${installationId.toString()}`, "GET");
      const accountLogin = typeof installation.account?.login === "string" && installation.account.login.trim() ? installation.account.login.trim() : "GitHub";
      await prisma.$transaction(async (transaction) => {
        const current = await transaction.gitHubConnectionAttempt.findUnique({ where: { id: attempt.id } });
        if (!current || current.consumedAt || current.expiresAt <= new Date()) throw new GitHubAppError("GitHub connection request has expired", 400);
        await transaction.gitHubWorkspaceInstallation.upsert({
          create: {
            accountLogin,
            createdByUserId: input.userId,
            githubInstallationId: installationId,
            workspaceId: attempt.workspaceId
          },
          update: {
            accountLogin,
            createdByUserId: input.userId,
            githubInstallationId: installationId
          },
          where: { workspaceId: attempt.workspaceId }
        });
        await transaction.gitHubConnectionAttempt.update({ data: { consumedAt: new Date() }, where: { id: attempt.id } });
      });
      await auditLogService.record({ actorUserId: input.userId, metadata: { installationId: installationId.toString() }, type: "github.installation.connected", workspaceId: attempt.workspaceId });
      return { workspaceId: attempt.workspaceId };
    } finally {
      await this.revokeUserToken(userToken);
    }
  }

  async getStatus(userId: string, workspaceId: string): Promise<GitHubRepositoryStatus> {
    const member = await workspaceAccessPolicy.requireWorkspaceReader(userId, workspaceId);
    const installation = await prisma.gitHubWorkspaceInstallation.findUnique({ where: { workspaceId } });
    const repository = await prisma.gitHubWorkspaceRepository.findUnique({
      include: { files: { include: { document: true } } },
      where: { workspaceId }
    });
    if (!repository) {
      return {
        branch: "",
        canManage: member.role === "owner",
        changedFiles: 0,
        installationReady: Boolean(installation),
        remoteHeadSha: null,
        repository: null,
        trackedFiles: 0
      };
    }
    const changedFiles = repository.files.filter((file) => file.document.archivedAt || this.hash(file.document.content) !== file.contentHash).length;
    const remoteHeadSha = await this.withInstallationToken(repository.installationId, repository.githubRepositoryId, (token) => this.readHead(token, repository.owner, repository.name, repository.branch).then((head) => head.commitSha));
    return {
      branch: repository.branch,
      canManage: member.role === "owner",
      changedFiles,
      installationReady: true,
      remoteHeadSha,
      repository: {
        defaultBranch: repository.defaultBranch,
        fullName: `${repository.owner}/${repository.name}`,
        lastRemoteCommitSha: repository.lastRemoteCommitSha
      },
      trackedFiles: repository.files.length
    };
  }

  async listRepositories(userId: string, workspaceId: string) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    const installation = await prisma.gitHubWorkspaceInstallation.findUnique({ where: { workspaceId } });
    if (!installation) throw new GitHubAppError("Connect GitHub before selecting a repository", 409);
    return this.withInstallationToken(installation.id, null, async (token) => {
      const result = await this.installationRequest<{ repositories?: unknown }>(token, "/installation/repositories?per_page=100", "GET");
      const repositories = Array.isArray(result.repositories) ? result.repositories : [];
      return repositories.flatMap((repository): GitHubRepositorySummary[] => {
        if (!repository || typeof repository !== "object") return [];
        const item = repository as Record<string, unknown>;
        const id = typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : "";
        const name = typeof item.name === "string" ? item.name : "";
        const owner = item.owner && typeof item.owner === "object" && typeof (item.owner as Record<string, unknown>).login === "string" ? String((item.owner as Record<string, unknown>).login) : "";
        const defaultBranch = typeof item.default_branch === "string" ? item.default_branch : "";
        if (!/^\d+$/.test(id) || !name || !owner || !defaultBranch) return [];
        return [{ defaultBranch, id, name, owner, private: item.private === true }];
      }).sort((left, right) => `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`));
    });
  }

  async selectRepository(userId: string, workspaceId: string, input: { branch: string; repositoryId: string }) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    const branch = normalizeGitHubBranch(input.branch);
    const repositoryId = this.parseIdentifier(input.repositoryId, "repository");
    const installation = await prisma.gitHubWorkspaceInstallation.findUnique({ where: { workspaceId } });
    if (!installation) throw new GitHubAppError("Connect GitHub before selecting a repository", 409);
    const repositories = await this.listRepositories(userId, workspaceId);
    const selected = repositories.find((repository) => repository.id === repositoryId.toString());
    if (!selected) throw new GitHubAppError("Repository is not available to this GitHub installation", 403);
    const head = await this.withInstallationToken(installation.id, repositoryId, (token) => this.readHead(token, selected.owner, selected.name, branch));
    const repository = await prisma.gitHubWorkspaceRepository.upsert({
      create: {
        branch,
        createdByUserId: userId,
        defaultBranch: selected.defaultBranch,
        githubRepositoryId: repositoryId,
        installationId: installation.id,
        lastRemoteCommitSha: head.commitSha,
        name: selected.name,
        owner: selected.owner,
        workspaceId
      },
      update: {
        branch,
        createdByUserId: userId,
        defaultBranch: selected.defaultBranch,
        githubRepositoryId: repositoryId,
        lastRemoteCommitSha: head.commitSha,
        name: selected.name,
        owner: selected.owner
      },
      where: { workspaceId }
    });
    await auditLogService.record({ actorUserId: userId, metadata: { branch, repositoryId: repositoryId.toString() }, type: "github.repository.selected", workspaceId });
    return this.repositoryPayload(repository);
  }

  async disconnect(userId: string, workspaceId: string) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    await prisma.gitHubWorkspaceInstallation.deleteMany({ where: { workspaceId } });
    await auditLogService.record({ actorUserId: userId, type: "github.installation.disconnected", workspaceId });
  }

  async importRepository(userId: string, workspaceId: string) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    const repository = await prisma.gitHubWorkspaceRepository.findUnique({ include: { files: true }, where: { workspaceId } });
    if (!repository) throw new GitHubAppError("Select a GitHub repository before importing", 409);
    if (repository.files.length > 0) throw new GitHubAppError("This GitHub repository has already been imported into the workspace", 409);
    const imported = await this.withInstallationToken(repository.installationId, repository.githubRepositoryId, (token) => this.readImportableDocuments(token, repository.owner, repository.name, repository.branch));
    const documents = await workspaceRepository.importDocuments(userId, workspaceId, imported.map(({ content, language, path, type }) => ({ content, language, title: path, type })));
    await prisma.$transaction(imported.map((file, index) => prisma.gitHubWorkspaceRepositoryFile.create({
      data: {
        contentHash: file.contentHash,
        documentId: documents[index].id,
        path: file.path,
        remoteBlobSha: file.remoteBlobSha,
        repositoryId: repository.id
      }
    })));
    const head = await this.withInstallationToken(repository.installationId, repository.githubRepositoryId, (token) => this.readHead(token, repository.owner, repository.name, repository.branch));
    await prisma.gitHubWorkspaceRepository.update({ data: { lastRemoteCommitSha: head.commitSha }, where: { id: repository.id } });
    await auditLogService.record({ actorUserId: userId, metadata: { importedFiles: documents.length }, type: "github.repository.imported", workspaceId });
    return { importedFiles: documents.length };
  }

  async commit(userId: string, workspaceId: string, input: { expectedHeadSha: string; message: string }) {
    await workspaceAccessPolicy.requireWorkspaceOwner(userId, workspaceId);
    const message = this.normalizeCommitMessage(input.message);
    const repository = await prisma.gitHubWorkspaceRepository.findUnique({
      include: { files: { include: { document: true } } },
      where: { workspaceId }
    });
    if (!repository) throw new GitHubAppError("Select and import a GitHub repository before committing", 409);
    const expectedHeadSha = this.normalizeSha(input.expectedHeadSha);
    return this.withInstallationToken(repository.installationId, repository.githubRepositoryId, async (token) => {
      const head = await this.readHead(token, repository.owner, repository.name, repository.branch);
      if (head.commitSha !== expectedHeadSha) throw new GitHubAppError("Remote branch changed. Refresh before committing.", 409);
      const changes: Array<{ file: typeof repository.files[number]; kind: "delete" } | { contentHash: string; file: typeof repository.files[number]; kind: "update" }> = [];
      for (const file of repository.files) {
        if (file.document.archivedAt) {
          changes.push({ file, kind: "delete" });
          continue;
        }
        const contentHash = this.hash(file.document.content);
        if (contentHash !== file.contentHash) changes.push({ contentHash, file, kind: "update" });
      }
      if (changes.length === 0) return { changedFiles: 0, commitSha: head.commitSha };
      const tree = [] as Array<{ mode: "100644"; path: string; sha: string | null; type: "blob" }>;
      for (const change of changes) {
        if (change.kind === "delete") {
          tree.push({ mode: "100644", path: change.file.path, sha: null, type: "blob" });
          continue;
        }
        const blob = await this.installationRequest<{ sha?: unknown }>(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/blobs`, "POST", {
          content: change.file.document.content,
          encoding: "utf-8"
        });
        if (typeof blob.sha !== "string" || !this.isSha(blob.sha)) throw new GitHubAppError("GitHub returned an invalid blob response", 502);
        tree.push({ mode: "100644", path: change.file.path, sha: blob.sha, type: "blob" });
      }
      const createdTree = await this.installationRequest<{ sha?: unknown }>(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/trees`, "POST", { base_tree: head.treeSha, tree });
      if (typeof createdTree.sha !== "string" || !this.isSha(createdTree.sha)) throw new GitHubAppError("GitHub returned an invalid tree response", 502);
      const createdCommit = await this.installationRequest<{ sha?: unknown }>(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/commits`, "POST", { message, parents: [head.commitSha], tree: createdTree.sha });
      if (typeof createdCommit.sha !== "string" || !this.isSha(createdCommit.sha)) throw new GitHubAppError("GitHub returned an invalid commit response", 502);
      const commitSha = createdCommit.sha;
      try {
        await this.installationRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/refs/heads/${encodeURIComponent(repository.branch)}`, "PATCH", { force: false, sha: commitSha });
      } catch (error) {
        if (error instanceof GitHubAppError && error.status === 422) throw new GitHubAppError("Remote branch changed. Refresh before committing.", 409);
        throw error;
      }
      await prisma.$transaction(async (transaction) => {
        await transaction.gitHubWorkspaceRepository.update({ data: { lastRemoteCommitSha: commitSha }, where: { id: repository.id } });
        for (const change of changes) {
          if (change.kind === "delete") {
            await transaction.gitHubWorkspaceRepositoryFile.delete({ where: { id: change.file.id } });
            continue;
          }
          const entry = tree.find((treeEntry) => treeEntry.path === change.file.path);
          await transaction.gitHubWorkspaceRepositoryFile.update({
            data: { contentHash: change.contentHash, remoteBlobSha: entry?.sha ?? null },
            where: { id: change.file.id }
          });
        }
      });
      await auditLogService.record({ actorUserId: userId, metadata: { changedFiles: changes.length, commitSha }, type: "github.repository.committed", workspaceId });
      return { changedFiles: changes.length, commitSha };
    });
  }

  private configuration(): GitHubAppConfiguration {
    const appId = process.env.GITHUB_APP_ID?.trim();
    const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
    const slug = process.env.GITHUB_APP_SLUG?.trim();
    if (!appId || !clientId || !clientSecret || !privateKey || !slug || !/^\d+$/.test(appId) || !/^[a-z0-9-]+$/.test(slug)) {
      throw new GitHubAppError("GitHub App is not configured", 503);
    }
    return { appId, clientId, clientSecret, privateKey, slug };
  }

  private async exchangeAuthorizationCode(code: string) {
    if (!code || code.length > 1024) throw new GitHubAppError("GitHub authorization code is invalid", 400);
    const configuration = this.configuration();
    const response = await fetch(githubOauthUrl, {
      body: JSON.stringify({ client_id: configuration.clientId, client_secret: configuration.clientSecret, code }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => null) as { access_token?: unknown } | null;
    if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) throw new GitHubAppError("GitHub authorization could not be completed", 403);
    return body.access_token;
  }

  private async userInstallations(userToken: string) {
    const response = await fetch(`${githubApiUrl}/user/installations?per_page=100`, {
      headers: this.headers(userToken),
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => null) as { installations?: unknown } | null;
    if (!response.ok || !Array.isArray(body?.installations)) throw new GitHubAppError("GitHub installation access could not be verified", 403);
    return new Set(body.installations.flatMap((installation) => {
      if (!installation || typeof installation !== "object") return [];
      const id = (installation as Record<string, unknown>).id;
      return typeof id === "number" || typeof id === "string" ? [String(id)] : [];
    }));
  }

  private async revokeUserToken(userToken: string) {
    const configuration = this.configuration();
    await fetch(`${githubApiUrl}/applications/${encodeURIComponent(configuration.clientId)}/token`, {
      body: JSON.stringify({ access_token: userToken }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString("base64")}`,
        "content-type": "application/json",
        "x-github-api-version": githubApiVersion
      },
      method: "DELETE",
      signal: AbortSignal.timeout(10_000)
    }).catch(() => undefined);
  }

  private async appRequest<T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
    return this.request<T>(this.appJwt(), path, method, body);
  }

  private async installationRequest<T = unknown>(token: string, path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
    return this.request<T>(token, path, method, body);
  }

  private async request<T>(token: string, path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
    const response = await fetch(`${githubApiUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? this.headers(token) : { ...this.headers(token), "content-type": "application/json" },
      method,
      signal: AbortSignal.timeout(15_000)
    });
    const responseBody = await response.json().catch(() => null) as { message?: unknown } | null;
    if (!response.ok) {
      const message = typeof responseBody?.message === "string" && responseBody.message.length < 180 ? responseBody.message : "GitHub request failed";
      throw new GitHubAppError(message, response.status);
    }
    return responseBody as T;
  }

  private async withInstallationToken<T>(installationId: string, repositoryId: bigint | null, operation: (token: string) => Promise<T>) {
    const installation = await prisma.gitHubWorkspaceInstallation.findUnique({ where: { id: installationId } });
    if (!installation) throw new GitHubAppError("GitHub installation is no longer connected", 409);
    if (repositoryId && repositoryId > BigInt(Number.MAX_SAFE_INTEGER)) throw new GitHubAppError("GitHub repository identifier is invalid", 400);
    const tokenResponse = await this.appRequest<{ token?: unknown }>(`/app/installations/${installation.githubInstallationId.toString()}/access_tokens`, "POST", {
      permissions: { contents: "write" },
      repository_ids: repositoryId ? [Number(repositoryId)] : undefined
    });
    if (typeof tokenResponse.token !== "string" || !tokenResponse.token) throw new GitHubAppError("GitHub installation token could not be created", 502);
    try {
      return await operation(tokenResponse.token);
    } finally {
      await fetch(`${githubApiUrl}/installation/token`, { headers: this.headers(tokenResponse.token), method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
  }

  private async readHead(token: string, owner: string, repository: string, branch: string) {
    const reference = await this.installationRequest<{ object?: { sha?: unknown } }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`, "GET");
    if (typeof reference.object?.sha !== "string" || !this.isSha(reference.object.sha)) throw new GitHubAppError("GitHub returned an invalid branch reference", 502);
    const commit = await this.installationRequest<{ tree?: { sha?: unknown } }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${reference.object.sha}`, "GET");
    if (typeof commit.tree?.sha !== "string" || !this.isSha(commit.tree.sha)) throw new GitHubAppError("GitHub returned an invalid commit tree", 502);
    return { commitSha: reference.object.sha, treeSha: commit.tree.sha };
  }

  private async readImportableDocuments(token: string, owner: string, repository: string, branch: string): Promise<ImportedGitHubDocument[]> {
    const head = await this.readHead(token, owner, repository, branch);
    const tree = await this.installationRequest<{ truncated?: unknown; tree?: unknown }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${head.treeSha}?recursive=1`, "GET");
    if (tree.truncated === true || !Array.isArray(tree.tree)) throw new GitHubAppError("Repository tree is too large to import safely", 413);
    const entries = tree.tree.flatMap((entry): GitHubTreeEntry[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.path !== "string" || typeof record.sha !== "string" || typeof record.type !== "string") return [];
      return [{ path: record.path, sha: record.sha, type: record.type }];
    }).filter((entry) => entry.type === "blob" && githubDocumentShape(entry.path));
    const selected = entries.sort((left, right) => left.path.localeCompare(right.path)).slice(0, maxImportedFiles);
    const documents: ImportedGitHubDocument[] = [];
    for (const entry of selected) {
      const blob = await this.installationRequest<{ content?: unknown; encoding?: unknown; size?: unknown }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs/${entry.sha}`, "GET");
      if (blob.encoding !== "base64" || typeof blob.content !== "string" || typeof blob.size !== "number" || blob.size <= 0 || blob.size > maxImportedFileBytes) continue;
      const content = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
      if (content.includes("\u0000") || content.includes("\uFFFD")) continue;
      const shape = githubDocumentShape(entry.path);
      if (!shape) continue;
      documents.push({ content, contentHash: this.hash(content), language: shape.language, path: entry.path, remoteBlobSha: entry.sha, type: shape.type });
    }
    if (documents.length === 0) throw new GitHubAppError("Repository does not contain supported text files within import limits", 400);
    return documents;
  }

  private appJwt() {
    const configuration = this.configuration();
    const now = Math.floor(Date.now() / 1000);
    const header = this.base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = this.base64url(JSON.stringify({ exp: now + 540, iat: now - 60, iss: configuration.appId }));
    const signingInput = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(configuration.privateKey, "base64url")}`;
  }

  private headers(token: string) {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": githubApiVersion
    };
  }

  private repositoryPayload(repository: { branch: string; defaultBranch: string; lastRemoteCommitSha: string | null; name: string; owner: string }) {
    return { branch: repository.branch, defaultBranch: repository.defaultBranch, fullName: `${repository.owner}/${repository.name}`, lastRemoteCommitSha: repository.lastRemoteCommitSha };
  }

  private normalizeCommitMessage(value: string) {
    const message = value.trim();
    if (!message || message.length > 160 || /[\u0000-\u001F\u007F]/.test(message)) throw new GitHubAppError("Commit message is invalid", 400);
    return message;
  }

  private normalizeSha(value: string) {
    const sha = value.trim();
    if (!this.isSha(sha)) throw new GitHubAppError("Remote commit reference is invalid", 400);
    return sha;
  }

  private parseIdentifier(value: string, label: string) {
    if (!/^\d+$/.test(value)) throw new GitHubAppError(`GitHub ${label} identifier is invalid`, 400);
    return BigInt(value);
  }

  private isSha(value: string) {
    return isGitHubCommitSha(value);
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private base64url(value: string) {
    return Buffer.from(value).toString("base64url");
  }
}

export const githubAppService = new GitHubAppService();
