# Slate Messenger: phased implementation plan

## Document status

This directory is the implementation contract for the first Slate Messenger release. It defines product scope, service boundaries, storage and realtime contracts, access rules, failure behavior, migration requirements, and release gates.

Phases 1 through 7 are implemented as of July 11, 2026. The release includes the encrypted General and DM data paths, responsive Messenger UI, isolated realtime delivery, private attachments and authorized streaming, canonical direct conversations, explicit-mention Slate AI, consented encrypted attachment extraction, retention and tombstone replay, readiness, metrics, CI, and staging verification harnesses. Text, realtime, attachments, and AI remain independently closed behind rollout flags. Production enablement still requires the environment-specific staging exercises and approvals in phases 7 and 8.

The numbered documents are ordered by dependency. A phase is complete only when its acceptance criteria pass; later UI controls must not be exposed early as placeholders.

## Product outcome

Slate Messenger is a workspace-scoped communication surface opened from a dedicated `Messenger` item in the `Workspace` section of the primary sidebar. Every workspace has one immutable `General` conversation containing all active members. Active members may also have one private direct-message conversation per user pair within that workspace.

The first release includes:

- Text messages with immutable server-assigned ordering.
- One automatic `General` group per workspace.
- Private one-to-one direct messages.
- Cursor-based delivered/read receipts and unread counters.
- Lightweight emoji reactions.
- Images, videos, and allowlisted files with safe compact previews.
- A separate Messenger realtime channel for low-latency notifications and recovery.
- `@slateai` in `General` only, triggered by an explicit valid mention.
- Server-side encryption at rest, TLS, strict authorization, audit events, retention, and abuse controls.

The first release excludes custom groups, group DMs, message editing, user-initiated message deletion, threads, forwarding, public links, voice/video calls, full-text search, bots other than Slate AI, and end-to-end encryption. No excluded feature may appear as an inactive or partially working control.

## Architectural decisions

1. Postgres is the durable source of truth for conversations, messages, membership, receipts, reactions, attachment metadata, AI tasks, and the realtime outbox.
2. `services/sync` remains Yjs-only. Messenger uses a separate `services/messenger-realtime` JSON gateway and never writes to `DocumentRealtime`.
3. A browser keeps one Messenger websocket for the active workspace, not one socket per conversation. The gateway filters every event by the authenticated user's current conversation membership.
4. Browser writes use authorized HTTP APIs. Websocket events are notifications and never authoritative write commands.
5. Every accepted state change and its `MessengerOutboxEvent` are committed in the same database transaction. An outbox publisher retries delivery to Redis; clients recover missed data through REST.
6. Every message receives an atomic, monotonically increasing `sequence` within its conversation. Pagination, deduplication, read cursors, and reconnect recovery use this value.
7. Message text and sensitive filenames are stored as server-encrypted payloads. Authorized APIs return decrypted DTOs. Attachment bytes live only in private object storage.
8. Upload uses a short-lived signed operation limited to one reserved object. Preview and download bytes pass through an authorized, range-capable media route so a stale public URL cannot bypass a later block.
9. Messenger AI uses a dedicated bounded context builder. It does not reuse the existing workspace-document context builder for ordinary chat answers.
10. Workspace changes proposed from Messenger are handed to the existing user-owned draft/apply flow. The model never writes files, settings, members, or messages directly.
11. Product activity and security audit remain separate. Messenger reuses the existing `ActivityEvent` and `AuditEvent` infrastructure rather than creating a parallel audit system.

## System map

```text
WorkspaceMessengerPage
  -> Next.js Messenger APIs
     -> MessengerAccessPolicy -> WorkspaceAccessPolicy
     -> MessengerRepository -> Postgres
     -> MessengerOutboxPublisher -> Redis
     -> MessengerAttachmentService -> private object storage
     -> MessengerAiService -> existing provider adapter

services/messenger-realtime
  <- signed workspace grant
  <- Redis outbox notifications
  -> authorized JSON events

services/messenger-media
  <- durable Postgres media-job leases
  -> ClamAV bounded stream scan
  -> private object storage
  -> safe metadata, thumbnails, and video posters
```

