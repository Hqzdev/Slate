# Phase 1: Messenger data and access foundation

## Implementation status

Implemented on July 11, 2026. The shipped slice includes additive migration `0015_messenger_foundation`, batched `messenger:backfill`, clean-database `messenger:smoke`, encrypted text persistence, General membership lifecycle integration, rollout-gated REST routes, receipts, reactions, outbox persistence, and unit/integration-oriented verification. Realtime publication remains phase 3; phase 1 only commits outbox rows.

## Goal and phase boundary

This phase creates the durable model, repository, access policy, General provisioning, encryption envelope, idempotent message path, receipts, reactions, audit hooks, and migration tests. It does not expose attachment, DM, or AI controls in the UI yet.

The implementation belongs in the existing web server and Prisma schema, with small single-purpose services:

- `MessengerAccessPolicy` composes `WorkspaceAccessPolicy` and conversation membership.
- `MessengerRepository` owns conversation, message, receipt, and reaction transactions.
- `MessengerProvisioningService` owns General creation, backfill, and membership reconciliation.
- `MessengerPayloadCodec` owns authorized encryption/decryption of message payloads.
- `MessengerOutboxRepository` appends durable realtime notifications inside domain transactions.

Route handlers authenticate, parse, call one service operation, and map domain errors. They must not duplicate permission or transaction rules.

## User scenarios

1. A new workspace is created. The owner, General conversation, General membership, and initial receipt exist before the workspace is returned.
2. An existing workspace is migrated. One General conversation is created and every current unblocked member is added exactly once.
3. An invite is accepted. General membership and a receipt are created or reactivated in the same transaction as `WorkspaceMember`.
4. A member is removed or blocked. Their Messenger memberships become revoked and a durable access-revocation event is appended before the operation succeeds.
5. A role changes from editor to viewer or back. Read access remains, write capability changes, and active clients refresh their capability state.
6. A writer retries the same message after a timeout. The original canonical message is returned without allocating a second sequence.
7. A reader advances delivered/read cursors out of order from multiple tabs. The server preserves the maximum valid cursor.
8. A writer adds or removes one of the supported reactions. Concurrent duplicate requests converge on one reaction row.

## Domain naming

Slate already has `AiConversation` and `AiMessage`. Prisma models therefore use a `Messenger` prefix, while public DTOs use the requested product names:

| Public DTO | Prisma model |
| --- | --- |
| `Conversation` | `MessengerConversation` |
| `ConversationMember` | `MessengerConversationMember` |
| `Message` | `MessengerMessage` |
| `MessageAttachment` | `MessengerMessageAttachment` |
| `MessageReceipt` | `MessengerMessageReceipt` |
| `MessageReaction` | `MessengerMessageReaction` |

## Enums

| Enum | Values |
| --- | --- |
| `MessengerConversationKind` | `general`, `direct` |
| `MessengerMembershipState` | `active`, `revoked` |
| `MessengerAuthorKind` | `member`, `slate_ai`, `system` |
| `MessengerAttachmentKind` | Added in phase 4: `image`, `video`, `file` |
| `MessengerAttachmentStatus` | Added in phase 4: `reserved`, `uploaded`, `scanning`, `ready`, `attached`, `rejected`, `expired`, `deleting` |
| `MessengerAiInvocationStatus` | Added in phase 6: `skipped`, `queued`, `running`, `completed`, `failed`, `cancelled` |
| `MessengerOutboxStatus` | `pending`, `published` |
| `MessengerPayloadEncoding` | `server_aead_v1`; future `client_e2ee_v1` only after a real E2EE design |

Enums are persisted as Prisma enums rather than arbitrary strings. State transitions are enforced in domain services and covered by tests.

## Data model

### `MessengerConversation`

Required fields:

- `id`, `workspaceId`, `kind`, `createdAt`, `updatedAt`.
- `generalKey String? @unique`. It equals `workspaceId` only for General and is null for DMs.
- `directPairKey String?`. It contains the two sorted user IDs only for a DM.
- `createdByUserId String?` for a provisional DM creator.
- `activatedAt DateTime?`. General is activated at creation; a DM is activated by its first accepted message.
- `lastMessageSequence BigInt @default(0)`, `retainedFromSequence BigInt @default(1)`, and `lastMessageAt DateTime?`.

Constraints:

