import assert from "node:assert/strict";
import test from "node:test";
import { createDirectPairKey } from "../lib/server/messenger/directConversation";
import { MessengerDomainError } from "../lib/server/messenger/errors";

test("creates one stable pair key for either direct message opener", () => {
  assert.equal(createDirectPairKey("user-a", "user-b"), "user-a:user-b");
  assert.equal(createDirectPairKey("user-b", "user-a"), "user-a:user-b");
});

test("rejects a self direct message", () => {
  assert.throws(() => createDirectPairKey("user-a", "user-a"), (error) => {
    assert.ok(error instanceof MessengerDomainError);
    assert.equal(error.code, "invalid_recipient");
    return true;
  });
});
