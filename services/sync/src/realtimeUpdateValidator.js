import * as Y from "yjs";
import { canvasStateValidator } from "./canvasState.js";

export const maximumRealtimeMessageBytes = 1_048_576;
export const maximumRealtimeStateBytes = 8_388_608;

export class RealtimeUpdateValidator {
  constructor(validator = canvasStateValidator) {
    this.applyingRooms = new WeakSet();
    this.roomStates = new WeakMap();
    this.validator = validator;
  }

  apply(room, update, origin) {
    if (!(update instanceof Uint8Array) || update.byteLength > maximumRealtimeMessageBytes) {
      return false;
    }

    const state = this.requireRoomState(room, update.byteLength);
    if (!state) return false;

    try {
      Y.applyUpdate(state.document, update);
      if (!this.isValidRoomDocument(room.roomType, state.document)) {
        this.release(room);
        return false;
      }
    } catch {
      this.release(room);
      return false;
    }

    this.applyingRooms.add(room);
    try {
      Y.applyUpdate(room.doc, update, origin);
      return true;
    } catch {
      this.release(room);
      return false;
    } finally {
      this.applyingRooms.delete(room);
    }
  }

  observeAppliedUpdate(room, update) {
    const state = this.roomStates.get(room);
    if (!state) return;

    try {
      if (!this.applyingRooms.has(room)) {
        Y.applyUpdate(state.document, update);
      }
      state.accumulatedBytes += update.byteLength;
      if (state.accumulatedBytes > maximumRealtimeStateBytes || !this.isValidRoomDocument(room.roomType, state.document)) {
        this.release(room);
      }
    } catch {
      this.release(room);
    }
  }

  release(room) {
    const state = this.roomStates.get(room);
    state?.document.destroy();
    this.roomStates.delete(room);
  }

  isWithinStateLimit(document) {
    try {
      return Y.encodeStateAsUpdate(document).byteLength <= maximumRealtimeStateBytes;
    } catch {
      return false;
    }
  }

  prepareRoomDocument(roomType, document) {
    try {
      this.initializeRoomDocument(roomType, document);
      return this.isValidRoomDocument(roomType, document) && this.isWithinStateLimit(document);
    } catch {
      return false;
    }
  }

  requireRoomState(room, incomingBytes) {
    let state = this.roomStates.get(room) ?? this.createRoomState(room);
    if (!state) return null;
    if (state.accumulatedBytes + incomingBytes <= maximumRealtimeStateBytes) return state;

    state = this.compactRoomState(room, state);
    if (!state || state.accumulatedBytes + incomingBytes > maximumRealtimeStateBytes) return null;
    return state;
  }

  createRoomState(room) {
    let document = null;
    try {
      const encodedState = Y.encodeStateAsUpdate(room.doc);
      if (encodedState.byteLength > maximumRealtimeStateBytes) return null;
      document = new Y.Doc();
      this.initializeRoomDocument(room.roomType, document);
      Y.applyUpdate(document, encodedState);
      if (!this.isValidRoomDocument(room.roomType, document)) {
        document.destroy();
        return null;
      }
      const state = { accumulatedBytes: encodedState.byteLength, document };
      this.roomStates.set(room, state);
      return state;
    } catch {
      document?.destroy();
      return null;
    }
  }

  compactRoomState(room, state) {
    let document = null;
    try {
      const encodedState = Y.encodeStateAsUpdate(state.document);
      if (encodedState.byteLength > maximumRealtimeStateBytes) {
        this.release(room);
        return null;
      }
      document = new Y.Doc();
      this.initializeRoomDocument(room.roomType, document);
      Y.applyUpdate(document, encodedState);
      if (!this.isValidRoomDocument(room.roomType, document)) {
        document.destroy();
        this.release(room);
        return null;
      }
      state.document.destroy();
      const compactedState = { accumulatedBytes: encodedState.byteLength, document };
      this.roomStates.set(room, compactedState);
      return compactedState;
    } catch {
      document?.destroy();
      this.release(room);
      return null;
    }
  }

  isValidRoomDocument(roomType, document) {
    if (roomType === "canvas") return this.isValidCanvasDocument(document);
    return this.isValidTextDocument(document, roomType === "file" ? "source" : "note");
  }

  initializeRoomDocument(roomType, document) {
    if (roomType === "canvas") {
      document.getMap("canvas");
      return;
    }
    document.getText(roomType === "file" ? "source" : "note");
  }

  isValidCanvasDocument(document) {
    if (document.share.size !== 1 || !document.share.has("canvas")) return false;
    const canvas = document.getMap("canvas");
    return canvas.size === 1
      && canvas.has("snapshot")
      && this.validator.isValid(canvas.get("snapshot"));
  }

  isValidTextDocument(document, textKey) {
    const allowedKeys = new Set([textKey, "slate_internal"]);
    if (!document.share.has(textKey) || Array.from(document.share.keys()).some((key) => !allowedKeys.has(key))) return false;
    document.getText(textKey);
    if (document.share.has("slate_internal")) document.getMap("slate_internal");
    return true;
  }
}

export const realtimeUpdateValidator = new RealtimeUpdateValidator();
