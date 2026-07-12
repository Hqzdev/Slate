# Phase 3: Messenger realtime delivery and reliability

## Goal and phase boundary

## Implementation status

Implemented on July 11, 2026. The production rollout remains disabled until migration `0016_messenger_realtime_outbox_leases` is deployed, the service has its production key ring and origin allowlist, and `MESSENGER_REALTIME_ENABLED=true` is set after health verification.

This phase adds low-latency Messenger notifications without changing the durable REST contract. It introduces:

- A separate `services/messenger-realtime` JSON websocket gateway.
- One authenticated Messenger socket per active workspace/browser tab.
- A dedicated signed-grant type and key.
- Transactional outbox publication through Redis.
- Reconnect, gap recovery, duplicate suppression, backpressure, and access revocation.

`services/sync` remains responsible only for Yjs documents. Messenger does not import its room persistence, binary protocol, awareness state, or `DocumentRealtime` model. Typing indicators and presence are excluded from the first release.

## User scenarios

1. A signed-in member opens a workspace. A lightweight Messenger connection keeps the sidebar unread badge current even when the Messenger page is not selected.
2. Another member sends a message. The client receives a minimal `message.created` notification, fetches the authorized delta, and updates history/unread state.
3. The HTTP response and websocket notification arrive in either order. The client merges one canonical message.
4. The browser loses connectivity, sleeps, or changes networks. It reconnects with a fresh grant and fetches every message after its last sequence.
5. Redis or the gateway is unavailable. Message writes remain durable, the UI shows degraded state, and REST polling/reconnect later catches up.
6. A member is removed, blocked, or loses write capability. Durable revocation/capability events close or refresh active clients; every later REST fetch rechecks access.
7. A socket is slow or a tab is suspended. The gateway bounds its queue, disconnects the client when necessary, and relies on REST recovery.

## Service boundary

Create `services/messenger-realtime` as a separate Node service with one responsibility: authenticate Messenger websocket connections and fan out already-committed, minimal events to currently authorized users.

It may reuse small generic utilities for HMAC verification, environment loading, health responses, and Redis connection management, but it must not import Yjs-specific server modules. Its Prisma client needs only the models required to verify current workspace/conversation access when establishing or repairing a connection.

Recommended local runtime:

| Service | Default port | Protocol |
| --- | --- | --- |
| `services/sync` | `1234` | Yjs binary websocket |
| `services/execution` health | `1235` | HTTP |
| `services/messenger-realtime` | `1236` | Messenger JSON websocket and health |

The production reverse proxy exposes TLS endpoints and does not reveal internal ports.

## Data model

### `MessengerOutboxEvent`

Each domain transaction appends an event with:

- `id` and globally unique `eventId`.
- `workspaceId` and optional `conversationId` and `targetUserId`.
- `type` and minimal JSON `payload`.
- `status`, `attemptCount`, `availableAt`, `lastErrorCode`.
- `createdAt` and `publishedAt`.

Payloads contain only identifiers, safe status codes, and decimal-string sequence cursors. They never contain message bodies, filenames, attachment bytes/URLs, grants, session data, AI prompts, or provider output.

### Access version

`WorkspaceMember.messengerAccessVersion` increments on role change within one membership row. The grant binds both `WorkspaceMember.id` as a random membership epoch and the access version. A removed/blocked member has no active row; the revocation event carries the captured membership ID. A later rejoin creates a new membership ID, so a stale grant cannot become valid even if the numeric version restarts.

### Outbox lifecycle

1. A message, reaction, receipt, conversation change, or access change and its outbox row commit together.
2. `MessengerOutboxPublisher` leases pending rows with `FOR UPDATE SKIP LOCKED`, publishes to the workspace Redis channel, and marks them published.
3. A failed publish increments attempts and schedules bounded exponential backoff with jitter.
4. Rows older than the operational retention window are removed only after publication and metrics reconciliation.
5. Duplicate publication is expected. Consumers deduplicate by `eventId`.

Redis Pub/Sub is a fan-out transport, not the source of truth. The outbox closes the database-commit/publish gap; REST closes the Pub/Sub/gateway/client delivery gap.

## Realtime authorization API

`POST /api/workspaces/:workspaceId/messenger/realtime/authorize`:

