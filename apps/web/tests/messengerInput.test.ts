import assert from "node:assert/strict";
import test from "node:test";
import { MessengerDomainError } from "../lib/server/messenger/errors";
import {
  normalizeMessengerBody,
  parseConversationListQuery,
  parseMessengerAttachmentCompletionInput,
  parseMessengerAttachmentReservationInput,
  parseMessengerHistoryQuery,
  parseMessengerReactionInput,
  parseMessengerReceiptInput,
  parseMessengerSendInput
} from "../lib/server/messenger/input";

function searchParams(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name] ?? null;
    }
  };
}

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof MessengerDomainError);
  assert.equal(error.code, code);
  return true;
}

test("normalizes message bodies to NFC and LF", () => {
  const body = normalizeMessengerBody("  cafe\u0301\r\nnext  ");
  assert.equal(body, "café\nnext");
});

test("rejects prohibited controls and oversized code point input", () => {
  assert.throws(() => normalizeMessengerBody("hello\u0007world"), (error) => assertCode(error, "invalid_message"));
  assert.equal(normalizeMessengerBody("🚀".repeat(8_000)).length, 16_000);
  assert.throws(() => normalizeMessengerBody("🚀".repeat(8_001)), (error) => assertCode(error, "message_too_large"));
});

test("requires UUID v4 idempotency keys and accepts bounded attachment identifiers", () => {
  const parsed = parseMessengerSendInput({
    aiAttachmentIds: [],
    attachmentIds: [],
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.equal(parsed.clientRequestId, "e8c947c4-f75c-4e24-a4c4-10416862b94f");
  assert.throws(
    () => parseMessengerSendInput({ body: "Ship it", clientRequestId: "not-a-uuid" }),
    (error) => assertCode(error, "invalid_message")
  );
  const withAttachment = parseMessengerSendInput({
    attachmentIds: ["attachment-1"],
    body: "",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.deepEqual(withAttachment.attachmentIds, ["attachment-1"]);
  assert.equal(withAttachment.body, null);
  assert.throws(() => parseMessengerSendInput({
    attachmentIds: ["attachment-1", "attachment-1"],
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), (error) => assertCode(error, "invalid_attachment"));
  const withAiAttachment = parseMessengerSendInput({
    aiAttachmentIds: ["attachment-1"],
    attachmentIds: ["attachment-1"],
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  });
  assert.deepEqual(withAiAttachment.aiAttachmentIds, ["attachment-1"]);
  assert.throws(() => parseMessengerSendInput({
    aiAttachmentIds: ["attachment-1"],
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), (error) => assertCode(error, "ai_attachment_consent_required"));
  assert.throws(() => parseMessengerSendInput({
    aiAttachmentIds: ["attachment-1", "attachment-2", "attachment-3", "attachment-4"],
    attachmentIds: ["attachment-1", "attachment-2", "attachment-3", "attachment-4"],
    body: "Ship it",
    clientRequestId: "e8c947c4-f75c-4e24-a4c4-10416862b94f"
  }), (error) => assertCode(error, "ai_attachment_limit_exceeded"));
});

test("normalizes attachment reservations and enforces type and size policy", () => {
  assert.deepEqual(parseMessengerAttachmentReservationInput({
    byteSize: 1024,
    declaredContentType: " IMAGE/PNG ",
    fileName: "folder\\cafe\u0301.png"
  }), {
    byteSize: 1024,
    declaredContentType: "image/png",
    fileName: "café.png",
    kind: "image"
  });
  assert.throws(() => parseMessengerAttachmentReservationInput({
    byteSize: 1024,
    declaredContentType: "image/svg+xml",
    fileName: "active.svg"
  }), (error) => assertCode(error, "invalid_attachment"));
  assert.throws(() => parseMessengerAttachmentReservationInput({
    byteSize: 20 * 1024 * 1024 + 1,
    declaredContentType: "image/png",
    fileName: "large.png"
  }), (error) => assertCode(error, "invalid_attachment"));
  assert.deepEqual(parseMessengerAttachmentCompletionInput({ etag: "\"etag-1\"" }), {
    checksum: null,
    etag: "\"etag-1\""
  });
});

test("parses decimal history cursors without unsafe number conversion", () => {
  const parsed = parseMessengerHistoryQuery(searchParams({ afterSequence: "9007199254740993", limit: "100" }));
  assert.equal(parsed.afterSequence, BigInt("9007199254740993"));
  assert.equal(parsed.limit, 100);
  assert.throws(
    () => parseMessengerHistoryQuery(searchParams({ afterSequence: "4", beforeSequence: "8" })),
    (error) => assertCode(error, "invalid_cursor")
  );
  assert.throws(
    () => parseMessengerHistoryQuery(searchParams({ beforeSequence: "0" })),
    (error) => assertCode(error, "invalid_cursor")
  );
});

test("parses monotonic receipt inputs as BigInt values", () => {
  assert.deepEqual(parseMessengerReceiptInput({
    deliveredThroughSequence: "42",
    readThroughSequence: "40"
  }), {
    deliveredThroughSequence: BigInt(42),
    readThroughSequence: BigInt(40)
  });
  assert.throws(() => parseMessengerReceiptInput({}), (error) => assertCode(error, "invalid_cursor"));
  assert.throws(
    () => parseMessengerReceiptInput({ readThroughSequence: 4 }),
    (error) => assertCode(error, "invalid_cursor")
  );
});

test("uses one reaction allowlist and validates conversation cursors", () => {
  assert.equal(parseMessengerReactionInput({ emoji: "🚀" }), "🚀");
  assert.throws(() => parseMessengerReactionInput({ emoji: "🔥" }), (error) => assertCode(error, "invalid_reaction"));
  assert.equal(parseConversationListQuery(searchParams({ limit: "30" })).limit, 30);
  assert.throws(
    () => parseConversationListQuery(searchParams({ cursor: "" })),
    (error) => assertCode(error, "invalid_cursor")
  );
});
