import assert from "node:assert/strict";
import test from "node:test";
import { AiDomainError } from "../lib/server/ai/errors";
import { hashDocumentContent } from "../lib/server/ai/documentUpdateDraft";
import { RealtimeDocumentUpdateClient, type RealtimeDocumentUpdateInput } from "../lib/server/ai/realtimeDocumentUpdateClient";

const input: RealtimeDocumentUpdateInput = {
  actionId: "action-1",
  content: "updated",
  documentId: "document-1",
  documentType: "code",
  expectedContentHash: hashDocumentContent("original"),
  roomName: "slate:room:workspace-1:file:document-1",
  workspaceId: "workspace-1"
};
const secret = "internal-sync-secret-32-characters";

test("realtime update client sends the internal text replacement contract", async () => {
  const requests: { body: string; headers: Headers; url: string }[] = [];
  const client = new RealtimeDocumentUpdateClient({
    fetchImpl: async (url, init) => {
      requests.push({
        body: String(init?.body),
        headers: new Headers(init?.headers),
        url: String(url)
      });
      return new Response(JSON.stringify({
        actionId: input.actionId,
        applied: true,
        contentHash: hashDocumentContent(input.content),
        documentId: input.documentId,
        documentType: input.documentType,
        roomName: input.roomName
      }), { status: 200 });
    },
    secret,
    url: "http://sync:1234/"
  });

  const result = await client.applyTextReplacement(input);
  const request = requests[0];

  assert.equal(result.applied, true);
  assert.equal(request.url, "http://sync:1234/internal/realtime/text-replace");
  assert.equal(request.headers.get("authorization"), `Bearer ${secret}`);
  assert.deepEqual(JSON.parse(request.body), input);
});

test("realtime update client maps live state conflicts", async () => {
  const client = new RealtimeDocumentUpdateClient({
    fetchImpl: async () => new Response(JSON.stringify({
      currentContentHash: hashDocumentContent("changed"),
      error: "document_changed"
    }), { status: 409 }),
    secret
  });

  await assert.rejects(
    () => client.applyTextReplacement(input),
    (error) => error instanceof AiDomainError && error.code === "document_version_conflict" && error.status === 409
  );
});

test("realtime update client rejects conflicting durable receipts", async () => {
  const client = new RealtimeDocumentUpdateClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: "idempotency_conflict" }), { status: 409 }),
    secret
  });

  await assert.rejects(
    () => client.applyTextReplacement(input),
    (error) => error instanceof AiDomainError && error.code === "realtime_idempotency_conflict" && error.status === 409
  );
});

test("realtime update client treats service failures as retryable", async () => {
  const client = new RealtimeDocumentUpdateClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: "persistence_failed" }), { status: 503 }),
    secret
  });

  await assert.rejects(
    () => client.applyTextReplacement(input),
    (error) => error instanceof AiDomainError && error.code === "realtime_update_unavailable" && error.retryable
  );
});
