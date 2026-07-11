const restrictedNames = new Set([
  ".aws",
  ".ds_store",
  ".envrc",
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

const secretExtensions = new Set(["key", "p12", "pem", "pfx"]);

const unsupportedExtensions = new Set([
  "7z",
  "aab",
  "ai",
  "apk",
  "app",
  "arrow",
  "avi",
  "avif",
  "avro",
  "bin",
  "bmp",
  "cab",
  "bz2",
  "class",
  "cr2",
  "dat",
  "db",
  "deb",
  "dll",
  "dmg",
  "doc",
  "docm",
  "docx",
  "dotx",
  "ear",
  "eot",
  "epub",
  "exe",
  "feather",
  "fbx",
  "fig",
  "flac",
  "gif",
  "glb",
  "gz",
  "heic",
  "heif",
  "ico",
  "ipa",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "lib",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "msi",
  "nef",
  "npy",
  "npz",
  "numbers",
  "o",
  "obj",
  "odg",
  "odp",
  "ods",
  "odt",
  "ogg",
  "orc",
  "otf",
  "pages",
  "parquet",
  "pdf",
  "pickle",
  "pkl",
  "png",
  "pot",
  "potm",
  "potx",
  "ppt",
  "pptm",
  "pptx",
  "pps",
  "ppsm",
  "ppsx",
  "psd",
  "pyc",
  "rar",
  "raw",
  "rpm",
  "so",
  "sketch",
  "snap",
  "sqlite",
  "sqlite3",
  "stl",
  "swf",
  "svgz",
  "tar",
  "tgz",
  "tif",
  "tiff",
  "ttf",
  "wav",
  "war",
  "wasm",
  "webm",
  "webarchive",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
  "xz",
  "zip",
  "zst"
]);

export function validateAiCreateTargetName(value: string) {
  const name = value.trim().toLowerCase();
  if (!name) return "AI create target name is required";
  if (
    name === ".env"
    || name.startsWith(".env.")
    || restrictedNames.has(name)
    || name.includes("credentials")
    || /(^|[._-])secrets?([._-]|$)/.test(name)
  ) {
    return "AI cannot create secret-bearing files";
  }
  const extension = name.match(/\.([a-z0-9]+)$/)?.[1] ?? null;
  if (extension && secretExtensions.has(extension)) {
    return "AI cannot create secret-bearing files";
  }
  if (extension && unsupportedExtensions.has(extension)) {
    return `AI cannot create .${extension} binary or unsupported files`;
  }
  return null;
}

export function assertAiCreateTargetName(value: string) {
  const error = validateAiCreateTargetName(value);
  if (error) throw new Error(error);
}
