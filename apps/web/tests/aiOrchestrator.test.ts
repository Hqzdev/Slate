import assert from "node:assert/strict";
import test from "node:test";
import { AiDomainError } from "../lib/server/ai/errors";
import { hashDocumentContent } from "../lib/server/ai/documentUpdateDraft";
import { AiOrchestrator, aiProviderTools } from "../lib/server/ai/orchestrator";
import type { AiProvider, AiProviderRequest, AiProviderResponse } from "../lib/server/ai/types";
import type { WorkspaceContextBuilder } from "../lib/server/ai/workspaceContextBuilder";

class QueueProvider implements AiProvider {
  readonly requests: AiProviderRequest[] = [];

  constructor(private readonly responses: AiProviderResponse[]) {}

  async complete(request: AiProviderRequest) {
    this.requests.push({
      ...request,
      messages: structuredClone(request.messages),
      tools: structuredClone(request.tools)
    });
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected provider request");
    return response;
  }
}

function response(content: string, toolCalls: AiProviderResponse["toolCalls"] = [], functionsStateId: string | null = null): AiProviderResponse {
  return {
    content,
    functionsStateId,
    requestId: "provider-request",
    toolCalls
  };
}

function contextBuilder() {
  return {
    async listWorkspaceFiles() {
      return JSON.stringify({ files: [] });
    },
    async readDocument() {
      return JSON.stringify({ content: "document" });
    }
  } as unknown as WorkspaceContextBuilder;
}

test("AI tool schemas stay compatible with GigaChat function validation", () => {
  assert.doesNotMatch(JSON.stringify(aiProviderTools), /"anyOf"/);
  for (const tool of aiProviderTools) {
    assertDescribedProperties(tool.parameters);
  }
});

test("ask mode exposes read tools only and rejects a forged write call", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: "unsafe", parentId: null, title: "unsafe.md" },
      id: "forged-write",
      name: "create_note"
    }])
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  await assert.rejects(
    () => orchestrator.run({
      context: "{}",
      history: [],
      mode: "ask",
      ownerUserId: "viewer-1",
      userContent: "What should I change?",
      workspaceId: "workspace-1"
    }),
    (error: unknown) => error instanceof AiDomainError && error.code === "unsupported_tool"
  );
  assert.deepEqual(provider.requests[0].tools.map((tool) => tool.name), ["list_workspace_files", "read_document"]);
});

test("plan mode returns an executable plan without drafts", async () => {
  const provider = new QueueProvider([response("1. Read app.ts\n2. Run typecheck")]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    mode: "plan",
    ownerUserId: "viewer-1",
    userContent: "Plan the refactor",
    workspaceId: "workspace-1"
  });
  assert.equal(result.drafts.length, 0);
  assert.match(result.content, /Run typecheck/);
  assert.match(provider.requests[0].messages[0].content, /executable plan only/);
});

function assertDescribedProperties(schema: Record<string, unknown>) {
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const property of Object.values(properties)) {
      assert.ok(property && typeof property === "object" && !Array.isArray(property));
      const propertySchema = property as Record<string, unknown>;
      assert.equal(typeof propertySchema.description, "string");
      assert.equal(typeof propertySchema.type, "string");
      assertDescribedProperties(propertySchema);
    }
  }
  const items = schema.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    const itemSchema = items as Record<string, unknown>;
    assert.equal(typeof itemSchema.description, "string");
    assert.equal(typeof itemSchema.type, "string");
    assertDescribedProperties(itemSchema);
  }
}

