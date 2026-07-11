import { createHmac, timingSafeEqual } from "node:crypto";
import type { DocumentType, WorkspaceRole } from "@prisma/client";
import type { RealtimeRoomGrant } from "./workspaceAccessPolicy";

export type RealtimeGrantPayload = {
  canWrite: boolean;
  color: string;
  documentId: string;
  documentType: DocumentType;
  email: string;
  expiresAt: number;
  id: string;
  initials: string;
  name: string;
  role: WorkspaceRole;
  roomName: string;
  workspaceId: string;
};

export class RealtimeGrantService {
  private readonly ttlMs = 2 * 60 * 1000;

  constructor(private readonly secret: string | null = null) {}

  create(roomGrant: RealtimeRoomGrant) {
    const payload: RealtimeGrantPayload = {
      canWrite: roomGrant.canWrite,
      color: roomGrant.color,
      documentId: roomGrant.documentId,
      documentType: roomGrant.documentType,
      email: roomGrant.email,
      expiresAt: Date.now() + this.ttlMs,
      id: roomGrant.id,
      initials: roomGrant.initials,
      name: roomGrant.name,
      role: roomGrant.role,
      roomName: roomGrant.roomName,
      workspaceId: roomGrant.workspaceId
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  verify(token: string, roomName: string) {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return null;

    const expectedSignature = this.sign(encodedPayload);
    const signatureBuffer = Buffer.from(signature, "base64url");
    const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");
    if (signatureBuffer.length !== expectedSignatureBuffer.length) return null;
    if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) return null;

    const payload = this.parsePayload(encodedPayload);
    if (!payload) return null;
    if (payload.roomName !== roomName) return null;
    if (payload.expiresAt <= Date.now()) return null;

    return payload;
  }

  private parsePayload(encodedPayload: string) {
    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<RealtimeGrantPayload>;
      if (
        typeof payload.canWrite !== "boolean" ||
        typeof payload.color !== "string" ||
        typeof payload.documentId !== "string" ||
        typeof payload.documentType !== "string" ||
        typeof payload.email !== "string" ||
        typeof payload.expiresAt !== "number" ||
        typeof payload.id !== "string" ||
        typeof payload.initials !== "string" ||
        typeof payload.name !== "string" ||
        typeof payload.role !== "string" ||
        typeof payload.roomName !== "string" ||
        typeof payload.workspaceId !== "string"
      ) {
        return null;
      }

      return payload as RealtimeGrantPayload;
    } catch {
      return null;
    }
  }

  private sign(encodedPayload: string) {
    return createHmac("sha256", this.getSecret()).update(encodedPayload).digest("base64url");
  }

  private getSecret() {
    const secret = this.secret ?? process.env.REALTIME_GRANT_SECRET;
    if (secret) return secret;
    if (process.env.NODE_ENV === "production") {
      throw new Error("REALTIME_GRANT_SECRET is required");
    }
    return "slate-local-realtime-grant-secret";
  }
}

export const realtimeGrantService = new RealtimeGrantService();
