import * as Y from "yjs";
import { canvasStateValidator } from "./canvasState.js";
import { maximumRealtimeStateBytes } from "./realtimeUpdateValidator.js";

class RoomPersistenceIdentityError extends Error {}

export class RoomPersistence {
  constructor(client, schedulePersist, retireRoom = () => {}) {
    this.client = client;
    this.retireRoom = retireRoom;
    this.schedulePersist = schedulePersist;
  }

  persist(room) {
    if (room.persistenceRetired) return Promise.resolve(false);
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }

    const operation = room.persistPromise.catch(() => undefined).then(() => this.persistState(room));
    room.persistPromise = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async persistState(room) {
    try {
      const revision = room.revision;
      const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
      if (state.byteLength > maximumRealtimeStateBytes) {
        throw new Error("Realtime document state exceeds the maximum size");
      }
      const text = room.roomType === "file"
        ? room.doc.getText("source").toString()
        : room.roomType === "note"
          ? room.doc.getText("note").toString()
          : null;
      const canvasState = room.roomType === "canvas" ? canvasStateValidator.clone(room.doc.getMap("canvas").get("snapshot")) : undefined;
      if (room.roomType === "canvas" && canvasState === null) {
        throw new Error("Realtime canvas state is invalid");
      }
      const documentType = room.roomType === "file" ? "code" : room.roomType;
      const canonicalData = text !== null ? { content: text } : { canvasState };
      await this.client.$transaction(async (transaction) => {
        const canonicalWrite = await transaction.document.updateMany({
          data: canonicalData,
          where: {
            archivedAt: null,
            id: room.documentId,
            type: documentType,
            workspaceId: room.workspaceId
          }
        });
        if (canonicalWrite.count !== 1) throw new RoomPersistenceIdentityError("Realtime room no longer matches the canonical document");
        await transaction.documentRealtime.upsert({
          create: {
            documentId: room.documentId,
            roomName: room.roomName,
            state
          },
          update: {
            roomName: room.roomName,
            state
          },
          where: { documentId: room.documentId }
        });
      });
      room.persistedRevision = Math.max(room.persistedRevision, revision);
      room.dirty = room.revision > room.persistedRevision;
      room.lastPersistError = null;
      room.lastPersistedAt = new Date();
      room.persistRetryCount = 0;
      room.updatesSincePersist = room.revision - room.persistedRevision;
      if (room.dirty && !room.persistTimer) {
        this.schedulePersist(room);
      }
      return true;
    } catch (error) {
      room.lastPersistError = error instanceof Error ? error.message : "unknown persist error";
      if (error instanceof RoomPersistenceIdentityError) {
        room.persistenceRetired = true;
        room.dirty = false;
        room.updatesSincePersist = 0;
        this.retireRoom(room);
      } else if (room.dirty && !room.persistTimer) {
        room.persistRetryCount += 1;
        this.schedulePersist(room);
      }
      return false;
    }
  }
}
