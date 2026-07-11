import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import {
  canonicalDocumentWhere,
  parseTextReplacementInput,
  replaceTextWithMinimalSplice,
  sha256Text,
  TextReplacementError,
  TextReplacementService,
  validBearerAuthorization
} from "../src/textReplacement.js";

function request(overrides = {}) {
  const content = overrides.content ?? "const answer = 42;";
  return {
    actionId: "action-1",
    content,
    documentId: "document-1",
    documentType: "code",
    expectedContentHash: sha256Text("const answer = 41;"),
    roomName: "slate:room:workspace-1:file:document-1",
    workspaceId: "workspace-1",
    ...overrides
  };
}

function room(documentType = "code", initialContent = "const answer = 41;") {
  const doc = new Y.Doc();
  doc.getText(documentType === "code" ? "source" : "note").insert(0, initialContent);
  return {
    doc,
    textReplacementPromise: Promise.resolve()
  };
}

function service(activeRoom, persistRoom = async () => true) {
  return new TextReplacementService({
    getRoom: async () => activeRoom,
    persistRoom,
    receiptSecret: "internal-sync-secret-32-characters"
  });
}

test("replaces code with one minimal Y.Text splice and persists", async () => {
  const activeRoom = room("code", "hello brave world");
  const text = activeRoom.doc.getText("source");
  const deltas = [];
  let updateCount = 0;
  let persistCount = 0;
  text.observe((event) => deltas.push(event.delta));
  activeRoom.doc.on("update", () => {
    updateCount += 1;
  });

  const result = await service(activeRoom, async () => {
    persistCount += 1;
    return true;
  }).execute(request({
    content: "hello kind world",
    expectedContentHash: sha256Text("hello brave world")
  }));

  assert.equal(text.toString(), "hello kind world");
  assert.equal(result.applied, true);
  assert.equal(result.contentHash, sha256Text("hello kind world"));
  assert.equal(persistCount, 1);
  assert.equal(updateCount, 1);
  assert.deepEqual(deltas, [[{ retain: 6 }, { delete: 5 }, { insert: "kind" }]]);
});

test("replaces note content through the note Y.Text key", async () => {
  const activeRoom = room("note", "# Old");
  const result = await service(activeRoom).execute(request({
    content: "# New",
    documentType: "note",
    expectedContentHash: sha256Text("# Old"),
    roomName: "slate:room:workspace-1:note:document-1"
  }));

  assert.equal(activeRoom.doc.getText("note").toString(), "# New");
  assert.equal(result.applied, true);
});

test("returns an idempotent success and still verifies durability", async () => {
  const activeRoom = room("code", "same");
  let persistCount = 0;
  const result = await service(activeRoom, async () => {
    persistCount += 1;
    return true;
  }).execute(request({
    content: "same",
    expectedContentHash: sha256Text("before")
  }));

  assert.equal(result.applied, false);
  assert.equal(result.contentHash, sha256Text("same"));
  assert.equal(persistCount, 1);
});

test("replays a durable action receipt after later collaborator edits", async () => {
  const activeRoom = room("code", "base");
  const replacementService = service(activeRoom);
  const input = request({ content: "ai result", expectedContentHash: sha256Text("base") });

  assert.equal((await replacementService.execute(input)).applied, true);
  const persistedState = Y.encodeStateAsUpdate(activeRoom.doc);
  const restartedRoom = room("code", "");
  Y.applyUpdate(restartedRoom.doc, persistedState);
  const restartedText = restartedRoom.doc.getText("source");
  restartedText.delete(0, restartedText.length);
  restartedText.insert(0, "later collaborator edit");

  const replay = await service(restartedRoom).execute(input);
  assert.equal(replay.applied, false);
  assert.equal(restartedText.toString(), "later collaborator edit");
});

test("rejects reuse of an action id for a different result", async () => {
  const activeRoom = room("code", "base");
  const replacementService = service(activeRoom);
  await replacementService.execute(request({ content: "first", expectedContentHash: sha256Text("base") }));

  await assert.rejects(
    replacementService.execute(request({ content: "second", expectedContentHash: sha256Text("first") })),
    (error) => error instanceof TextReplacementError && error.code === "idempotency_conflict" && error.status === 409
  );
  assert.equal(activeRoom.doc.getText("source").toString(), "first");
});

test("ignores forged action receipts from collaborative clients", async () => {
  const activeRoom = room("code", "changed");
  activeRoom.doc.getMap("slate_internal").set("textReplacementReceipts", [{
    actionId: "action-1",
    contentHash: sha256Text("const answer = 42;"),
    documentId: "document-1",
    documentType: "code",
    roomName: "slate:room:workspace-1:file:document-1",
    signature: "0".repeat(64),
    workspaceId: "workspace-1"
  }]);

  await assert.rejects(
    service(activeRoom).execute(request()),
    (error) => error instanceof TextReplacementError && error.code === "document_changed"
  );
});

test("bounds durable action receipts", async () => {
  const activeRoom = room("code", "value-0");
  const replacementService = service(activeRoom);
  for (let index = 1; index <= 65; index += 1) {
    await replacementService.execute(request({
      actionId: `action-${index}`,
      content: `value-${index}`,
      expectedContentHash: sha256Text(`value-${index - 1}`)
    }));
  }

  const receipts = activeRoom.doc.getMap("slate_internal").get("textReplacementReceipts");
  assert.ok(Array.isArray(receipts));
  assert.equal(receipts.length, 64);
  assert.equal(receipts[0].actionId, "action-2");
  assert.equal(receipts[63].actionId, "action-65");
});

