import assert from "node:assert/strict";
import test from "node:test";
import { MessengerRealtimeConfiguration } from "../lib/server/messenger/realtimeConfiguration";
import { MessengerRealtimeGrantService, readGrantConfiguration } from "../lib/server/messenger/realtimeGrant";

const key = Buffer.alloc(32, 7);
const configuration = { activeKid: "key-v1", keys: { "key-v1": key } };
const input = {
  accessVersion: 4,
  membershipId: "membership-1",
  role: "editor" as const,
  userId: "user-1",
  workspaceId: "workspace-1"
};

test("creates and verifies a bounded Messenger realtime grant", () => {
  const service = new MessengerRealtimeGrantService(configuration, () => 1_000_000, () => "grant-id-1");
  const issued = service.create(input);
  assert.equal(issued.expiresAt, new Date(1_120_000).toISOString());
  assert.deepEqual(service.verify(issued.grant, "workspace-1"), {
    accessVersion: 4,
    aud: "slate-messenger",
    exp: 1_120,
    iat: 1_000,
    jti: "grant-id-1",
    kid: "key-v1",
    membershipId: "membership-1",
    role: "editor",
    sub: "user-1",
    v: 1,
    workspaceId: "workspace-1"
  });
});

test("rejects tampering, wrong workspace, expiry and future issuance", () => {
  const service = new MessengerRealtimeGrantService(configuration, () => 1_000_000, () => "grant-id-1");
  const issued = service.create(input);
  const [payload, signature] = issued.grant.split(".");
  assert.ok(payload && signature);
  assert.equal(service.verify(`${payload}x.${signature}`, "workspace-1"), null);
  assert.equal(service.verify(issued.grant, "workspace-2"), null);
  const expired = new MessengerRealtimeGrantService(configuration, () => 1_121_000);
  assert.equal(expired.verify(issued.grant, "workspace-1"), null);
  const futureIssuer = new MessengerRealtimeGrantService(configuration, () => 2_000_000, () => "grant-id-2");
  const futureGrant = futureIssuer.create(input).grant;
  assert.equal(service.verify(futureGrant, "workspace-1"), null);
});

test("loads a rotating base64 key set and fails closed in production", () => {
  const parsed = readGrantConfiguration({
    MESSENGER_REALTIME_GRANT_ACTIVE_KID: "key-v2",
    MESSENGER_REALTIME_GRANT_KEYS: JSON.stringify({ "key-v1": key.toString("base64"), "key-v2": Buffer.alloc(32, 8).toString("base64") }),
    NODE_ENV: "production"
  });
  assert.equal(parsed.activeKid, "key-v2");
  assert.equal(parsed.keys["key-v1"]?.length, 32);
  assert.throws(() => readGrantConfiguration({ NODE_ENV: "production" }), /required/);
});

test("requires an enabled TLS realtime URL in production", () => {
  const disabled = new MessengerRealtimeConfiguration({ MESSENGER_REALTIME_ENABLED: "false" });
  assert.throws(() => disabled.requireEnabled(), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "realtime_unavailable"));
  const production = new MessengerRealtimeConfiguration({
    MESSENGER_REALTIME_ENABLED: "true",
    MESSENGER_REALTIME_PUBLIC_URL: "ws://slate.test/messenger",
    NODE_ENV: "production"
  });
  assert.throws(() => production.getSocketUrl(), /TLS/);
  const local = new MessengerRealtimeConfiguration({ MESSENGER_REALTIME_ENABLED: "true" });
  local.requireEnabled();
  assert.equal(local.getSocketUrl(), "ws://127.0.0.1:1236/messenger");
});
