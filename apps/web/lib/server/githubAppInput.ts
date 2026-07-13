import { type DocumentType } from "@prisma/client";

const languageByExtension = new Map<string, string>([
  [".c", "c"], [".cpp", "cpp"], [".cs", "csharp"], [".css", "css"], [".go", "go"], [".html", "html"], [".java", "java"], [".js", "javascript"], [".json", "json"], [".jsx", "javascript"], [".kt", "kotlin"], [".md", "markdown"], [".mdx", "markdown"], [".php", "php"], [".py", "python"], [".rb", "ruby"], [".rs", "rust"], [".scss", "scss"], [".sh", "shell"], [".sql", "sql"], [".swift", "swift"], [".toml", "toml"], [".ts", "typescript"], [".tsx", "typescript"], [".vue", "vue"], [".xml", "xml"], [".yaml", "yaml"], [".yml", "yaml"]
]);

export class GitHubAppError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function normalizeGitHubBranch(value: string) {
  const branch = value.trim();
  if (!branch || branch.length > 120 || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(branch)) throw new GitHubAppError("GitHub branch is invalid", 400);
  return branch;
}

export function githubDocumentShape(path: string): { language: string | null; type: DocumentType } | null {
  if (!path || path.length > 240 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const extensionIndex = path.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? path.slice(extensionIndex).toLowerCase() : "";
  const language = languageByExtension.get(extension);
  if (!language) return null;
  return { language, type: extension === ".md" || extension === ".mdx" ? "note" : "code" };
}

export function isGitHubCommitSha(value: string) {
  return /^[0-9a-f]{40,64}$/i.test(value);
}
