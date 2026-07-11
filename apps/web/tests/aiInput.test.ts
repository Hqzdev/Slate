import assert from "node:assert/strict";
import test from "node:test";
import { parseActionIds, parseAiMessageInput, parseConversationCursor } from "../lib/server/ai/input";

test("AI message input normalizes bounded values", () => {
  assert.deepEqual(parseAiMessageInput({
    activeDocumentId: "document-1",
    clientRequestId: "request-1",
    content: "  Explain this workspace  "
  }), {
    activeDocumentId: "document-1",
    clientRequestId: "request-1",
    content: "Explain this workspace",
    conversationId: null,
    mode: "ask"
  });
});

test("AI message input accepts explicit modes and rejects unknown capabilities", () => {
  for (const mode of ["ask", "plan", "agent"] as const) {
    assert.equal(parseAiMessageInput({ clientRequestId: `request-${mode}`, content: "Task", mode }).mode, mode);
  }
  assert.throws(() => parseAiMessageInput({ clientRequestId: "request-1", content: "Task", mode: "write" }), /mode must be/);
});

test("AI message input rejects empty and oversized messages", () => {
  assert.throws(() => parseAiMessageInput({ clientRequestId: "request-1", content: " " }), /content must contain/);
  assert.throws(() => parseAiMessageInput({ clientRequestId: "request-1", content: "x".repeat(4_001) }), /content must contain/);
  assert.throws(() => parseAiMessageInput({ clientRequestId: "request-1", content: "before\u0000after" }), /content must contain/);
  assert.throws(() => parseAiMessageInput({ clientRequestId: "request-\ud800", content: "safe" }), /clientRequestId must contain/);
});

test("AI action batches require unique bounded ids", () => {
  assert.deepEqual(parseActionIds({ actionIds: ["action-1", "action-2"] }), ["action-1", "action-2"]);
  assert.throws(() => parseActionIds({ actionIds: ["action-1", "action-1"] }), /must be unique/);
  assert.throws(() => parseActionIds({ actionIds: [] }), /between 1 and 6/);
  assert.throws(() => parseActionIds({ actionIds: Array.from({ length: 7 }, (_, index) => `action-${index}`) }), /between 1 and 6/);
});

test("conversation cursor accepts null and rejects oversized values", () => {
  assert.equal(parseConversationCursor(null), null);
  assert.equal(parseConversationCursor("message-1"), "message-1");
  assert.throws(() => parseConversationCursor("x".repeat(161)), /cursor is invalid/);
});
