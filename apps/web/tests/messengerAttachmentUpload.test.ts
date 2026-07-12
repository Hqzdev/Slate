import assert from "node:assert/strict";
import test from "node:test";
import { resolveMessengerAttachmentContentType } from "../lib/client/messengerAttachmentPolicy";
import { MessengerAttachmentUploadTransport } from "../lib/client/messengerAttachmentUpload";

class FakeUploadRequest {
  readonly upload = new FakeEventSource();
  readonly events = new FakeEventSource();
  method = "";
  responseText = "<PostResponse><ETag>&quot;etag-from-storage&quot;</ETag></PostResponse>";
  status = 201;
  url = "";
  withCredentials = true;

  abort() {
    this.events.emit("abort", {});
  }

  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener);
  }

  getResponseHeader() {
    return null;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: FormData) {
    assert.equal(body.get("key"), "private-key");
    this.upload.emit("progress", { lengthComputable: true, loaded: 5, total: 10 });
    this.events.emit("load", {});
  }
}

class FakeEventSource {
  private readonly listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
  }
}

test("uploads directly without credentials and reports bounded progress", async () => {
  const request = new FakeUploadRequest();
  const progress: number[] = [];
  const transport = new MessengerAttachmentUploadTransport(() => request as unknown as XMLHttpRequest);
  const etag = await transport.upload({
    expiresAt: "2026-07-11T12:15:00.000Z",
    fields: { key: "private-key" },
    headers: null,
    method: "POST",
    url: "http://storage.test/upload"
  }, new File(["hello"], "hello.txt", { type: "text/plain" }), { onProgress: (value) => progress.push(value) });
  assert.equal(etag, "etag-from-storage");
  assert.equal(request.method, "POST");
  assert.equal(request.url, "http://storage.test/upload");
  assert.equal(request.withCredentials, false);
  assert.deepEqual(progress, [50]);
});

test("infers only allowlisted MIME types when the browser omits File.type", () => {
  assert.equal(resolveMessengerAttachmentContentType({ name: "notes.md", type: "" }), "text/markdown");
  assert.equal(resolveMessengerAttachmentContentType({ name: "report.DOCX", type: "" }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(resolveMessengerAttachmentContentType({ name: "archive.zip", type: "" }), "");
  assert.equal(resolveMessengerAttachmentContentType({ name: "payload.svg", type: "image/svg+xml" }), "image/svg+xml");
});
