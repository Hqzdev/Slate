import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type ImportedWorkspaceDocument } from "@/lib/server/workspaceRepository";

const execFileAsync = promisify(execFile);
const cloneTimeoutMs = 15000;
const maxImportedFiles = 25;
const maxFileSizeBytes = 80 * 1024;
const maxScannedFiles = 500;
const maxGitUrlLength = 240;

const skippedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);

const skippedFiles = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
]);

const languageByExtension = new Map<string, string>([
  [".c", "c"],
  [".cpp", "cpp"],
  [".cs", "csharp"],
  [".css", "css"],
  [".go", "go"],
  [".html", "html"],
  [".java", "java"],
  [".js", "javascript"],
  [".json", "json"],
  [".jsx", "javascript"],
  [".kt", "kotlin"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".php", "php"],
  [".py", "python"],
  [".rb", "ruby"],
  [".rs", "rust"],
  [".scss", "scss"],
  [".sh", "shell"],
  [".sql", "sql"],
  [".swift", "swift"],
  [".toml", "toml"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".vue", "vue"],
  [".xml", "xml"],
  [".yaml", "yaml"],
  [".yml", "yaml"]
]);

export class GitImportService {
  async importRepository(url: string): Promise<{ documents: ImportedWorkspaceDocument[]; summary: { importedFiles: number; scannedFiles: number; skippedFiles: number } }> {
    const repositoryUrl = this.normalizeUrl(url);
    const checkoutPath = await mkdtemp(path.join(tmpdir(), "slate-git-import-"));

    try {
      await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", repositoryUrl, checkoutPath], {
        maxBuffer: 1024 * 1024,
        timeout: cloneTimeoutMs
      });

      const result = await this.collectFiles(checkoutPath);
      const documents = await this.readDocuments(checkoutPath, result.files);

      if (documents.length === 0) {
        throw new Error("Repository does not contain supported text files within import limits");
      }

      return {
        documents,
        summary: {
          importedFiles: documents.length,
          scannedFiles: result.scannedFiles,
          skippedFiles: Math.max(0, result.scannedFiles - documents.length)
        }
      };
    } finally {
      await rm(checkoutPath, { force: true, recursive: true });
    }
  }

  private normalizeUrl(value: string) {
    const trimmedValue = value.trim();

    if (trimmedValue.length === 0) {
      throw new Error("Git URL is required");
    }

    if (trimmedValue.length > maxGitUrlLength) {
      throw new Error("Git URL is too long");
    }

    let url: URL;
    try {
      url = new URL(trimmedValue);
    } catch {
      throw new Error("Git URL must be a valid HTTPS GitHub URL");
    }

    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) {
      throw new Error("Only public HTTPS GitHub repository URLs are supported");
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
      throw new Error("GitHub URL must include owner and repository");
    }

    const owner = this.cleanGitHubSegment(segments[0]);
    const repository = this.cleanGitHubSegment(segments[1].replace(/\.git$/, ""));

    return `https://github.com/${owner}/${repository}.git`;
  }

  private cleanGitHubSegment(segment: string) {
    if (!/^[A-Za-z0-9_.-]+$/.test(segment)) {
      throw new Error("GitHub URL contains invalid owner or repository name");
    }

    return segment;
  }

  private async collectFiles(rootPath: string) {
    const files: string[] = [];
    let scannedFiles = 0;

    const visit = async (directoryPath: string) => {
      if (files.length >= maxImportedFiles || scannedFiles >= maxScannedFiles) return;

      const entries = await readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (files.length >= maxImportedFiles || scannedFiles >= maxScannedFiles) return;
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          if (!skippedDirectories.has(entry.name)) {
            await visit(entryPath);
          }
          continue;
        }

        if (!entry.isFile()) continue;
        scannedFiles += 1;

        if (skippedFiles.has(entry.name)) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!languageByExtension.has(extension)) continue;

        const fileStat = await stat(entryPath);
        if (fileStat.size === 0 || fileStat.size > maxFileSizeBytes) continue;

        files.push(entryPath);
      }
    };

    await visit(rootPath);
    return { files, scannedFiles };
  }

  private async readDocuments(rootPath: string, files: string[]): Promise<ImportedWorkspaceDocument[]> {
    const documents: ImportedWorkspaceDocument[] = [];

    for (const filePath of files) {
      const contentBuffer = await readFile(filePath);
      if (contentBuffer.includes(0)) continue;

      const content = contentBuffer.toString("utf8");
      if (content.includes("\uFFFD")) continue;

      const relativePath = path.relative(rootPath, filePath).split(path.sep).join("/");
      const extension = path.extname(filePath).toLowerCase();
      const language = languageByExtension.get(extension) ?? null;

      documents.push({
        content,
        language,
        title: this.compactTitle(relativePath),
        type: extension === ".md" || extension === ".mdx" ? "note" : "code"
      });
    }

    return documents;
  }

  private compactTitle(title: string) {
    if (title.length <= 120) return title;
    return `...${title.slice(-117)}`;
  }
}

export const gitImportService = new GitImportService();