- `@@unique([workspaceId, directPairKey])` prevents duplicate DMs while allowing null for General.
- A SQL migration check requires `kind = general` to have `generalKey = workspaceId`, null `directPairKey`, and non-null `activatedAt`. A direct conversation requires null `generalKey` and non-null `directPairKey`.
- No public or repository operation mutates conversation kind.
- Deleting a workspace cascades conversation metadata, but attachment object cleanup still runs through the deletion workflow in phase 7.

### `MessengerConversationMember`

Required fields:

- `conversationId`, `userId`, `state`.
- `joinedAt`, `revokedAt`.
- `historyFromSequence BigInt @default(1)`.
- `openedAt DateTime?`, used only to remember which participant explicitly opened a provisional DM.
- `createdAt`, `updatedAt`.

Constraints:

- `@@unique([conversationId, userId])`.
- Active membership requires `revokedAt = null`; revoked membership requires a timestamp.
- Current General/workspace membership parity and the exact two-row DM invariant are transactional service/reconciliation invariants because ordinary PostgreSQL `CHECK` constraints cannot reference other tables.

New and re-added General members use `historyFromSequence = 1` and may read all retained General history. DM reactivation rules are defined in `05-direct-messages.md`.

### `MessengerMessage`

Required fields:

- `id`, `conversationId`, `sequence BigInt`, `authorKind`, `createdAt`.
- `authorUserId String?`. It is required for `member` and null for `slate_ai` or `system`. The member relation does not cascade-delete message history when a workspace membership is removed.
- `clientRequestId String?` and `requestFingerprint String?` for member idempotency.
- `bodyCiphertext Bytes?`, `bodyNonce Bytes?`, `bodyKeyVersion Int?`, `bodyEncoding`.
- Phase 6 adds `inReplyToMessageId String?` for assistant attribution and `aiInvocationId String? @unique` for one stored AI response per invocation.

Constraints:

- `@@unique([conversationId, sequence])`.
- `@@unique([conversationId, authorUserId, clientRequestId])`.
- SQL checks enforce the author/user relationship and require idempotency fields for member messages. The repository transaction enforces the cross-table invariant that a message has either a non-empty encrypted body or at least one claimed attachment.
- The normalized request fingerprint is a keyed server-side digest of body plus ordered attachment IDs. It must not be a plain hash of low-entropy message text.
- Messages are immutable after commit. User edit/delete endpoints do not exist in the first release.

`sequence` is allocated by atomically incrementing `MessengerConversation.lastMessageSequence` inside the same transaction. JSON DTOs serialize every sequence as a decimal string because JSON cannot represent Prisma `BigInt` safely.

### `MessengerMessageReceipt`

Receipts are cursor-based, not one row per message/member pair.

Required fields:

- `conversationId`, `userId`.
- `deliveredThroughSequence BigInt @default(0)`.
- `readThroughSequence BigInt @default(0)`.
- `deliveredAt DateTime?`, `readAt DateTime?`, `updatedAt`.

Constraints:

- `@@unique([conversationId, userId])`.
- The row belongs to the same user as an existing conversation member.
- `0 <= readThroughSequence <= deliveredThroughSequence <= conversation.lastMessageSequence`.
- Both cursors move only forward.

The same-conversation, visibility, and high-water comparisons are transactionally enforced repository invariants, not cross-table `CHECK` constraints.

`delivered` means the authorized client acknowledged receipt of content through a sequence. `read` means the client had the conversation in the foreground and the latest acknowledged item was visible. For a DM, the sender can derive sent/delivered/read state from the other participant's cursor. General does not expose a noisy per-member read roster in the first UI.

### `MessengerMessageReaction`

Required fields:

- `id`, `messageId`, `userId`, `emoji`, `createdAt`.

Constraints:

- `@@unique([messageId, userId, emoji])`.
- The user must currently be allowed to write in the message's conversation.
- The first release uses one central allowlist: 👍, ❤️, 😂, 🎉, 😮, 😢, 👀, and 🚀.
- Removing a reaction is allowed only to its creator.

### Supporting models

`MessengerMessageAttachment` is added by the phase 4 migration. `MessengerAiInvocation`, `MessengerAiInvocationAttachment`, and the AI-specific message relation fields are added by the phase 6 migration. Phase 1 does not depend on those later tables.

`MessengerOutboxEvent` contains `id`, `eventId @unique`, `workspaceId`, optional `conversationId` and server-only `targetUserId`, `type`, minimal `payload`, `status`, `attemptCount`, `availableAt`, `publishedAt`, `createdAt`, and `lastErrorCode`. It never contains message text, filenames, signed URLs, grants, or decrypted attachment content.

