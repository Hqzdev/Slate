import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { canvasStateValidator } from "../src/canvasState.js";
import { RoomPersistence } from "../src/roomPersistence.js";

function createRoom(roomType = "file", content = "initial") {
  const doc = new Y.Doc();
  if (roomType === "file") doc.getText("source").insert(0, content);
  if (roomType === "note") doc.getText("note").insert(0, content);
  if (roomType === "canvas") doc.getMap("canvas").set("snapshot", canvasStateValidator.createDefault());
  return {
    dirty: true,
    documentId: "document-1",
    doc,
    lastPersistError: null,
    lastPersistedAt: null,
    persistPromise: Promise.resolve(),
    persistedRevision: 0,
    persistTimer: null,
    revision: 1,
    roomName: `slate:room:workspace-1:${roomType}:document-1`,
    roomType,
    workspaceId: "workspace-1",
    updatesSincePersist: 1
  };
}

function createClient(runTransaction = async (callback, client) => callback(client)) {
  const writes = {
    documents: [],
    realtime: []
  };
  return {
    client: {
      $transaction(callback) {
        return runTransaction(callback, this);
      },
      document: {
        updateMany(input) {
          writes.documents.push(input);
          return Promise.resolve({ count: 1 });
        }
      },
      documentRealtime: {
        upsert(input) {
          writes.realtime.push(input);
          return Promise.resolve(input);
        }
      }
    },
    writes
  };
}

test("persists Yjs state and canonical code content in one transaction", async () => {
  const { client, writes } = createClient();
  const activeRoom = createRoom("file", "const value = 1;");
  const persistence = new RoomPersistence(client, () => {});

  assert.equal(await persistence.persist(activeRoom), true);
  assert.equal(writes.realtime.length, 1);
  assert.ok(Buffer.isBuffer(writes.realtime[0].create.state));
  assert.equal(writes.documents[0].data.content, "const value = 1;");
  assert.equal(activeRoom.dirty, false);
  assert.equal(activeRoom.persistedRevision, 1);
  assert.equal(activeRoom.updatesSincePersist, 0);
});

test("persists canonical note content", async () => {
  const { client, writes } = createClient();
  const activeRoom = createRoom("note", "# Note");

  assert.equal(await new RoomPersistence(client, () => {}).persist(activeRoom), true);
  assert.equal(writes.documents[0].data.content, "# Note");
});

test("canvas persistence writes canonical canvas state", async () => {
  const { client, writes } = createClient();
  const activeRoom = createRoom("canvas", "");

  assert.equal(await new RoomPersistence(client, () => {}).persist(activeRoom), true);
  assert.equal(writes.realtime.length, 1);
  assert.deepEqual(writes.documents[0].data.canvasState, canvasStateValidator.createDefault());
});

test("serializes room persistence and retains a newer dirty revision", async () => {
  let activeTransactions = 0;
  let maximumActiveTransactions = 0;
  let releaseFirstTransaction;
  const firstTransaction = new Promise((resolve) => {
    releaseFirstTransaction = resolve;
  });
  let transactionCount = 0;
  const { client, writes } = createClient(async (callback, transactionClient) => {
    transactionCount += 1;
    activeTransactions += 1;
    maximumActiveTransactions = Math.max(maximumActiveTransactions, activeTransactions);
    if (transactionCount === 1) await firstTransaction;
    const result = await callback(transactionClient);
    activeTransactions -= 1;
    return result;
  });
  const activeRoom = createRoom("file", "first");
  let scheduledCount = 0;
  const persistence = new RoomPersistence(client, () => {
    scheduledCount += 1;
  });

  const first = persistence.persist(activeRoom);
  await new Promise((resolve) => setImmediate(resolve));
  activeRoom.doc.getText("source").delete(0, 5);
  activeRoom.doc.getText("source").insert(0, "second");
  activeRoom.revision = 2;
  activeRoom.updatesSincePersist = 2;
  const second = persistence.persist(activeRoom);
  releaseFirstTransaction();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(maximumActiveTransactions, 1);
  assert.deepEqual(writes.documents.map((write) => write.data.content), ["first", "second"]);
  assert.equal(activeRoom.persistedRevision, 2);
  assert.equal(activeRoom.dirty, false);
  assert.equal(scheduledCount, 1);
});

test("preserves dirty state and exposes persistence errors", async () => {
  const activeRoom = createRoom();
  const { client } = createClient(async () => {
    throw new Error("database offline");
  });

  assert.equal(await new RoomPersistence(client, () => {}).persist(activeRoom), false);
  assert.equal(activeRoom.dirty, true);
  assert.equal(activeRoom.persistedRevision, 0);
  assert.equal(activeRoom.lastPersistError, "database offline");
});
