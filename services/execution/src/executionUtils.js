export function safeFileName(value) {
  const fileName = typeof value === "string" && value.trim() ? value.trim() : "main.js";
  const normalized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs") ? normalized : `${normalized}.js`;
}

export function formatRunOutput({ command, duration, environmentId, outputLimit, result }) {
  return [
    command,
    `environment=${environmentId}`,
    `duration=${duration}`,
    `exitCode=${result.timedOut ? "timeout" : result.code}`,
    result.outputTruncated ? `output=truncated:${outputLimit}` : null,
    result.stdout.trim(),
    result.stderr.trim()
  ].filter(Boolean).join("\n");
}

export function classifyProcessFailure(result, fallback) {
  if (result.timedOut) return "Run timed out";
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes("enoent") || stderr.includes("command not found")) return "Execution runtime unavailable";
  if (stderr.includes("no such image") || stderr.includes("unable to find image")) return "Execution image unavailable";
  if (stderr.includes("cannot connect to the docker daemon") || stderr.includes("docker daemon")) return "Docker daemon unavailable";
  return result.code === 0 ? null : fallback;
}

export function staleRunCutoff(now, staleRunMs) {
  return new Date(now.getTime() - staleRunMs);
}