test("AI orchestrator keeps writes as drafts and continues GigaChat function state", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: {
        columns: ["Task", "Owner"],
        parentId: null,
        rows: [["Build", "Team"]],
        title: "tasks"
      },
      id: "function-1",
      name: "create_table_note"
    }], "state-1"),
    response("I prepared a task table for review.")
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Create a task table",
    workspaceId: "workspace-1"
  });

  assert.equal(result.content, "I prepared a task table for review.");
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].type, "create_table_note");
  assert.deepEqual(result.drafts[0].payload, {
    columns: ["Task", "Owner"],
    parentId: null,
    rows: [["Build", "Team"]],
    title: "tasks.md"
  });
  const firstRequestSystemMessages = provider.requests[0].messages.filter((message) => message.role === "system");
  assert.equal(firstRequestSystemMessages.length, 1);
  assert.doesNotMatch(firstRequestSystemMessages[0].content, /Workspace context follows/);
  assert.match(provider.requests[0].messages.at(-1)?.content ?? "", /<workspace_context>\n\{\}\n<\/workspace_context>/);
  const continuation = provider.requests[1].messages;
  assert.deepEqual(continuation.at(-2), {
    content: "",
    functionCall: {
      arguments: {
        columns: ["Task", "Owner"],
        parentId: null,
        rows: [["Build", "Team"]],
        title: "tasks"
      },
      id: "function-1",
      name: "create_table_note"
    },
    functionsStateId: "state-1",
    role: "assistant"
  });
  assert.deepEqual(continuation.at(-1), {
    content: JSON.stringify({ accepted: true, draftIndex: 0, requiresUserApply: true }),
    name: "create_table_note",
    toolCallId: "function-1",
    role: "tool"
  });
});

test("AI orchestrator returns validation feedback and accepts a corrected draft", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: "Unsafe", parentId: null, title: "folder/note" },
      id: "function-1",
      name: "create_note"
    }], "state-1"),
    response("", [{
      arguments: { content: "Safe", parentId: null, title: "note" },
      id: "function-2",
      name: "create_note"
    }], "state-2"),
    response("The note draft is ready.")
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Create a note",
    workspaceId: "workspace-1"
  });

  assert.equal(result.drafts.length, 1);
  assert.deepEqual(result.drafts[0], {
    payload: { content: "Safe", parentId: null, title: "note.md" },
    type: "create_note"
  });
  const validationResult = provider.requests[1].messages.at(-1)?.content ?? "";
  assert.match(validationResult, /"accepted":false/);
  assert.match(validationResult, /path separators/);
});

test("AI orchestrator enforces an aggregate UTF-8 draft budget", async () => {
  const largeContent = "界".repeat(12_000);
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: largeContent, parentId: null, title: "first" },
      id: "function-1",
      name: "create_note"
    }]),
    response("", [{
      arguments: { content: largeContent, parentId: null, title: "second" },
      id: "function-2",
      name: "create_note"
    }]),
    response("Only the first draft fits the request limit.")
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Create two notes",
    workspaceId: "workspace-1"
  });

  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].type, "create_note");
  assert.match(provider.requests[2].messages.at(-1)?.content ?? "", /"accepted":false/);
  assert.match(provider.requests[2].messages.at(-1)?.content ?? "", /maximum size/);
});

test("AI orchestrator rejects a tool call too large to continue safely", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: "x".repeat(66_000), parentId: null, title: "large" },
      id: "function-1",
      name: "create_note"
    }])
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());

  await assert.rejects(
    () => orchestrator.run({
      context: "{}",
      history: [],
      ownerUserId: "user-1",
      userContent: "Create a very large note",
      workspaceId: "workspace-1"
    }),
    (error: unknown) => error instanceof AiDomainError && error.code === "provider_tool_payload_too_large"
  );
  assert.equal(provider.requests.length, 1);
});

test("AI orchestrator bounds the full function continuation message", async () => {
  const provider = new QueueProvider([
    response("x".repeat(100_000), [{
      arguments: {},
      id: "function-1",
      name: "list_workspace_files"
    }])
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());

  await assert.rejects(
    () => orchestrator.run({
      context: "{}",
      history: [],
      ownerUserId: "user-1",
      userContent: "List files",
      workspaceId: "workspace-1"
    }),
    (error: unknown) => error instanceof AiDomainError && error.code === "ai_tool_context_limit"
  );
  assert.equal(provider.requests.length, 1);
});

test("AI orchestrator lets the model recover from an unavailable document", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { documentId: "missing-document" },
      id: "function-1",
      name: "read_document"
    }]),
    response("The document is no longer available.")
  ]);
  const unavailableContextBuilder = {
    async listWorkspaceFiles() {
      return JSON.stringify({ files: [] });
    },
    async readDocument() {
      throw new AiDomainError("document_not_found", "Document not found in this workspace", 404);
    }
  } as unknown as WorkspaceContextBuilder;
  const orchestrator = new AiOrchestrator(provider, unavailableContextBuilder);
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Read the missing document",
    workspaceId: "workspace-1"
  });

  assert.equal(result.content, "The document is no longer available.");
  assert.match(provider.requests[1].messages.at(-1)?.content ?? "", /"found":false/);
});

