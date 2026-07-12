import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceInvitePolicy } from "../lib/server/workspaceInvitePolicy";

const activeInvite = {
  acceptedAt: null,
  declinedAt: null,
  email: "member@slate.test",
  expiresAt: new Date("2026-07-18T10:00:00.000Z"),
  recipientUserId: "user-1",
  revokedAt: null
};

test("normalizes an invite email and rejects an empty value", () => {
  const policy = new WorkspaceInvitePolicy();
  assert.equal(policy.normalizeEmail("  Member@Slate.Test "), "member@slate.test");
  assert.throws(() => policy.normalizeEmail("  "), /Email is required/);
});

test("accepts an active invite only for the bound account", () => {
  const policy = new WorkspaceInvitePolicy();
  assert.doesNotThrow(() => policy.assertCanAccept(activeInvite, { email: "member@slate.test", id: "user-1" }, new Date("2026-07-11T10:00:00.000Z")));
  assert.throws(() => policy.assertCanAccept(activeInvite, { email: "other@slate.test", id: "user-2" }), /different account/);
});

test("rejects expired, revoked, declined, and accepted invites", () => {
  const policy = new WorkspaceInvitePolicy();
  const recipient = { email: "member@slate.test", id: "user-1" };
  assert.throws(() => policy.assertCanAccept(activeInvite, recipient, new Date("2026-07-19T10:00:00.000Z")), /expired/);
  assert.throws(() => policy.assertCanAccept({ ...activeInvite, revokedAt: new Date() }, recipient), /revoked/);
  assert.throws(() => policy.assertCanAccept({ ...activeInvite, declinedAt: new Date() }, recipient), /declined/);
  assert.throws(() => policy.assertCanAccept({ ...activeInvite, acceptedAt: new Date() }, recipient), /already accepted/);
});