- Uses the existing httpOnly-cookie session.
- Runs same-origin/CSRF protection and per-IP plus authenticated-user limits.
- Calls `WorkspaceAccessPolicy.requireWorkspaceReader`.
- Rejects blocked/missing members.
- Returns `Cache-Control: no-store` and `Pragma: no-cache`.

Response:

```json
{
  "grant": "signed-compact-token",
  "expiresAt": "2026-07-11T12:00:00.000Z",
  "protocolVersion": 1,
  "socketUrl": "wss://slate.example/messenger"
}
```

The client sends the grant only during websocket connection. If it is carried as a query parameter because the browser cannot set an Authorization header, reverse-proxy and application access logs must remove the full query string for this path. The grant is never persisted in browser storage or telemetry.

## Grant contract

Use a dedicated `MessengerRealtimeGrantService` with `MESSENGER_REALTIME_GRANT_ACTIVE_KID` and the base64 key ring in `MESSENGER_REALTIME_GRANT_KEYS`. Do not reuse the document-specific, PII-rich grant payload.

Required claims:

| Claim | Meaning |
| --- | --- |
| `v` | Protocol/grant schema version |
| `aud` | Exact value `slate-messenger` |
| `kid` | Signing-key version |
| `sub` | User ID |
| `workspaceId` | One workspace scope |
| `membershipId` | Exact current `WorkspaceMember.id` epoch |
| `role` | Current workspace role |
| `accessVersion` | Current Messenger capability epoch |
| `iat`, `exp` | Issued/expiry epoch |
| `jti` | Correlation identifier for audit/metrics |

The payload excludes email, name, initials, avatar color, message permissions by conversation, and secrets. The HMAC signature is compared with a timing-safe operation. Unknown `kid`, wrong audience/version, excessive clock skew, invalid signature, expired token, wrong workspace, or stale access version is rejected.

The grant and socket lifetime are two minutes in the first release. The client requests a replacement and reconnects with randomized jitter before expiry. The gateway closes a connection when its authenticated lifetime expires; grant expiry is not handshake-only.

## Websocket handshake

1. Verify TLS termination and an allowlisted `Origin`.
2. Parse and size-limit the request before decoding the grant.
3. Verify signature, audience, workspace binding, membership ID, access version, issue time, and expiry.
4. Load the user's currently accessible conversation IDs and capabilities from the database or an access projection backed by the same durable events. A provisional DM is included only when that user's `openedAt` is non-null.
5. Register one connection under `workspaceId + userId`.
6. Send `connection.ready` with protocol version, server time, expiry, and no conversation content.
7. Start heartbeat and expiry timers.

An invalid or inaccessible handshake receives websocket close `4003` without exposing whether a workspace or DM exists.

## Event envelope

Every server-to-client business event is JSON. `conversationId` is optional for workspace/control events:

```json
{
    "v": 1,
  "eventId": "uuid",
  "type": "message.created",
  "workspaceId": "workspace-id",
  "conversationId": "conversation-id",
  "occurredAt": "2026-07-11T12:00:00.000Z",
  "payload": {
    "messageId": "message-id",
    "sequence": "42"
  }
}
```

The gateway validates the event schema and workspace, then filters ordinary conversation events by its current conversation-membership set. Targeted `access.revoked`/`capabilities.changed` match `targetUserId` and authenticated subject even after membership is gone. A targeted `conversation.added` first reauthorizes the conversation from current database/access projection, adds it to the set, and only then notifies the user.

## Event types

| Type | Payload | Client action |
| --- | --- | --- |
| `ready` | `expiresAt`, `v` | Start recovery before showing live |
| `conversation.added` | `conversationId` | Fetch authorized conversation list |
| `conversation.changed` | `conversationId` | Refresh summary/unread |
| `message.created` | `messageId`, `sequence` | Fetch `afterSequence` delta |
| `reaction.changed` | `messageId`, `sequence` | Refresh affected message/delta |
| `receipt.changed` | `userId`, delivered/read sequences | Merge max-only cursor |
| `attachment.changed` | `attachmentId`, safe status | Refresh upload status if owned/visible |
| `ai.invocation.changed` | `invocationId`, safe status | Refresh invocation state |
| `capabilities.changed` | `accessVersion` | Refresh current role/capabilities |
| `access.revoked` | scope and reason code | Clear scope, close or refresh connection |
| `connection.ping` | `nonce` | Reply with `connection.pong` |

