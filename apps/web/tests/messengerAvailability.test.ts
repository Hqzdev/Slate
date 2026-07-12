import assert from "node:assert/strict";
import test from "node:test";
import { MessengerAvailability } from "../lib/server/messenger/availability";
import { MessengerAttachmentAvailability } from "../lib/server/messenger/attachmentAvailability";
import { MessengerDomainError } from "../lib/server/messenger/errors";

test("keeps Messenger routes closed until the rollout flag is explicitly enabled", () => {
  assert.doesNotThrow(() => new MessengerAvailability(() => "true").requireEnabled());
  for (const value of [undefined, "", "false", "1"]) {
    assert.throws(
      () => new MessengerAvailability(() => value).requireEnabled(),
      (error) => error instanceof MessengerDomainError && error.code === "messenger_unavailable"
    );
  }
});

test("keeps attachment routes behind an independent rollout flag", () => {
  assert.doesNotThrow(() => new MessengerAttachmentAvailability({ MESSENGER_ATTACHMENTS_ENABLED: "true" }).requireEnabled());
  assert.throws(
    () => new MessengerAttachmentAvailability({ MESSENGER_ATTACHMENTS_ENABLED: "false" }).requireEnabled(),
    (error) => error instanceof MessengerDomainError && error.code === "attachments_unavailable"
  );
});
