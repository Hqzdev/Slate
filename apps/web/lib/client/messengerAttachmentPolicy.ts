const typeLimits = new Map([
  ["application/json", 50 * 1024 * 1024],
  ["application/pdf", 50 * 1024 * 1024],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", 50 * 1024 * 1024],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 50 * 1024 * 1024],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", 50 * 1024 * 1024],
  ["image/gif", 20 * 1024 * 1024],
  ["image/jpeg", 20 * 1024 * 1024],
  ["image/png", 20 * 1024 * 1024],
  ["image/webp", 20 * 1024 * 1024],
  ["text/csv", 50 * 1024 * 1024],
  ["text/markdown", 50 * 1024 * 1024],
  ["text/plain", 50 * 1024 * 1024],
  ["video/mp4", 250 * 1024 * 1024],
  ["video/webm", 250 * 1024 * 1024]
]);

const extensionTypes = new Map([
  ["csv", "text/csv"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["json", "application/json"],
  ["md", "text/markdown"],
  ["mp4", "video/mp4"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["txt", "text/plain"],
  ["webm", "video/webm"],
  ["webp", "image/webp"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
]);

export const messengerAttachmentAccept = [...typeLimits.keys()].join(",");

export function messengerAttachmentTypeLimit(contentType: string) {
  return typeLimits.get(contentType) ?? null;
}

export function resolveMessengerAttachmentContentType(file: Pick<File, "name" | "type">) {
  if (typeLimits.has(file.type)) return file.type;
  if (file.type) return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return extensionTypes.get(extension) ?? "";
}