General `receipt.changed` is sent only to the same user's connections. DM receipts are sent only to the two participants. Pre-message `attachment.changed` is sent only to the creator. `access.revoked` and user capability changes target the affected user. The audience is derived from server-side outbox fields and membership, never from a client subscription request.

There is no `message.failed` broadcast. HTTP is the authoritative send boundary and returns failures only to the sender.

No event includes attachment bytes, base64, a signed upload/download operation, decrypted filename, message body, provider output, or grant.

## Client-to-server frames

The first release accepts no application frames from the browser. Heartbeats use websocket ping/pong control frames. Messages, reactions, receipts, uploads, DM creation, and AI invocation always use HTTP. Any client application frame or oversized payload closes the socket.

## Ordering and merge algorithm

Conversation message order is `sequence ASC`. Event arrival order is irrelevant.

The initial authorized latest-page load establishes a recovery baseline from its `resolvedThroughSequence`. Older `beforeSequence` pagination is independent and does not prevent live recovery from being current.

On `connection.ready`:

1. Mark the connection `recovering`, not `live`.
2. Refresh conversation summaries and aggregate unread.
3. For every currently loaded conversation, request `afterSequence=<contiguousThroughSequence>`.
4. Merge the page by canonical message ID and sequence.
5. Advance only to the server's `resolvedThroughSequence`; a locally present higher message cannot skip a missing lower sequence.
6. Use `retainedFromSequence` to resolve a retention-deleted prefix.
7. Continue while `hasMoreAfter` until `contiguousThroughSequence == serverLastSequence`.
8. Mark the connection `live`.

On `message.created`, if the notified sequence is above `contiguousThroughSequence`, request the delta from that contiguous cursor even when a still-higher message is already local. If it is equal/lower, ignore it after event-ID deduplication. A client keeps a bounded set of the last 500 event IDs in memory; canonical message IDs remain the final deduplication key.

The HTTP message response can arrive before or after the event. Both paths remove the same pending item by `clientRequestId` and merge the same canonical message.

## Reconnect policy

Reconnect after network failure, expiry, gateway restart, or backpressure with exponential backoff and full jitter:

- Initial range: 250–750 ms.
- Cap: 30 seconds.
- Reset after 60 seconds of stable connection.
- Pause while the browser reports offline.
- Resume immediately on an online/focus signal, still with small jitter.

Authentication/access close codes do not auto-loop. The client refreshes workspace state first; blocked/removed users exit Messenger. Rate-limit responses honor `retryAfterMs`.

Multiple tabs each have their own socket and independently recover. Server connection limits apply per user/workspace/IP; excess tabs receive a clear recoverable close and may fall back to periodic unread polling.

## Revocation and capability changes

Removal/block and role changes append durable events inside their database transaction. The outbox publisher prioritizes access-control events ahead of ordinary notifications for the same workspace.

On workspace removal/block:

- Gateway removes every conversation subscription for that user.
- Gateway sends `access.revoked` when possible and closes matching sockets with `4003`.
- Browser clears message state, decrypted previews, object URLs, drafts tied to that conversation, and grants.
- REST/media/AI services independently deny every later request.

On DM-only revocation, the gateway removes that conversation and keeps the workspace socket for other authorized conversations.

If a gateway misses the Redis event, the two-minute authenticated socket lifetime bounds exposure. Because business events contain no message content, a stale socket cannot obtain text or files; the required REST fetch is denied by current membership.

## Limits and backpressure

Initial server limits:

- One active Messenger socket per workspace/tab and a configurable per-user/IP cap.
- Maximum inbound or outbound frame: 16 KiB.
- Maximum buffered outbound queue: 256 events or 1 MiB, whichever is reached first.
- Heartbeat every 30 seconds; terminate after two missed responses.
- Maximum five malformed/unknown frames before immediate close; severe violations close on first frame.
- No browser-controlled subscription to arbitrary conversation IDs.

When the outbound queue exceeds the limit, close with `4011 backpressure`. The client recovers through REST rather than requesting replay from the gateway.

## Permissions

| Realtime action | Owner | Editor | Viewer | Removed/blocked |
| --- | --- | --- | --- | --- |
| Obtain workspace grant | allow | allow | allow | deny |
| Receive General notifications | allow | allow | allow | deny |
| Receive an existing own-DM notification | allow | allow | allow | deny |
| Receive a third-party DM notification | deny | deny | deny | deny |
| Send business data over websocket | deny | deny | deny | deny |
| Receive capability change | allow | allow | allow | deny/close |

