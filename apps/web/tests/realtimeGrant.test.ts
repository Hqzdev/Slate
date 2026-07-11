import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeGrantService } from "../lib/server/realtimeGrant";
import type { RealtimeRoomGrant } from "../lib/server/workspaceAccessPolicy";

const roomGrant: RealtimeRoomGrant = {
  canWrite: true,
  color: "blue",
  documentId: "document-1",
  documentType: "code",
  email: "editor@slate.test",
  id: "user-1",
  initials: "ED",
  name: "Editor User",
  role: "editor",
  roomName: "slate:room:workspace-1:file:document-1",
  workspaceId: "workspace-1"
};

test("realtime grants verify valid tokens", () => {
  const service = new RealtimeGrantService("test-secret");
  const token = service.create(roomGrant);
  const payload = service.verify(token, roomGrant.roomName);
  assert.equal(payload?.id, "user-1");
  assert.equal(payload?.canWrite, true);
  assert.equal(payload?.workspaceId, "workspace-1");
});

test("realtime grants reject tampered tokens", () => {
  const service = new RealtimeGrantService("test-secret");
  const token = service.create(roomGrant);
  const [payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ ...roomGrant, canWrite: false, expiresAt: Date.now() + 60_000 }), "utf8").toString("base64url");
  const tamperedToken = `${tamperedPayload}.${signature}`;
  assert.equal(service.verify(tamperedToken, roomGrant.roomName), null);
  assert.notEqual(payload, tamperedPayload);
});

test("realtime grants reject wrong rooms", () => {
  const service = new RealtimeGrantService("test-secret");
  const token = service.create(roomGrant);
  assert.equal(service.verify(token, "slate:room:workspace-1:note:document-1"), null);
});

test("realtime grants reject expired tokens", () => {
  const service = new RealtimeGrantService("test-secret");
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    const token = service.create(roomGrant);
    Date.now = () => 1_000 + 3 * 60 * 1000;
    assert.equal(service.verify(token, roomGrant.roomName), null);
  } finally {
    Date.now = originalNow;
  }
});

test("realtime grants preserve viewer read-only access", () => {
  const service = new RealtimeGrantService("test-secret");
  const token = service.create({
    ...roomGrant,
    canWrite: false,
    role: "viewer"
  });
  const payload = service.verify(token, roomGrant.roomName);
  assert.equal(payload?.role, "viewer");
  assert.equal(payload?.canWrite, false);
});