`services/messenger-media` is a separately isolated worker responsibility. It must not run untrusted media parsers inside the web process or the code-execution worker.

## Phases

| Phase | Deliverable | Depends on | Completion gate |
| --- | --- | --- | --- |
| 1. Data and access | Schema, General provisioning/backfill, policy, repository, receipts, reactions, encryption envelope, tests | Existing workspace membership and audit layers | General invariant and IDOR/access tests pass |
| 2. General UI | Sidebar destination, General history, text composer, receipts, reactions, unread state | Phase 1 | Desktop/mobile, offline, pagination, XSS, and accessibility tests pass |
| 3. Realtime | Separate gateway, signed grants, outbox, reconnect recovery, revocation | Phases 1–2 | Duplicate/order/offline/revocation tests pass |
| 4. Attachments | Private upload, scan, metadata extraction, safe previews, authorized media delivery | Phases 1–3 | Type, limit, malware, access, cleanup, and range tests pass |
| 5. Direct messages | Canonical pair conversation, privacy isolation, activation and rejoin rules | Phases 1–4 | Concurrency, third-party IDOR, block, and cross-workspace tests pass |
| 6. Slate AI | Explicit General mention, bounded context, attachment consent, draft handoff | Phases 1–5 | Context-isolation, idempotency, revocation, and no-DM-AI tests pass |
| 7. Hardening | Key management, retention/deletion jobs, observability, runbooks, load/security gates | All phases | Production release gates in `07-security-and-operations.md` pass |

## User scenarios

1. A member opens `Messenger`. The client loads the aggregate unread count, visible conversations, and the latest page of `General` without changing the active document or losing unsaved editor state.
2. An owner or editor sends text. The client shows a pending item, the server authorizes and persists it idempotently, and the canonical message replaces the pending item.
3. A viewer opens and reads `General` or an existing DM but sees a read-only explanation instead of a composer.
4. A writer uploads an allowlisted file. Other members see it only after object verification, malware scanning, and an atomic claim by a message.
5. A writer starts a DM with another active, unblocked member. The server reuses the canonical pair conversation and exposes it to the recipient only after the first accepted message.
6. A writer sends a valid `@slateai` mention in `General`. The human message remains accepted even if AI is unavailable; one durable AI task later creates at most one assistant reply.
7. An owner removes or blocks a member. New API requests, media requests, AI work, and realtime delivery are denied immediately; active sockets and tracked media streams are revoked.
8. An offline client reconnects, refreshes authorization, fetches all messages after its last durable sequence, merges duplicates, and resumes unread state.

## Data model

Prisma model names use a `Messenger` prefix because Slate already has `AiConversation` and `AiMessage`. Public domain DTOs keep the requested concise names.

| Public type | Prisma source | Purpose |
| --- | --- | --- |
| `Conversation` | `MessengerConversation` | General or canonical DM summary |
| `ConversationMember` | `MessengerConversationMember` | Active/revoked conversation membership |
| `Message` | `MessengerMessage` | Authorized decrypted message DTO |
| `MessageAttachment` | `MessengerMessageAttachment` | Attachment metadata and safe variants |
| `MessageReceipt` | `MessengerMessageReceipt` | Per-member delivered/read cursors |
| `MessageReaction` | `MessengerMessageReaction` | One user's emoji reaction |

Supporting persistence includes `MessengerMediaJob`, `MessengerAiInvocation`, `MessengerAiInvocationAttachment`, `MessengerAiHandoff`, `MessengerOutboxEvent`, `MessengerKeyEnvelope`, and `MessengerDeletionTombstone`. `AuditEvent` is reused for sensitive metadata-only events.

## API inventory

All resource routes are workspace-nested so authorization always has both `workspaceId` and the resource identifier.

