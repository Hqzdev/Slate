import assert from "node:assert/strict";
import test from "node:test";
import { parseMessengerAiMention } from "../lib/server/messenger/aiMention";
import { isMessengerAiEnabled, redactMessengerAiSecrets, requiresExplicitRedispatch } from "../lib/server/messenger/messengerAiService";

test("accepts only a standalone Slate AI mention outside code", () => {
  assert.deepEqual(parseMessengerAiMention("@slateai summarize this"), { providerPrompt: "summarize this", valid: true });
  assert.deepEqual(parseMessengerAiMention("Please ask @SlateAI now"), { providerPrompt: "Please ask now", valid: true });
  assert.equal(parseMessengerAiMention("name@slateai.example").valid, false);
  assert.equal(parseMessengerAiMention("@slateai_helper").valid, false);
  assert.equal(parseMessengerAiMention("`@slateai summarize`" ).valid, false);
  assert.equal(parseMessengerAiMention("```text\n@slateai\n```" ).valid, false);
  assert.equal(parseMessengerAiMention("＠slateai summarize").valid, false);
});

test("removes every valid mention from the provider prompt", () => {
  assert.deepEqual(parseMessengerAiMention("@slateai compare this with @slateai that"), { providerPrompt: "compare this with that", valid: true });
});

test("redacts common credential shapes before provider dispatch", () => {
  const value = redactMessengerAiSecrets("token=abcdefghijklmnop sk-abcdefghijklmnop AKIAABCDEFGHIJKLMNOP");
  assert.equal(value.includes("abcdefghijklmnop"), false);
  assert.equal(value, "token=[REDACTED] [REDACTED_TOKEN] [REDACTED_TOKEN]");
});

test("keeps Messenger AI default-off and requires explicit redispatch after dispatch", () => {
  assert.equal(isMessengerAiEnabled({}), false);
  assert.equal(isMessengerAiEnabled({ MESSENGER_AI_ENABLED: "true" }), true);
  assert.equal(isMessengerAiEnabled({ MESSENGER_AI_ENABLED: "true", MESSENGER_AI_KILL_SWITCH: "true" }), false);
  assert.equal(requiresExplicitRedispatch({ providerDispatchState: "dispatching", status: "running" }), true);
  assert.equal(requiresExplicitRedispatch({ providerDispatchState: "not_dispatched", status: "running" }), false);
  assert.equal(requiresExplicitRedispatch({ providerDispatchState: "dispatched", status: "completed" }), false);
});
