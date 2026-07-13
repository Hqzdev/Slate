import assert from "node:assert/strict";
import test from "node:test";
import { EmailVerificationPolicy } from "../lib/server/emailVerificationPolicy";

test("email verification stays required unless preview mode explicitly disables it", () => {
  assert.equal(new EmailVerificationPolicy(() => undefined).isRequired(), true);
  assert.equal(new EmailVerificationPolicy(() => " true ").isRequired(), true);
  assert.equal(new EmailVerificationPolicy(() => "false").isRequired(), false);
});