| Method and route | Purpose |
| --- | --- |
| `GET /api/workspaces/:workspaceId/messenger/unread` | Lightweight aggregate unread count for the sidebar |
| `GET /api/workspaces/:workspaceId/messenger/conversations` | Visible conversation summaries and cursors |
| `POST /api/workspaces/:workspaceId/messenger/direct-conversations` | Find, create, or reactivate a canonical DM |
| `GET /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages` | Older-page or reconnect-delta history |
| `POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages` | Idempotent message creation and attachment claim |
| `PUT /api/workspaces/:workspaceId/messenger/conversations/:conversationId/receipt` | Monotonic delivered/read cursor update |
| `POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages/:messageId/reactions` | Add a reaction |
| `DELETE /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages/:messageId/reactions/:reactionId` | Remove the caller's reaction |
| `POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/attachments` | Reserve a private upload |
| `POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/attachments/:attachmentId/complete` | Confirm upload and start verification |
| `GET /api/workspaces/:workspaceId/messenger/conversations/:conversationId/attachments/:attachmentId` | Read processing status |
| `GET /api/workspaces/:workspaceId/messenger/conversations/:conversationId/attachments/:attachmentId/content` | Authorized original/preview byte stream |
| `DELETE /api/workspaces/:workspaceId/messenger/conversations/:conversationId/attachments/:attachmentId` | Abandon an unclaimed upload |
| `POST /api/workspaces/:workspaceId/messenger/realtime/authorize` | Issue a no-store Messenger grant |
| `POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages/:messageId/ai-invocations` | Retry an existing idempotent AI invocation |
| `GET /api/workspaces/:workspaceId/messenger/ai-invocations/:invocationId` | Read safe AI task status |

Once phase 6 is deployed, the message endpoint creates one durable `queued` or `skipped` AI invocation when a valid General mention is accepted. The explicit AI route never turns an ordinary message into an invocation and cannot enable AI in a DM.

## Realtime event inventory

Every server event uses the envelope `{ version, eventId, type, workspaceId, conversationId?, occurredAt, payload }`. `conversationId` is absent for workspace/control events. Events contain identifiers and sequence cursors, not attachment bytes, signed URLs, grants, or secrets.

| Event | Minimal payload |
| --- | --- |
| `conversation.added` | `conversationId` |
| `conversation.changed` | `conversationId` |
| `message.created` | `messageId`, `sequence` |
| `reaction.changed` | `messageId`, `sequence` |
| `receipt.changed` | `userId`, delivered/read sequence |
| `attachment.changed` | `attachmentId`, safe status |
| `ai.invocation.changed` | `invocationId`, safe status |
| `capabilities.changed` | current read/write capabilities |
| `access.revoked` | resource scope and reason code |

Outbox events may carry a server-only `targetUserId`. General receipt changes go only to that user's own tabs, DM receipts go to the two participants, unclaimed attachment status goes only to its creator, and revocation goes only to the affected principal. Targeted revocation/capability events are matched by authenticated subject even after conversation membership is removed; they do not pass through the ordinary conversation-membership filter. A workspace socket never implies workspace-wide disclosure of private state.

On any event requiring content, the client fetches the authorized REST delta. This keeps the websocket non-authoritative and prevents stale event payloads from bypassing a newly applied block.

## Permissions

| Action | Owner | Editor | Viewer | Removed or blocked |
| --- | --- | --- | --- | --- |
| List/read General | allow | allow | allow | deny |
| Receive Messenger events | allow | allow | allow | deny |
| Send text or react | allow | allow | deny | deny |
| Upload or download an authorized attachment | allow | allow | read/download only | deny |
| Create/reactivate a DM | allow | allow | deny | deny |
| Read an existing DM as one of its two members | allow | allow | allow | deny |
| Read a DM as a workspace owner but non-participant | deny | deny | deny | deny |
| Invoke Messenger AI | allow | allow | deny | deny |
| Apply a linked AI draft | allow | allow | deny | deny |

Every operation first composes the existing `WorkspaceAccessPolicy` and then verifies active conversation membership. A conversation ID, message ID, attachment ID, workspace owner role, or signed grant is never sufficient by itself.

## Errors

Messenger APIs return a stable envelope:

```json
{
  "code": "conversation_not_found",
  "error": "Conversation was not found",
  "retryable": false,
  "requestId": "request-correlation-id",
  "retryAfterMs": null
}
```