test("AI orchestrator truncates assistant text without splitting a surrogate pair", async () => {
  const provider = new QueueProvider([response(`${"a".repeat(11_999)}😀`)]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Respond",
    workspaceId: "workspace-1"
  });

  assert.equal(result.content, "a".repeat(11_999));
});

test("AI orchestrator enriches update_document from a complete observation", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: "const ready = true;", documentId: "document-1" },
      id: "function-1",
      name: "update_document"
    }]),
    response("The document update is ready for review.")
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    observations: [{
      complete: true,
      content: "const ready = false;",
      id: "document-1",
      title: "status.ts",
      type: "code",
      updatedAt: "2026-07-10T12:00:00.000Z"
    }],
    ownerUserId: "user-1",
    userContent: "Enable ready in status.ts",
    workspaceId: "workspace-1"
  });

  assert.equal(result.drafts.length, 1);
  assert.deepEqual(result.drafts[0], {
    payload: {
      content: "const ready = true;",
      diffPreview: "@@ -1,1 +1,1 @@\n- const ready = false;\n+ const ready = true;",
      diffTruncated: false,
      documentId: "document-1",
      documentType: "code",
      expectedContentHash: hashDocumentContent("const ready = false;"),
      expectedUpdatedAt: "2026-07-10T12:00:00.000Z",
      resultContentHash: hashDocumentContent("const ready = true;"),
      title: "status.ts"
    },
    type: "update_document"
  });
});

test("AI orchestrator rejects updates without a complete text observation", async () => {
  const provider = new QueueProvider([
    response("", [{
      arguments: { content: "replacement", documentId: "document-1" },
      id: "function-1",
      name: "update_document"
    }]),
    response("I need the full document before preparing an update.")
  ]);
  const orchestrator = new AiOrchestrator(provider, contextBuilder());
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    observations: [{
      complete: false,
      content: "partial",
      id: "document-1",
      title: "large.md",
      type: "note",
      updatedAt: "2026-07-10T12:00:00.000Z"
    }],
    ownerUserId: "user-1",
    userContent: "Replace the document",
    workspaceId: "workspace-1"
  });

  assert.equal(result.drafts.length, 0);
  assert.match(provider.requests[1].messages.at(-1)?.content ?? "", /read in full/);
});

test("read_document records a complete observation for a later update", async () => {
  const provider = new QueueProvider([
    response("", [{ arguments: { documentId: "document-2" }, id: "function-1", name: "read_document" }]),
    response("", [{
      arguments: { content: "# Updated", documentId: "document-2" },
      id: "function-2",
      name: "update_document"
    }]),
    response("The note update is ready.")
  ]);
  const observedContextBuilder = {
    async listWorkspaceFiles() {
      return JSON.stringify({ files: [] });
    },
    async readDocumentObservation() {
      return {
        observation: {
          complete: true,
          content: "# Original",
          id: "document-2",
          title: "plan.md",
          type: "note" as const,
          updatedAt: "2026-07-10T12:00:00.000Z"
        },
        prompt: JSON.stringify({ content: "# Original", id: "document-2", truncated: false })
      };
    }
  } as unknown as WorkspaceContextBuilder;
  const orchestrator = new AiOrchestrator(provider, observedContextBuilder);
  const result = await orchestrator.run({
    context: "{}",
    history: [],
    ownerUserId: "user-1",
    userContent: "Update plan.md",
    workspaceId: "workspace-1"
  });

  assert.equal(result.drafts[0]?.type, "update_document");
  assert.equal((result.drafts[0]?.payload as { documentId: string }).documentId, "document-2");
});
