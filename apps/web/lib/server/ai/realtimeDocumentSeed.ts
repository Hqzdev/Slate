import type { DocumentType } from "@prisma/client";
import { isCanvasDocumentV1 } from "../../canvas/canvasDocumentSchema";
import * as Y from "yjs";

type RealtimeDocumentSeedInput = {
  canvasState: unknown;
  content: string;
  documentId: string;
  documentType: DocumentType;
  workspaceId: string;
};

export type RealtimeDocumentSeed = {
  roomName: string;
  state: Uint8Array<ArrayBuffer>;
};

export class RealtimeDocumentSeedFactory {
  create(input: RealtimeDocumentSeedInput): RealtimeDocumentSeed {
    const document = new Y.Doc();
    try {
      if (input.documentType === "code") {
        const source = document.getText("source");
        if (input.content.length > 0) source.insert(0, input.content);
      } else if (input.documentType === "note") {
        const note = document.getText("note");
        if (input.content.length > 0) note.insert(0, input.content);
      } else {
        if (!isCanvasDocumentV1(input.canvasState)) {
          throw new Error("Canvas realtime state is invalid");
        }
        document.getMap("canvas").set("snapshot", input.canvasState);
      }

      return {
        roomName: this.roomName(input.workspaceId, input.documentId, input.documentType),
        state: Uint8Array.from(Y.encodeStateAsUpdate(document))
      };
    } finally {
      document.destroy();
    }
  }

  private roomName(workspaceId: string, documentId: string, documentType: DocumentType) {
    const roomType = documentType === "code" ? "file" : documentType;
    return `slate:room:${workspaceId}:${roomType}:${documentId}`;
  }
}

export const realtimeDocumentSeedFactory = new RealtimeDocumentSeedFactory();