`MessengerKeyEnvelope` contains `workspaceId`, `version`, wrapped data-key bytes, KMS key identifier, state, and rotation timestamps. Raw data keys never enter Postgres or logs. The detailed key lifecycle is in `07-security-and-operations.md`.

`WorkspaceMember` gains a monotonically increasing `messengerAccessVersion` within that membership row. Grants bind both `WorkspaceMember.id` as a random membership epoch and its access version. Removal deletes the row; a later rejoin creates a new membership ID, so an old grant cannot become valid when the version restarts. `WorkspaceSettings` gains `messengerAiEnabled`. New Messenger-enabled workspaces default it on; an existing-workspace dark rollout may backfill it off until provider review/enablement. A global kill switch always overrides the workspace setting.

## Public DTOs

### `Conversation`

Returns `id`, `workspaceId`, `kind`, derived `title` and avatar, `activatedAt`, `lastMessageAt`, `lastMessageSequence`, `retainedFromSequence`, authorized last-message preview, `unreadCount`, current-user capabilities, and participant summary. A DM title/avatar always derive from the other current member and are never stored as user-controlled conversation text.

### `ConversationMember`

Returns `userId`, safe identity fields already exposed by workspace membership, `state`, `joinedAt`, and current role. It never exposes email to users who cannot already see that workspace member.

### `Message`

Returns `id`, `conversationId`, decimal-string `sequence`, `author`, authorized decrypted `body`, `createdAt`, `inReplyToMessageId`, `attachments`, aggregated reactions, and the caller-relevant receipt state. Ciphertext, nonce, key version, request fingerprint, provider IDs, and internal moderation/scan data never leave the server.

### `MessageReceipt`

Returns `userId`, `deliveredThroughSequence`, `readThroughSequence`, `deliveredAt`, and `readAt`. General responses may aggregate counts instead of returning every member receipt.

## General provisioning and membership lifecycle

### New workspace

`WorkspaceRepository.createDefaultWorkspaceForUser` currently creates the workspace and owner membership before settings and starter documents. The Messenger implementation must refactor the creation path so workspace, owner `WorkspaceMember`, General, General membership, initial receipt, and key envelope are created in one transaction. Starter documents may remain a later step only if existing workspace creation semantics allow it.

### Existing workspace backfill

The additive migration creates the new tables without enabling the UI. An idempotent backfill then:

1. Selects every workspace in bounded batches.
2. Upserts General by `generalKey = workspaceId`.
3. Upserts active General membership and receipts for every unblocked `WorkspaceMember`.
4. Marks stray General memberships revoked.
5. Verifies one General and exact active-member parity.
6. Records aggregate migration metrics without names or message content.

The feature flag is enabled only after the reconciliation query reports zero invariant violations. Rerunning the backfill must produce no duplicates.

### Invite acceptance

`InviteRepository.acceptInviteById` adds/reactivates General membership and its receipt in the same transaction as `workspaceMember.upsert`. A block continues to prevent acceptance.

### Removal and block

`WorkspaceRepository.removeWorkspaceMember` and `blockWorkspaceMember` capture the current `WorkspaceMember.id`/access version, revoke the affected user's active Messenger memberships, append a targeted `access.revoked` outbox event, and record metadata-only audit in the same transaction that deletes the workspace membership. Publication failure cannot erase the durable revocation event.

### Unblock and rejoin

The current `unblockWorkspaceUser` removes `WorkspaceBlock` but does not recreate `WorkspaceMember`. It therefore does not restore Messenger access. A later valid invite acceptance reactivates General; DM membership remains revoked until the explicit canonical DM operation described in phase 5.

### Role change

Role changes do not alter conversation membership. They increment `messengerAccessVersion` and append `capabilities.changed`. Every HTTP operation still evaluates the current role, so a stale client cannot keep write access.

## Message creation transaction

The message service performs a cheap policy check before opening a transaction, then repeats all security-sensitive reads inside the transaction to avoid time-of-check/time-of-use gaps:

