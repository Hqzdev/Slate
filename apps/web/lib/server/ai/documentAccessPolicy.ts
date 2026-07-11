const restrictedNames = new Set([
  ".aws",
  ".gnupg",
  ".kube",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".ssh",
  "credentials.json",
  "id_ed25519",
  "id_rsa",
  "secrets.json"
]);

const restrictedExtensions = [".key", ".p12", ".pem", ".pfx"];

export function isAiReadableDocumentName(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
  if (!name) return false;
  if (name === ".env" || name.startsWith(".env.")) return false;
  if (restrictedNames.has(name)) return false;
  if (name.includes("credentials") || name.includes("secrets")) return false;
  return !restrictedExtensions.some((extension) => name.endsWith(extension));
}

export type AiDocumentFileNode = {
  id: string;
  name: string;
  parentId: string | null;
};

export function isAiReadableFileNode(node: AiDocumentFileNode, nodesById: ReadonlyMap<string, AiDocumentFileNode>) {
  if (!isAiReadableDocumentName(node.name)) return false;
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  let depth = 0;
  while (parentId) {
    if (visited.has(parentId) || depth >= 32) return false;
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent || !isAiReadableDocumentName(parent.name)) return false;
    parentId = parent.parentId;
    depth += 1;
  }
  return true;
}