The gateway never trusts a client-supplied conversation list. Current server-side membership is the filter.

## Errors and close codes

### Authorization API

| Status | Code | Behavior |
| --- | --- | --- |
| `401` | `authentication_required` | Enter auth flow |
| `404` | `resource_not_found` | Missing/inaccessible workspace; clear stale Messenger state |
| `429` | `rate_limited` | Retry after server delay |
| `503` | `realtime_unavailable` | Degrade to REST/polling |

### Websocket close codes

| Code | Meaning | Client behavior |
| --- | --- | --- |
| `4001` | Authenticated socket lifetime expired | Obtain fresh grant and reconnect |
| `4003` | Authentication/access denied or revoked | Refresh workspace access; do not loop |
| `4008` | Invalid frame/protocol violation | Report metric; reconnect only after client reset |
| `4009` | Protocol version unsupported | Require client refresh/update |
| `4010` | Gateway shutting down/unavailable | Backoff and recover |
| `4011` | Slow consumer/backpressure | Fetch REST delta, then reconnect |
| `1011` | Unexpected server failure | Backoff and recover |

Close reasons contain stable codes, not internal stack or resource details.

## Failure behavior

| Dependency failure | Required behavior |
| --- | --- |
| Redis unavailable | HTTP commits and outbox rows continue; publisher retries; clients poll/recover |
| Gateway unavailable | REST remains authoritative; UI marks realtime degraded |
| Postgres unavailable | Authorization and durable writes fail closed with `503` |
| Outbox backlog | Alert, continue durable writes within configured safety threshold, recover in order |
| Signing key unavailable | Grant issue/verify fails closed |
| Revocation publish delayed | REST denies immediately; minimal stale events reveal no content; socket expiry bounds delay |
| Client clock wrong | Server expiry controls; client uses server time hint only for reconnect scheduling |

## Edge cases

- A message commits and the web process crashes before direct publish: the outbox worker still publishes it.
- An event publishes twice after a worker lease timeout: clients ignore duplicate `eventId` and canonical IDs.
- Events arrive in reverse sequence order: REST delta and numeric sequence restore order.
- An ordinary event arrives for a conversation removed from the connection's membership set: gateway drops it; a targeted revocation still routes by authenticated subject.
- A targeted `conversation.added` arrives for a DM absent at handshake: gateway reauthorizes, adds membership, then sends it.
- Access is revoked while an event is queued: queued events are re-filtered immediately before send.
- A block races with a pre-block message commit: authorized members keep the committed message; the blocked user cannot fetch it after revocation.
- A gateway restarts with no replay buffer: clients reconnect and use `afterSequence`.
- The client was offline longer than message retention: history returns the retained range and a valid gap marker rather than looping.
- A role downgrade does not require deleting readable history but must remove composer/reaction capability.
- An old grant signed by a retired `kid` is rejected after the configured key-overlap window.
- A forged Origin, wrong audience, wrong workspace, modified payload, expired grant, stale membership ID, and stale access version all fail identically.

## Acceptance criteria

- `services/sync` and `DocumentRealtime` receive no Messenger protocol or persistence changes.
- One workspace socket keeps unread summaries current and never accepts authoritative message/file writes.
- Every domain transaction that should notify creates an outbox row atomically.
- A forced crash between commit and publish still produces the event after recovery.
- Duplicate, delayed, missing, and reversed events converge through REST to one stable message order.
- Offline, sleep/wake, network change, token expiry, gateway restart, and multi-tab scenarios recover without message loss or duplicate rendering.
- Forged, expired, wrong-audience, wrong-workspace, stale-version, and wrong-Origin handshakes are rejected.
- Remove, block, DM revocation, and role-change tests update or close active clients and deny subsequent REST/media access.
- Redis outage does not lose committed messages; restored Redis drains the outbox and clients catch up.
- Backpressure bounds memory, closes slow consumers, and REST recovery succeeds.
- Event/log inspection proves that frames contain no message body, filenames, attachment bytes/URLs, grants, session data, or AI prompts.
- Health, metrics, alert, and graceful-shutdown behavior are covered before enabling realtime in production.