1. Re-read the unblocked workspace member and active conversation membership.
2. Require owner/editor for member messages.
3. Normalize body to Unicode NFC, convert CRLF to LF, reject prohibited controls, and enforce 8,000 Unicode code points.
4. Validate `clientRequestId` as a UUID generated by `crypto.randomUUID()`.
5. Look up an existing idempotency row. Return it if the keyed fingerprint matches; otherwise return `idempotency_conflict`.
6. Validate and lock every claimed attachment when phase 4 is enabled.
7. Atomically increment `lastMessageSequence` and use the returned value.
8. Encrypt the body and create the message.
9. Claim attachments, activate a provisional DM if needed, update `lastMessageAt`, and advance the sender receipt.
10. Add the minimal message/conversation outbox events. Phase 6 extends this transaction with an AI invocation only after its schema is deployed.
11. Commit, then return the canonical DTO.

If any step fails, message, sequence increment, attachment claims, AI task, receipt, and outbox changes all roll back.

## API contracts

### Unread summary

`GET /api/workspaces/:workspaceId/messenger/unread` returns:

```json
{
  "total": 4,
  "byConversation": [
    { "conversationId": "conversation-id", "unreadCount": 4 }
  ]
}
```

Unread counts include visible messages above `readThroughSequence` that were not authored by the current user. They do not use raw sequence subtraction because retention may create gaps.

### Conversation list

`GET /api/workspaces/:workspaceId/messenger/conversations?cursor=<opaque>&limit=30` returns only active visible memberships. General is pinned first, followed by activated DMs ordered by `lastMessageAt DESC, id DESC`. A provisional DM is visible only to a pair member whose `openedAt` proves that user explicitly opened it.

### History

`GET /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages` accepts exactly one of:

- `beforeSequence=<decimal>` for older pagination.
- `afterSequence=<decimal>` for reconnect recovery.
- Neither for the latest page.

`limit` defaults to 50 and is capped at 100. Results are returned in ascending sequence order with `hasMoreBefore`, `hasMoreAfter`, `oldestSequence`, `newestSequence`, `retainedFromSequence`, `resolvedThroughSequence`, and `serverLastSequence`. `resolvedThroughSequence` tells recovery that every visible sequence through that value is accounted for even when retention removed an old prefix or the page is empty.

### Send

`POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages` accepts:

```json
{
  "body": "Message text",
  "clientRequestId": "uuid",
  "attachmentIds": [],
  "aiAttachmentIds": []
}
```

`attachmentIds` and `aiAttachmentIds` are rejected until their phases are enabled. A successful new send returns `201`; an exact idempotent replay returns `200` with `replayed: true`.

### Receipt

`PUT /api/workspaces/:workspaceId/messenger/conversations/:conversationId/receipt` accepts decimal strings:

```json
{
  "deliveredThroughSequence": "42",
  "readThroughSequence": "40"
}
```

Omitted values remain unchanged. Lower values are harmless no-ops. A cursor for a message outside the conversation or outside the member's visible range is rejected.

### Reactions

`POST .../messages/:messageId/reactions` accepts `{ "emoji": "👍" }`. Repeating the same request returns the existing reaction. `DELETE .../reactions/:reactionId` removes only the caller's row. Both operations append `reaction.changed` to the outbox.

## Realtime events in this phase

Phase 1 persists but does not yet deliver these outbox types:

| Type | Payload |
| --- | --- |
| `conversation.added` | `conversationId` |
| `conversation.changed` | `conversationId` |
| `message.created` | `messageId`, `sequence` |
| `reaction.changed` | `messageId`, `sequence` |
| `receipt.changed` | `userId`, delivered/read sequences |
| `capabilities.changed` | `userId`, access version |
| `access.revoked` | `userId`, scope, reason |

General receipt events target only the same user's tabs. DM receipt events may target both participants because phase 5 displays delivered/read state. Unclaimed attachment state targets only its creator. The outbox publisher and gateway preserve this audience metadata without placing it in the public event payload.

Phase 3 publishes them. Keeping outbox writes in phase 1 prevents later reliability retrofits.

## Permissions

`MessengerAccessPolicy` first calls the injectable `WorkspaceAccessPolicy.requireWorkspaceReader` or `requireWorkspaceWriter`, then checks active conversation membership and resource lineage.

For a provisional DM with `activatedAt = null`, membership alone is insufficient: the caller's `openedAt` must be non-null. After activation, either active pair member may read.

| Operation | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| List/read visible conversations | allow | allow | allow |
| Advance own receipt | allow | allow | allow |
| Send message | allow | allow | deny |
| Add/remove own reaction | allow | allow | deny |
| Create/reactivate DM | allow | allow | deny |
| Provision or change General membership directly | deny | deny | deny |
| Read a non-participant DM | deny | deny | deny |