Unknown, cross-workspace, removed-member, and unauthorized conversation/message/attachment identifiers use the same non-enumerating `404 conversation_not_found` or `404 resource_not_found` response. A targeted `access.revoked` event may tell a client that its previously loaded scope is gone, but a later resource route still does not disclose whether the identifier exists. Common categories are:

| Status | Codes |
| --- | --- |
| `400` | `invalid_request`, `invalid_cursor`, `invalid_message` |
| `401` | `authentication_required` |
| `403` | `workspace_write_denied` for an active reader lacking writer/owner capability |
| `404` | `conversation_not_found`, `resource_not_found` |
| `409` | `idempotency_conflict`, `conversation_inactive`, `attachment_claim_conflict` |
| `410` | `upload_expired` |
| `413` | `message_too_large`, `file_too_large` |
| `422` | `attachment_not_ready`, `unsupported_type` |
| `429` | `rate_limited` |
| `503` | `messenger_unavailable`, `storage_unavailable`, `scanner_unavailable`, `provider_unavailable` |

## Edge cases and decisions

- Existing workspaces receive `General` and current unblocked members through an idempotent migration/backfill before the feature flag is enabled.
- New and re-added General members may read all retained General history. A removed or blocked member has no access while inactive.
- Unblocking a user does not restore `WorkspaceMember` in the current Slate model; a new invite/join is required before General membership returns.
- DM membership is not reactivated merely by rejoining a workspace. A later authorized open/create operation reuses the same canonical pair and retained history.
- A DM owner role does not override the two-member boundary.
- A body may be empty only when at least one verified attachment is atomically claimed.
- The server advances the sender's own receipt when accepting a message, so the sender's message is never counted as unread.
- Retention can remove an old sequence prefix. History responses expose `retainedFromSequence` and `resolvedThroughSequence` so clients advance a contiguous recovery cursor even when a page is empty; unread counts query visible messages rather than subtracting cursors.
- Duplicate HTTP retries, duplicate outbox publications, duplicate websocket events, and multiple browser tabs must converge on one canonical message.
- If Redis or the realtime gateway is unavailable, authorized HTTP sends remain durable; the UI degrades to reconnect/poll recovery.
- A presigned upload may finish after a block, but completion and attachment claim fail and cleanup deletes the untrusted object.
- Bytes already received by a client cannot be revoked. The media proxy denies new/range requests and aborts tracked active streams after access revocation.
- AI failure never rolls back the human message and never broadens context on retry.

## Acceptance criteria

- Exactly one General conversation exists for every new and existing workspace, with every active unblocked `WorkspaceMember` represented once.
- Owner/editor/viewer behavior matches the permission matrix in REST, realtime, background jobs, and UI.
- Cross-workspace IDs, third-party DM IDs, attachment IDs, and forged grants do not reveal resource existence or content.
- Concurrent retry with the same `clientRequestId` stores one message; a different payload under that ID returns `idempotency_conflict`.
- Offline and multi-tab recovery produces stable order, no duplicate visible messages, and monotonic delivered/read cursors.
- Files never appear in websocket frames or message bodies as base64 and are never publicly addressable.
- Removal, block, and role downgrade revoke relevant capabilities and prevent later API, media, realtime, and AI work.
- `@slateai` runs only for an explicit valid mention in General and cannot read DMs, unrelated files, or workspace documents by default.
- AI-originated workspace changes remain private user-owned drafts until an authorized Apply action succeeds.
- Encryption, audit redaction, retention/deletion, malware scanning, rate limits, load tests, and security tests satisfy the release gates in `07-security-and-operations.md`.

## Required test matrix

The complete suite covers provisioning/backfill, invite acceptance, removal/block, role changes, General history, canonical DMs, IDOR, CSRF/origin checks, message normalization, idempotency, pagination, receipts, reactions, outbox recovery, grant forgery, reconnect, upload spoofing, malware rejection, media authorization, retention, AI context isolation, rate limiting, and expected-peak load at twice the forecast concurrency.
