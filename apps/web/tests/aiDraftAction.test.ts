import assert from "node:assert/strict";
import test from "node:test";
import { materializeAiDraftAction, parseAiDraftActionPayload, summarizeAiDraftActionPayload } from "../lib/ai/draftAction";
import { createTextDiffPreview, createUpdateDocumentDraft, hashDocumentContent } from "../lib/server/ai/documentUpdateDraft";

test("create_document materializes a code document with inferred language", () => {
  const payload = parseAiDraftActionPayload("create_document", {
    content: "export const ready = true",
    parentId: "folder-1",
    title: "status.ts"
  });
  assert.deepEqual(payload, {
    content: "export const ready = true",
    parentId: "folder-1",
    title: "status.ts"
  });
  assert.deepEqual(materializeAiDraftAction("create_document", payload), {
    canvasState: null,
    content: "export const ready = true",
    language: "typescript",
    parentId: "folder-1",
    title: "status.ts",
    type: "code"
  });
});

test("create_document rejects note and canvas extensions", () => {
  assert.throws(
    () => parseAiDraftActionPayload("create_document", { content: "# Note", title: "note.md" }),
    /cannot create note or canvas files/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_document", { content: "", title: "flow.canvas" }),
    /cannot create note or canvas files/
  );
});

test("create_note normalizes a markdown filename and optional parent", () => {
  const payload = parseAiDraftActionPayload("create_note", {
    content: "# Release plan",
    title: "release-plan"
  });
  assert.deepEqual(payload, {
    content: "# Release plan",
    parentId: null,
    title: "release-plan.md"
  });
  assert.deepEqual(materializeAiDraftAction("create_note", payload), {
    canvasState: null,
    content: "# Release plan",
    language: null,
    parentId: null,
    title: "release-plan.md",
    type: "note"
  });
});

test("payload parsing rejects unknown fields and unsafe titles", () => {
  assert.throws(
    () => parseAiDraftActionPayload("create_note", { content: "text", extra: true, title: "note" }),
    /unknown field extra/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_note", { content: "text", title: "folder\/note" }),
    /path separators/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_note", { content: "text", parentId: "folder id", title: "note" }),
    /cannot contain whitespace/
  );
});

test("payload parsing rejects PostgreSQL-unsafe Unicode", () => {
  assert.throws(
    () => parseAiDraftActionPayload("create_note", { content: "before\u0000after", title: "note" }),
    /unsupported characters/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_note", { content: "before\ud800after", title: "note" }),
    /unsupported characters/
  );
  assert.equal(
    parseAiDraftActionPayload("create_note", { content: "valid 😀", title: "note" }).content,
    "valid 😀"
  );
});

test("create_table_note renders deterministic escaped GFM", () => {
  const payload = parseAiDraftActionPayload("create_table_note", {
    columns: ["Task|Risk", "Owner"],
    rows: [["<verify>\nA|B", "API\\Core"]],
    title: "tasks"
  });
  const materialized = materializeAiDraftAction("create_table_note", payload);
  assert.equal(materialized.title, "tasks.md");
  assert.equal(materialized.type, "note");
  assert.equal(
    materialized.content,
    "| Task\\|Risk | Owner |\n| --- | --- |\n| &lt;verify&gt;<br>A\\|B | API\\\\Core |"
  );
});

test("create_table_note rejects duplicate columns and ragged rows", () => {
  assert.throws(
    () => parseAiDraftActionPayload("create_table_note", {
      columns: ["Owner", "owner"],
      rows: [],
      title: "tasks"
    }),
    /columns must be unique/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_table_note", {
      columns: ["Task", "Owner"],
      rows: [["Build"]],
      title: "tasks"
    }),
    /must contain exactly 2 cells/
  );
});

test("create_canvas_diagram compiles deterministic native canvas state", () => {
  const payload = parseAiDraftActionPayload("create_canvas_diagram", {
    edges: [{ from: "web", label: "calls", to: "api" }],
    nodes: [
      { key: "web", label: "Web app" },
      { key: "api", kind: "decision", label: "API gateway" }
    ],
    title: "architecture"
  });
  assert.deepEqual(payload, {
    edges: [{ from: "web", label: "calls", to: "api" }],
    nodes: [
      { key: "web", kind: "process", label: "Web app" },
      { key: "api", kind: "decision", label: "API gateway" }
    ],
    parentId: null,
    title: "architecture.canvas"
  });
  const first = materializeAiDraftAction("create_canvas_diagram", payload);
  const second = materializeAiDraftAction("create_canvas_diagram", payload);
  assert.deepEqual(first, second);
  assert.equal(first.type, "canvas");
  assert.equal(first.content, "");
  assert.equal(first.language, null);
  const state = first.canvasState as {
    gridSize: number;
    shapeTombstones: object;
    shapes: Array<Record<string, unknown>>;
    snapToGrid: boolean;
    version: number;
    viewport: object;
  };
  assert.equal(state.version, 1);
  assert.equal(state.gridSize, 24);
  assert.equal(state.snapToGrid, true);
  assert.deepEqual(state.shapeTombstones, {});
  assert.deepEqual(state.viewport, { panX: 80, panY: 80, zoom: 1 });
  assert.equal(state.shapes.length, 3);
  assert.equal(state.shapes[0].id, "edge_1");
  assert.equal(state.shapes[0].type, "arrow");
  assert.equal(state.shapes[1].id, "node_1");
  assert.equal(state.shapes[1].type, "rectangle");
  assert.equal(state.shapes[2].id, "node_2");
  assert.equal(state.shapes[2].type, "diamond");
  for (const shape of state.shapes) {
    assert.equal(shape.clientId, "ai-draft");
    assert.equal(shape.revision, 0);
    assert.equal(shape.updatedAt, 0);
  }
});