test("rejects stale content without mutating or persisting", async () => {
  const activeRoom = room("code", "changed by collaborator");
  let persistCount = 0;

  await assert.rejects(
    service(activeRoom, async () => {
      persistCount += 1;
      return true;
    }).execute(request()),
    (error) => {
      assert.ok(error instanceof TextReplacementError);
      assert.equal(error.code, "document_changed");
      assert.equal(error.status, 409);
      assert.equal(error.details.currentContentHash, sha256Text("changed by collaborator"));
      return true;
    }
  );
  assert.equal(activeRoom.doc.getText("source").toString(), "changed by collaborator");
  assert.equal(persistCount, 0);
});

test("serializes replacement commands for one room", async () => {
  const activeRoom = room("code", "base");
  let releaseFirstPersist;
  const firstPersist = new Promise((resolve) => {
    releaseFirstPersist = resolve;
  });
  let persistCount = 0;
  const replacementService = service(activeRoom, async () => {
    persistCount += 1;
    if (persistCount === 1) await firstPersist;
    return true;
  });

  const first = replacementService.execute(request({ content: "first", expectedContentHash: sha256Text("base") }));
  const second = replacementService.execute(request({ actionId: "action-2", content: "second", expectedContentHash: sha256Text("base") }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeRoom.doc.getText("source").toString(), "first");
  releaseFirstPersist();
  await first;
  await assert.rejects(second, (error) => error instanceof TextReplacementError && error.code === "document_changed");
  assert.equal(activeRoom.doc.getText("source").toString(), "first");
});

test("reports persistence failure after applying the Yjs update", async () => {
  const activeRoom = room();
  await assert.rejects(
    service(activeRoom, async () => false).execute(request()),
    (error) => error instanceof TextReplacementError && error.code === "persistence_failed" && error.status === 503
  );
  assert.equal(activeRoom.doc.getText("source").toString(), "const answer = 42;");
});

test("rejects canvas replacement and identity mismatches", () => {
  assert.throws(
    () => parseTextReplacementInput(request({
      documentType: "canvas",
      roomName: "slate:room:workspace-1:canvas:document-1"
    })),
    (error) => error instanceof TextReplacementError && error.code === "unsupported_document_type" && error.status === 422
  );
  assert.throws(
    () => parseTextReplacementInput(request({ documentId: "document-2" })),
    (error) => error instanceof TextReplacementError && error.code === "invalid_request" && error.status === 400
  );
});

test("builds a strict canonical document identity selector", () => {
  assert.deepEqual(canonicalDocumentWhere({
    documentId: "document-1",
    documentType: "note",
    roomType: "note",
    workspaceId: "workspace-1"
  }), {
    archivedAt: null,
    id: "document-1",
    type: "note",
    workspaceId: "workspace-1"
  });
});

test("rejects unsupported database text and oversized content", () => {
  assert.throws(
    () => parseTextReplacementInput(request({ content: "before\u0000after" })),
    (error) => error instanceof TextReplacementError && error.code === "invalid_request"
  );
  assert.throws(
    () => parseTextReplacementInput(request({ content: "x".repeat(262_145) })),
    (error) => error instanceof TextReplacementError && error.code === "payload_too_large" && error.status === 413
  );
});

test("validates internal bearer authentication in constant-time shape", () => {
  const secret = "a".repeat(32);
  assert.equal(validBearerAuthorization(`Bearer ${secret}`, secret), true);
  assert.equal(validBearerAuthorization(`Bearer ${"b".repeat(32)}`, secret), false);
  assert.equal(validBearerAuthorization(secret, secret), false);
  assert.equal(validBearerAuthorization(`Bearer ${secret}`, "short"), false);
});

test("requires a receipt signing secret", async () => {
  const replacementService = new TextReplacementService({
    getRoom: async () => room(),
    persistRoom: async () => true,
    receiptSecret: "short"
  });
  await assert.rejects(
    replacementService.execute(request()),
    (error) => error instanceof TextReplacementError && error.code === "internal_auth_unavailable" && error.status === 503
  );
});

test("minimal splice is a no-op for equal content", () => {
  const doc = new Y.Doc();
  const text = doc.getText("source");
  text.insert(0, "same");
  let updateCount = 0;
  doc.on("update", () => {
    updateCount += 1;
  });

  assert.equal(replaceTextWithMinimalSplice(text, "same"), false);
  assert.equal(updateCount, 0);
});

test("minimal splice preserves complete Unicode scalar values", () => {
  const doc = new Y.Doc();
  const text = doc.getText("source");
  text.insert(0, "before 😀 after");
  const deltas = [];
  text.observe((event) => deltas.push(event.delta));

  assert.equal(replaceTextWithMinimalSplice(text, "before 😃 after"), true);
  assert.equal(text.toString(), "before 😃 after");
  assert.deepEqual(deltas, [[{ retain: 7 }, { delete: 2 }, { insert: "😃" }]]);
});
