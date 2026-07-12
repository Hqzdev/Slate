import { MessengerClientError } from "./messengerClient";
import type { MessengerUploadOperation } from "./messengerTypes";

type UploadRequestFactory = () => XMLHttpRequest;

export class MessengerAttachmentUploadTransport {
  constructor(private readonly requestFactory: UploadRequestFactory = () => new XMLHttpRequest()) {}

  upload(
    operation: MessengerUploadOperation,
    file: File,
    options: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {}
  ) {
    return new Promise<string>((resolve, reject) => {
      const request = this.requestFactory();
      const abort = () => request.abort();
      const finish = (callback: () => void) => {
        options.signal?.removeEventListener("abort", abort);
        callback();
      };
      request.open(operation.method, operation.url, true);
      request.withCredentials = false;
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        options.onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100)));
      });
      request.addEventListener("load", () => {
        if (request.status < 200 || request.status >= 300) {
          finish(() => reject(uploadError("upload_failed", "Attachment upload failed", request.status)));
          return;
        }
        const etag = readEtag(request);
        if (!etag) {
          finish(() => reject(uploadError("upload_response_invalid", "Attachment storage returned an invalid response", request.status)));
          return;
        }
        finish(() => resolve(etag));
      });
      request.addEventListener("error", () => finish(() => reject(uploadError("network_error", "Attachment storage could not be reached", 0))));
      request.addEventListener("abort", () => finish(() => reject(new DOMException("Attachment upload was cancelled", "AbortError"))));
      if (options.signal?.aborted) {
        request.abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      const form = new FormData();
      for (const [name, value] of Object.entries(operation.fields)) form.append(name, value);
      form.append("file", file, file.name);
      request.send(form);
    });
  }
}

function readEtag(request: XMLHttpRequest) {
  const header = request.getResponseHeader("etag")?.trim().replace(/^"|"$/gu, "");
  if (header && header.length <= 1_024) return header;
  const match = /<ETag>\s*&quot;?([^<&"]+)&quot;?\s*<\/ETag>/iu.exec(request.responseText)
    ?? /<ETag>\s*"?([^<"]+)"?\s*<\/ETag>/iu.exec(request.responseText);
  const value = match?.[1]?.trim();
  return value && value.length <= 1_024 ? value : null;
}

function uploadError(code: string, message: string, status: number) {
  return new MessengerClientError({
    code,
    message,
    requestId: null,
    retryAfterMs: null,
    retryable: true,
    status
  });
}

export const messengerAttachmentUploadTransport = new MessengerAttachmentUploadTransport();