test("create_canvas_diagram rejects invalid graph semantics", () => {
  assert.throws(
    () => parseAiDraftActionPayload("create_canvas_diagram", {
      edges: [],
      nodes: [
        { key: "api", label: "API" },
        { key: "api", label: "Duplicate" }
      ],
      title: "architecture"
    }),
    /node keys must be unique/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_canvas_diagram", {
      edges: [{ from: "api", to: "missing" }],
      nodes: [{ key: "api", label: "API" }],
      title: "architecture"
    }),
    /references an unknown node/
  );
  assert.throws(
    () => parseAiDraftActionPayload("create_canvas_diagram", {
      edges: [{ from: "api", to: "api" }],
      nodes: [{ key: "api", label: "API" }],
      title: "architecture"
    }),
    /cannot connect a node to itself/
  );
});

test("materialization revalidates persisted payloads", () => {
  const payload = parseAiDraftActionPayload("create_note", {
    content: "safe",
    title: "note"
  });
  const corrupted = { ...payload, unexpected: true };
  assert.throws(
    () => materializeAiDraftAction("create_note", corrupted),
    /unknown field unexpected/
  );
});

test("draft summaries omit generated content and retain review metadata", () => {
  assert.deepEqual(
    summarizeAiDraftActionPayload("create_note", {
      content: "Sensitive draft body",
      parentId: "folder-1",
      title: "release"
    }),
    {
      contentLength: 20,
      parentId: "folder-1",
      preview: "Sensitive draft body",
      title: "release.md",
      truncated: false
    }
  );
  assert.deepEqual(
    summarizeAiDraftActionPayload("create_table_note", {
      columns: ["Task", "Owner"],
      rows: [["Build", "Team"]],
      title: "tasks"
    }),
    {
      columnCount: 2,
      parentId: null,
      preview: "| Task | Owner |\n| --- | --- |\n| Build | Team |",
      rowCount: 1,
      title: "tasks.md",
      truncated: false
    }
  );
  assert.deepEqual(
    summarizeAiDraftActionPayload("create_note", { title: "missing-content" }),
    {
      invalid: true,
      parentId: null,
      preview: "Draft payload is invalid",
      title: "Invalid draft",
      truncated: false
    }
  );
});

test("update_document payload is enriched from a complete trusted observation", () => {
  const payload = createUpdateDocumentDraft({
    complete: true,
    content: "const ready = false;\n",
    id: "document-1",
    title: "status.ts",
    type: "code",
    updatedAt: "2026-07-10T12:00:00.000Z"
  }, "const ready = true;\n");

  assert.equal(payload.documentId, "document-1");
  assert.equal(payload.documentType, "code");
  assert.equal(payload.expectedContentHash, hashDocumentContent("const ready = false;\n"));
  assert.equal(payload.resultContentHash, hashDocumentContent("const ready = true;\n"));
  assert.match(payload.diffPreview, /- const ready = false;/);
  assert.match(payload.diffPreview, /\+ const ready = true;/);
  assert.deepEqual(summarizeAiDraftActionPayload("update_document", payload), {
    contentLength: 20,
    documentId: "document-1",
    documentType: "code",
    expectedUpdatedAt: "2026-07-10T12:00:00.000Z",
    preview: payload.diffPreview,
    title: "status.ts",
    truncated: false
  });
});

test("update_document rejects incomplete, canvas, unchanged, and forged payloads", () => {
  assert.throws(() => createUpdateDocumentDraft({
    complete: false,
    content: "partial",
    id: "document-1",
    title: "large.ts",
    type: "code",
    updatedAt: "2026-07-10T12:00:00.000Z"
  }, "replacement"), /read in full/);
  assert.throws(() => createUpdateDocumentDraft({
    complete: true,
    content: "{}",
    id: "document-2",
    title: "diagram.canvas",
    type: "canvas",
    updatedAt: "2026-07-10T12:00:00.000Z"
  }, "replacement"), /Only code and note/);
  assert.throws(() => createUpdateDocumentDraft({
    complete: true,
    content: "same",
    id: "document-3",
    title: "same.md",
    type: "note",
    updatedAt: "2026-07-10T12:00:00.000Z"
  }, "same"), /must change/);
  assert.throws(() => parseAiDraftActionPayload("update_document", {
    content: "changed",
    diffPreview: "preview",
    diffTruncated: false,
    documentId: "document-4",
    documentType: "note",
    expectedContentHash: "not-a-hash",
    expectedUpdatedAt: "yesterday",
    resultContentHash: "also-not-a-hash",
    title: "note.md"
  }), /expectedContentHash is invalid/);
  assert.ok(createTextDiffPreview("a\n".repeat(2_000), "b\n".repeat(2_000)).length <= 1_200);
});
