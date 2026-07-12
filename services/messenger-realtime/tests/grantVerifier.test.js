import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { GrantVerifier } from "../src/grantVerifier.js";

const key = Buffer.alloc(32, 7);
const configuration = {
  grantActiveKid: "test-v1",
  grantKeys: JSON.stringify({ "test-v1": key.toString("base64") })
};

test("verifies bounded grants and rejects tampering", () => {
  const now = 1_800_000_000_000;
  const claims = {
    accessVersion: 2,
    aud: "slate-messenger",
    exp: now / 1_000 + 120,
    iat: now / 1_000,
    jti: "request-1",
    kid: "test-v1",
    membershipId: "member-1",
    role: "editor",
    sub: "user-1",
    v: 1,
    workspaceId: "workspace-1"
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  const verifier = new GrantVerifier(configuration, () => now);
  assert.deepEqual(verifier.verify(`${encoded}.${signature}`), claims);
  assert.equal(verifier.verify(`${encoded}.${signature.slice(0, -1)}A`), null);
});
