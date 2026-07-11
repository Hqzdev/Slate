import assert from "node:assert/strict";
import test from "node:test";
import { AiDomainError } from "../lib/server/ai/errors";
import { GigaChatClient, loadGigaChatConfig, normalizeGigaChatResponse, type GigaChatConfig } from "../lib/server/ai/gigaChatClient";

const config: GigaChatConfig = {
  apiBaseUrl: "https://api.gigachat.test/api/v1",
  authorizationKey: "Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=",
  authUrl: "https://auth.gigachat.test/oauth",
  model: "GigaChat",
  scope: "scope"
};

test("GigaChat config accepts a pre-encoded client credential", () => {
  const authorizationKey = Buffer.from("client-id:client-secret").toString("base64");
  const loaded = loadGigaChatConfig({
    GIGACHAT_API_BASE_URL: config.apiBaseUrl,
    GIGACHAT_AUTH_URL: config.authUrl,
    GIGACHAT_CLIENT_ID: "client-id",
    GIGACHAT_CLIENT_SECRET: authorizationKey,
    GIGACHAT_MODEL: config.model,
    GIGACHAT_SCOPE: config.scope
  });

  assert.equal(loaded.authorizationKey, authorizationKey);
});

test("GigaChat config encodes separate client credentials", () => {
  const loaded = loadGigaChatConfig({
    GIGACHAT_API_BASE_URL: config.apiBaseUrl,
    GIGACHAT_AUTH_URL: config.authUrl,
    GIGACHAT_CLIENT_ID: "client-id",
    GIGACHAT_CLIENT_SECRET: "client-secret",
    GIGACHAT_MODEL: config.model,
    GIGACHAT_SCOPE: config.scope
  });

  assert.equal(loaded.authorizationKey, config.authorizationKey);
});

test("GigaChat normalization preserves function state and arguments", () => {
  assert.deepEqual(normalizeGigaChatResponse({
    choices: [{
      message: {
        content: "",
        function_call: {
          arguments: "{\"documentId\":\"document-1\"}",
          name: "read_document"
        },
        functions_state_id: "state-1"
      }
    }],
    request_id: "request-1"
  }), {
    content: "",
    functionsStateId: "state-1",
    requestId: "request-1",
    toolCalls: [{
      arguments: { documentId: "document-1" },
      id: "function-1",
      name: "read_document"
    }]
  });
});

test("GigaChat normalization drops oversized provider request ids", () => {
  const normalized = normalizeGigaChatResponse({
    choices: [{ message: { content: "Complete" } }],
    request_id: "r".repeat(257)
  });
  assert.equal(normalized.requestId, null);
});

test("GigaChat client caches tokens and serializes function continuation metadata", async () => {
  const calls: { body: unknown; url: string }[] = [];
  const responses = [
    new Response(JSON.stringify({ access_token: "token-1", expires_at: 9_999_999_999_999 }), { status: 200 }),
    new Response(JSON.stringify({
      choices: [{ message: { content: "", function_call: { arguments: { documentId: "document-1" }, name: "read_document" }, functions_state_id: "state-1" } }]
    }), { status: 200 }),
    new Response(JSON.stringify({ choices: [{ message: { content: "Document summary" } }] }), { status: 200 })
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
      url: String(input)
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  };
  const client = new GigaChatClient(config, { fetchImpl, now: () => 1_000, requestId: () => "rq-1", timeoutMs: 1_000 });
  const first = await client.complete({
    messages: [{ content: "Read the file", role: "user" }],
    tools: [{ description: "Read", name: "read_document", parameters: { type: "object" } }]
  });
  const functionCall = first.toolCalls[0];
  const second = await client.complete({
    messages: [
      { content: "Read the file", role: "user" },
      { content: "", functionCall, functionsStateId: first.functionsStateId, role: "assistant" },
      { content: "{\"title\":\"File\"}", name: functionCall.name, toolCallId: functionCall.id, role: "tool" }
    ],
    tools: [{ description: "Read", name: "read_document", parameters: { type: "object" } }]
  });

  assert.equal(second.content, "Document summary");
  assert.equal(calls.filter((call) => call.url === config.authUrl).length, 1);
  const continuationBody = calls[2].body as { functions_state_id?: unknown; messages: Record<string, unknown>[] };
  assert.equal(continuationBody.functions_state_id, undefined);
  assert.deepEqual(continuationBody.messages[1], {
    content: "",
    function_call: { arguments: { documentId: "document-1" }, name: "read_document" },
    functions_state_id: "state-1",
    role: "assistant"
  });
  assert.deepEqual(continuationBody.messages[2], {
    content: "{\"title\":\"File\"}",
    name: "read_document",
    role: "function"
  });
});

test("GigaChat normalization rejects malformed tool arguments", () => {
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{ message: { content: "", function_call: { arguments: "not-json", name: "read_document" } } }]
  }), /malformed tool arguments/);
});

test("GigaChat normalization rejects incomplete and blocked completions", () => {
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{ finish_reason: "length", message: { content: "Truncated" } }]
  }), /stopped with length/);
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{ finish_reason: "blacklist", message: { content: "Blocked" } }]
  }), /blocked the completion/);
});

test("GigaChat normalization rejects database-unsafe assistant text", () => {
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{ message: { content: "before\u0000after" } }]
  }), /unsupported text/);
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{ message: { content: "before\ud800after" } }]
  }), /unsupported text/);
});

test("GigaChat normalization rejects oversized function continuation state", () => {
  assert.throws(() => normalizeGigaChatResponse({
    choices: [{
      message: {
        content: "",
        function_call: { arguments: {}, name: "read_document" },
        functions_state_id: "s".repeat(4_097)
      }
    }]
  }), /invalid function state/);
});

test("GigaChat client reports a trusted certificate setup error", async () => {
  const certificateError = new Error("fetch failed", { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } });
  const fetchImpl: typeof fetch = async () => {
    throw certificateError;
  };
  const client = new GigaChatClient(config, { fetchImpl, timeoutMs: 1_000 });

  await assert.rejects(
    () => client.complete({ messages: [{ content: "Hello", role: "user" }], tools: [] }),
    (error: unknown) => error instanceof Error && error.message.includes("NODE_EXTRA_CA_CERTS")
  );
});

test("GigaChat client keeps its timeout active while reading a response body", async () => {
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{\"access_token\":"));
        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      }
    });
    return new Response(body, { status: 200 });
  };
  const client = new GigaChatClient(config, { fetchImpl, timeoutMs: 20 });

  await assert.rejects(
    () => client.complete({ messages: [{ content: "Hello", role: "user" }], tools: [] }),
    (error: unknown) => error instanceof Error && error.message.includes("timed out")
  );
});

test("GigaChat client stops reading an oversized chunked response", async () => {
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("x".repeat(64_001)));
      controller.close();
    }
  }), { status: 200 });
  const client = new GigaChatClient(config, { fetchImpl, timeoutMs: 1_000 });

  await assert.rejects(
    () => client.complete({ messages: [{ content: "Hello", role: "user" }], tools: [] }),
    (error: unknown) => error instanceof AiDomainError && error.code === "provider_response_too_large"
  );
});