Only internal, authenticated service code may create `slate_ai` or `system` messages. Workspace owners have administrative metadata visibility through audit tooling but no third-party DM content access.

## Audit and activity

Reuse `AuditEvent` and `auditLogService` with typed builders and an allowlist of metadata keys. Audit:

- `messenger.general.provisioned`.
- `messenger.membership.revoked` and `messenger.membership.reactivated`.
- `messenger.dm.created`.
- `messenger.attachment.rejected` and cleanup failure.
- `messenger.ai.invoked`, disabled, cancelled, and failed outcome.
- `messenger.retention.completed` and key rotation.
- Repeated denied or suspicious access attempts after sampling/thresholding.

Do not audit ordinary message bodies, reaction text beyond the fixed code, original filenames, decrypted previews, signed operations, grants, session identifiers, provider prompts, or attachment extracts. Workspace-wide `ActivityEvent` must not reveal that a private DM exists or who participates. It may continue to show safe existing events such as an applied AI draft.

## Errors

| Status | Code | Retryable | Meaning |
| --- | --- | --- | --- |
| `400` | `invalid_message` | no | Invalid normalization, empty body without attachments, or malformed UUID |
| `400` | `invalid_cursor` | no | Cursor is malformed or outside allowed range |
| `401` | `authentication_required` | no | No valid httpOnly-cookie session |
| `403` | `workspace_write_denied` | no | Current role is read-only |
| `404` | `resource_not_found` | no | Workspace scope is missing or inaccessible |
| `404` | `conversation_not_found` | no | Missing or inaccessible conversation |
| `404` | `message_not_found` | no | Missing or inaccessible message |
| `409` | `idempotency_conflict` | no | Same request ID with different normalized input |
| `409` | `conversation_inactive` | no | DM cannot currently be reactivated |
| `413` | `message_too_large` | no | Normalized body exceeds 8,000 code points |
| `429` | `rate_limited` | yes | IP/user/workspace bucket exhausted |
| `503` | `messenger_unavailable` | yes | Required persistence dependency is unavailable |

## Edge cases

- Two workspace-creation retries converge on one General through `generalKey`.
- A backfill racing with invite acceptance uses upserts and exact unique constraints.
- A removal racing with a send is resolved by the in-transaction membership recheck; either the send commits before revocation or is denied, never partially accepted.
- A role downgrade racing with a send follows the same transaction rule.
- Two identical message requests can both begin, but the unique idempotency constraint and transaction rollback produce one canonical row.
- Two different users may legitimately generate the same UUID; including `authorUserId` in the unique key prevents a false collision.
- Server timestamps are informational; sequence is authoritative for ordering.
- Multiple tabs can submit stale receipts, but max-only cursor updates prevent unread rollback.
- Retention may delete the message referenced by an old cursor. The receipt keeps its numeric sequence and remains valid.
- Workspace-member removal leaves the global author relation for retained history but does not restore access. A future account-deletion workflow must anonymize to a neutral deleted-member identity before deleting the `User`; message rows must never cascade-delete accidentally.
- Assistant/system messages have no ordinary user relation and cannot be forged through the public send endpoint.
- Key-service failure fails closed: encrypted content is not stored as plaintext and no message is accepted without an outbox row.

## Acceptance criteria

- New workspace creation atomically produces one owner membership, one General, one active General member, one receipt, and one key envelope.
- Existing-workspace backfill is idempotent and reconciliation reports exact parity with current unblocked members.
- Invite acceptance, removal, block, unblock, rejoin, and role change follow the documented lifecycle.
- Database unique/check constraints reject a second General, malformed kind/key combination, duplicate DM pair, duplicate sequence, invalid author kind, and duplicate reaction.
- Transactional invariant tests reject General/workspace membership drift, an incorrect DM member set, invalid receipt high-water marks, and empty messages.
- Unit tests prove `MessengerAccessPolicy` for every role, block state, conversation kind, and third-party DM attempt.
- Repository tests prove idempotency replay/conflict, atomic sequence allocation, sender receipt advancement, reaction convergence, and transaction rollback.
- API tests prove non-enumerating IDOR responses for conversation, message, receipt, and reaction routes.
- No plaintext body, original filename, grant, signed operation, or provider prompt appears in Postgres fields not designated as ciphertext, logs, audit metadata, or outbox payloads.
- Phase 2 can consume the documented DTOs without reaching into Prisma models.
