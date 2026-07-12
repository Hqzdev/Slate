# Phase 7: Messenger security and production operations

## Implementation status

The repository-side controls were implemented on July 11, 2026: independent kill switches, trusted-proxy handling, metadata-only audit, key rotation, private storage, malware/parser isolation, leased workers, retention and tombstone replay, readiness and Prometheus metrics, alert rules, a dashboard definition, CI gates, and parameterized staging security/load harnesses. Production eligibility is not inferred from code presence. Each environment must record its load result, restore exercise, provider review, dependency review, focused security review, alert delivery test, and operational approvals.

## Goal and release posture

This phase turns the completed feature set into a production-eligible system. Security controls are not deferred until phase 7; every earlier phase implements its local controls. Phase 7 verifies the full trust model, key lifecycle, retention/deletion, audit redaction, dependency failure behavior, observability, capacity, recovery, and incident response.

The first release provides:

- TLS in transit.
- Provider-managed database/object encryption at rest.
- Application-level server-side envelope encryption for message text and sensitive filenames.
- Strict workspace plus conversation authorization.
- Private storage and authorized media streaming.
- Signed short-lived realtime grants and durable revocation.
- Malware/parser isolation.
- Metadata-only security audit.
- Retention/deletion and backup-expiry workflows.

It is not end-to-end encrypted. Slate servers can decrypt authorized message content and explicitly consented AI context. Product copy, security documentation, and UI must state this plainly.

Before release, update the canonical `docs/security-model.md` to include Messenger, object storage/media parsing, Messenger realtime, AI provider egress, key management, and DM privacy. This document must not remain an isolated threat-model island.

## User scenarios

1. A normal member uses Messenger while every request, event, and media stream is scoped to the current workspace and conversation.
2. A malicious authenticated member guesses another workspace's or third-party DM resource IDs and receives no content or existence signal.
3. An owner blocks a member during an active socket, upload, media stream, or AI task; current authorization stops all new work and revocation closes active channels.
4. A hostile file reaches private storage but never becomes readable because scanning/parsing fails closed in an isolated worker.
5. A key rotates while retained messages still use an older version; new writes use the active key and old ciphertext remains decryptable only through controlled key state.
6. Redis, realtime, storage, scanner, or provider fails; durable messages and access controls follow the documented degraded mode without plaintext or permission fallback.
7. Retention expires messages and attachments; access is disabled before asynchronous deletion, and a later backup restore reapplies deletion tombstones.
8. An incident operator disables uploads, AI, realtime, or new sends independently, rotates affected secrets, and verifies recovery through audited runbooks.

## Assets and threat actors

Protected assets:

- Message bodies, DM membership, reactions, receipts, unread state, and conversation metadata.
- Attachment originals, previews, filenames, media metadata, and extracted AI text.
- Sessions, realtime grants, storage signing credentials, KMS keys, provider credentials, and service secrets.
- Audit records, deletion tombstones, backups, and operational metadata.
- Workspace documents/drafts reachable only through explicit AI handoff.

Threat actors/failure sources:

- Unauthenticated internet clients.
- Authenticated users attempting cross-workspace or third-party DM access.
- Removed/blocked members with stale browser state, sockets, or upload operations.
- Malicious files, parser exploits, decompression bombs, and active content.
- Prompt injection and unintended provider data egress.
- Compromised/logging infrastructure, leaked grants/URLs, or over-privileged service identity.
- Redis, database, storage, queue, scanner, provider, and gateway outages.
- Operator error, unsafe migration, incomplete deletion, or backup restore of deleted data.

## Trust boundaries

| Boundary | Untrusted input | Required control |
| --- | --- | --- |
| Browser -> Next.js API | IDs, text, cursors, filenames, sizes, reactions | Session, same-origin guard, schema validation, rate limit, policy |
| Browser -> Messenger websocket | Origin, grant, control frames | TLS, origin allowlist, signed grant, access version, size/rate limit |
| Browser -> object storage | File bytes and declared headers | Exact signed key/policy, size/encryption limits, no read permission |
| Storage -> media worker | Arbitrary hostile bytes | Isolated parser/scanner, resource limits, no network, fail closed |
| Web/outbox -> Redis -> gateway | Minimal event JSON | Versioned schema, workspace binding, membership filtering, deduplication |
| Messenger AI -> provider | Explicit bounded content | Consent, context builder, output/input limits, no tools, egress policy |
| AI handoff -> existing AI Assistant | User-reviewed prompt | User ownership, writer policy, draft preview, version-safe Apply |
| Services -> Postgres/KMS/storage | Service credentials | Least privilege, rotation, encrypted transport, audited access |

Presence, a conversation ID, a workspace owner role, a signed upload operation, or a websocket event is never proof of content authorization by itself.

## Security invariants

1. Every content operation verifies current session, unblocked `WorkspaceMember`, workspace identity, active conversation membership, and resource lineage.
2. A workspace owner cannot read a DM unless they are one of its two members.
3. No browser-accessible permanent object URL exists.
4. File bytes never enter websocket/message JSON or Postgres message fields.
5. Message plaintext, sensitive filename plaintext, AI prompt/response, extracts, grants, tokens, signed operations, and credentials never enter persistent queues/objects/backups/temp files/crash dumps, logs, audit, or outbox unless a field is explicitly designated as encrypted content. Authorized plaintext may exist transiently in bounded process memory and provider transit.
6. Removal/block denies new API/media/AI work in the membership transaction and closes realtime/active streams through durable revocation.
7. Durable message acceptance does not depend on Redis, gateway, or provider availability.
8. No unscanned/unverified attachment becomes visible.
9. Messenger AI cannot access DMs or workspace documents in its answer path.
10. Workspace mutations require the existing user-owned draft/apply path and current writer permission.
11. Encryption failure never falls back to plaintext.
12. Retention disables access before asynchronous object deletion and remains effective after backup restore.

## Data model

### `MessengerKeyEnvelope`

Fields:

- `workspaceId` and monotonically increasing `version` as a composite unique key.
- `wrappedDataKey Bytes`.
- `kmsKeyId` and algorithm/version metadata.
- `state`: `active`, `decrypt_only`, or `retired`.
- `createdAt`, `activatedAt`, `retiredAt`.

Raw data keys exist only in the KMS response/process memory and an optional short-lived bounded key cache. They never enter Postgres, environment files, logs, crash reports, or client responses.

### Encrypted payload fields

`MessengerMessage` stores ciphertext, nonce, key version, and `server_aead_v1` encoding. Sensitive attachment display names, AI extracts, and structured draft suggestions use the same envelope pattern. Associated data binds at least workspace ID, conversation ID, record ID, field name, encoding version, and key version so ciphertext cannot be transplanted between records.

Use a vetted KMS/envelope-encryption library or provider AEAD API with reviewed primitives. Do not design a custom cryptographic protocol. Nonces must be generated and uniqueness enforced according to the chosen AEAD.

### `MessengerDeletionTombstone`

Fields identify the workspace/resource type/resource ID, deletion reason, requested/effective timestamps, object-cleanup status, backup-expiry deadline, and completion timestamps. It contains no message content or filename. Restores replay unapplied tombstones before the restored environment serves traffic.

### Audit events

Reuse `AuditEvent` with typed event builders and allowlisted metadata. Extend the schema with typed correlation columns only if JSON metadata cannot be constrained safely; do not create a duplicate Messenger audit table.

## Encryption and key lifecycle

### In transit

- TLS 1.2 minimum, TLS 1.3 preferred, for web/API/websocket/storage/KMS/provider/service traffic.
- HSTS and secure cookies in production.
- Reject insecure production origins and invalid websocket Origin.
- Internal service TLS/mTLS or equivalent authenticated network boundary according to deployment platform.

### Database content

- Database volumes/backups use provider-managed encryption.
- Message body and sensitive filenames additionally use per-workspace envelope encryption.
- Authorized repository code decrypts only after access policy succeeds.
- Conversation list previews are decrypted per authorized row; no plaintext preview column is maintained.

### Attachments

- Private object storage requires provider-managed encryption, preferably SSE-KMS with workspace encryption context/key version.
- Upload signing includes required encryption headers and exact object key.
- Generated variants inherit equal or stronger encryption policy.
- Future E2EE would encrypt bytes on the client before upload; server-side storage encryption alone is not E2EE.

### Rotation

1. Create and activate a new wrapped workspace data-key version.
2. New writes use the active version immediately.
3. Old versions remain `decrypt_only` for retained data.
4. A bounded background job may re-encrypt old payloads idempotently.
5. Retire a version only after no retained record references it and backups have expired.
6. Rotate realtime, storage-signing, session, internal-service, and provider secrets independently with `kid`/overlap where applicable.

Production refuses startup if required key/provider configuration is missing or uses a local-development fallback.

## E2EE migration boundary

The schema is migration-aware, not E2EE:

- `payloadEncoding` can later distinguish server-decryptable and client-encrypted payloads.
- Conversation membership, sequence, receipts, reactions, outbox, and opaque object storage do not require plaintext bodies.
- Current server metadata still reveals workspace/conversation membership, timestamps, sizes, and traffic patterns.

A future E2EE phase requires client key generation/storage, device verification, multi-device sync, pair/group key distribution, membership rekeying, recovery, client-side attachment encryption, metadata analysis, search/notification decisions, and an explicit AI decryption/consent model. Slate must not market E2EE until those clients and device flows are implemented and independently reviewed.

## Permissions and enforcement matrix

| Surface | Required checks |
| --- | --- |
| Conversation/unread list | Session, unblocked workspace reader, active conversation membership |
| History/message lookup | Above plus message -> conversation -> workspace lineage |
| Send/reaction | Current workspace writer, active membership, in-transaction recheck, limits/idempotency |
| Receipt update | Current reader, own receipt only, valid visible sequence, max-only |
| DM create/reactivate | Current writer, both active/unblocked same-workspace members, canonical pair |
| Upload reserve/complete | Current writer, active conversation membership, ownership/quota/state |
| Attachment status | Creator while unclaimed; active conversation member after claim |
| Media stream/range | Current reader, active membership, attached visible message, safe variant |
| Realtime authorize | Same-origin session, unblocked reader, access version, no-store |
| Gateway event send | Grant workspace, live connection access set, event workspace/conversation |
| AI create/retry | Current General writer, valid source mention, AI enabled, consent/limits |
| AI dispatch/commit | Repeat current writer/General/toggle/source/attachment checks |
| Draft handoff/Apply | Requester ownership, current writer, existing AI policy, version conflict check |
| Retention/cleanup | Internal service identity, tombstone/state, idempotent object scope |

Tests exercise every row with own workspace, other workspace, own DM, third-party DM, removed, blocked, viewer, stale grant, and malformed lineage.

## Browser, session, and token controls

- Reuse existing httpOnly, Secure, SameSite session cookies; no auth token in `localStorage`.
- Every mutation uses the existing same-origin guard and rejects cross-site `Origin`/`Sec-Fetch-Site`.
- Websocket handshake checks an explicit Origin allowlist.
- Messenger authorize/upload responses use `Cache-Control: no-store`.
- Grants and signed upload operations are redacted from proxy/application/storage logs.
- CSP disallows untrusted script/object/frame execution; message text is plain text.
- Unsafe files use attachment disposition and `X-Content-Type-Options: nosniff`.
- Server-generated filenames/headers prevent CRLF and path injection.

The current rate limiter trusts a forwarded IP header too broadly for this threat surface. Production must define trusted proxies and derive client IP only from verified proxy hops.

The current `guardMutationRequest` returns a simpler error shape. Messenger routes must extend it or wrap its denial so the common `code/error/retryable/requestId/Retry-After` contract is produced consistently, without silently changing unrelated APIs.

## Rate limits and abuse controls

Apply multiple buckets, not only the current IP bucket. Initial defaults are configuration and must be tuned from load evidence:

| Operation | Initial authenticated limit | Additional scope |
| --- | ---: | --- |
| Send message | 30/min per user | 120/min workspace, burst/conversation guard |
| Receipt update | 120/min per user | Coalesce/max-only |
| Reaction mutation | 60/min per user | Message/conversation validation |
| DM create/reactivate | 10/hour per user | 50/hour workspace |
| Upload reserve/complete | 20/min per user | Byte/day quota and workspace storage quota |
| Media open/range | 120/min per user | Concurrent-stream and egress-byte cap |
| Realtime authorize/connect | 30/min per user | Per-IP/socket cap and reconnect jitter |
| AI invocation | 5/min per user | Workspace concurrency/daily cost/extraction budget |

Return `429 rate_limited` with `Retry-After` and `retryAfterMs`. Do not reveal another user's rate state.

Redis outage policy:

- Text send, receipts, and reactions may use a conservative per-instance emergency bucket for a short bounded window while alerting.
- DM creation, upload signing, media abuse control, and AI fail closed after a deliberately small emergency allowance.
- Never silently disable limits for unlimited traffic.

## File and parser security

- Exact MIME/signature allowlist with outer and inner container validation.
- Malware scan before `ready`.
- No archive/macro/encrypted-document support in first release.
- Isolated media worker with no network, ephemeral storage, least-privilege object access, and CPU/memory/time/pixel/page/decompression limits.
- Generated preview is decoded/re-encoded and metadata-stripped.
- Parser/scanner dependencies are pinned, monitored, and patched under an explicit SLA.
- Suspicious objects can be quarantined without becoming readable.

Scanner unavailable means attachments stay unavailable; it never becomes `ready` by timeout or operator override without an audited, reviewed process.

## AI security

- Dedicated answer-only Messenger context, no workspace tools.
- Exact source/sequence context snapshot and explicit attachment consent.
- Untrusted-content system boundary for messages/extracts.
- No AI in DMs.
- Before-dispatch and before-commit authorization/toggle checks.
- Provider credentials server-only and never logged.
- Provider retention/data-use/regional terms reviewed before enablement.
- Global and workspace kill switches.
- Draft handoff is private to requester and still requires preview/Apply.

Prompt injection cannot grant tools because the Messenger answer path has none.

An explicit draft handoff creates a separate private AI Assistant artifact. The confirmation discloses that the copied reviewed suggestion follows the AI Assistant's retention rather than Messenger retention; `MessengerAiHandoff` stores only metadata linking the systems. Workspace deletion removes both, while ordinary Messenger retention may remove the source after the user deliberately retained the suggestion in AI Assistant.

## Audit taxonomy

Typed metadata-only events:

- `messenger.general.provisioned`.
- `messenger.dm.created` and `messenger.dm.reactivated`.
- `messenger.membership.revoked` and reactivated.
- `messenger.realtime.grant_denied` by safe reason category.
- `messenger.attachment.completed`, rejected, quarantined, cleanup_failed.
- `messenger.media.access_denied` after sampling/threshold.
- `messenger.ai.invoked`, disabled, cancelled, failed.
- `messenger.ai.setting_changed`.
- `messenger.key.rotated`.
- `messenger.retention.started/completed/failed`.
- `messenger.incident.kill_switch_changed`.

Allowed metadata is limited to internal IDs, actor/target IDs, workspace/conversation/message/attachment/invocation IDs, byte count, verified MIME category, key version, status/error code, and request correlation. Do not include body, original filename, URL, grant, token, session ID, prompt, response, extract, provider credential, or arbitrary client string.

`clientRequestId` is validated as UUID before any audit use. Audit builders reject unknown metadata keys at compile/runtime boundaries.

## Retention and deletion

`WorkspaceSettings.retentionDays` already exists with a default of 90 days. Messenger applies it to messages, attached objects, AI invocation metadata, and encrypted draft suggestions unless a documented legal/product policy sets a stricter class. AI extracts use a shorter default of 24 hours after completion. Published outbox rows use a short operational retention such as seven days. Security audit has its own approved retention.

### Deletion workflow

1. Select expired resources in bounded, retryable batches.
2. Create/update `MessengerDeletionTombstone`.
3. Mark attachment/message access deleting so no new URL/stream can start.
4. Delete original and every generated/extracted object with idempotent retries.
5. Delete or cryptographically erase encrypted payload metadata after object confirmation.
6. Advance `retainedFromSequence` to the first surviving sequence, or `lastMessageSequence + 1` when none survive, and update summary/receipt bounds without reusing sequence.
7. Record one aggregate metadata-only audit result.
8. Keep the tombstone until backups/replicas/versioned objects have passed expiry.

If object deletion fails, metadata remains non-readable in `deleting` and cleanup retries. Never delete the only cleanup pointer first.

Workspace deletion runs the same saga for all Messenger data. User removal alone does not delete other participants' retained history; it revokes the removed user's access. A privacy/account deletion policy may replace author display identity while preserving legally required team records, but must be defined outside ad hoc route behavior.

### Backups and restore

- Database backups, object versioning, replicas, and exports inherit documented expiry.
- Initial production targets: RPO at most 15 minutes and RTO at most 4 hours, or stricter deployment-specific targets.
- Restore testing occurs regularly in an isolated environment.
- Before restored traffic, replay deletion tombstones and current membership/block state.
- A restore must not resurrect public URLs, expired grants, deleted objects, or revoked access.

## API and realtime contracts

Owner-facing settings reuse the existing workspace settings API to update `messengerAiEnabled` and approved retention fields. Changes require owner policy, same-origin protection, rate limit, and audit.

Internal health endpoints:

- Web Messenger readiness: Postgres, Redis/outbox, key provider, storage signing.
- Realtime health: Redis subscribers/publisher, grant key set, connection/backpressure state.
- Media health: queue, scanner definitions age, parser worker, storage access, cleanup backlog.
- AI health: queue, provider configuration/circuit state, extraction dependency.

Health responses expose status/categories, not endpoints, credentials, bucket names, key IDs, prompts, or content.

Security-relevant realtime events remain `access.revoked` and `capabilities.changed`. Operational kill switches are server-side configuration/state, not unauthenticated public APIs.

## Observability and SLOs

Metrics:

- Send latency/result, idempotent replay/conflict, database failure.
- Outbox oldest age, publish attempts/failures, event-to-client lag.
- Active sockets, authorization rejection category, reconnect/close/backpressure.
- History recovery latency and unread/receipt update latency.
- Upload bytes/state, scan duration/outcome, parser timeout/crash, cleanup backlog.
- Media authorization denials, active streams, range/egress bytes.
- AI queue/dispatch/outcome/token/extraction cost without content.
- Key decrypt/rotate failures and retention/tombstone backlog.

Avoid unbounded user/message IDs as metric labels. Use trace/request IDs in restricted logs.

Initial service objectives:

- Accepted text message API p95 below 500 ms, excluding AI/upload processing, at twice forecast peak.
- Outbox publish p95 below 2 seconds when Redis is healthy.
- Reconnect plus REST recovery p95 below 5 seconds for a recent disconnect.
- Zero lost committed messages for process, Redis, gateway, and reconnect failures; disaster recovery loss remains bounded by the declared RPO. Unauthorized content/media responses remain zero.
- No unbounded queue, socket buffer, parser resource, or cleanup backlog.

Load tests run at twice forecast concurrent sockets and message rate for at least 30 minutes, include reconnect storms and hot General conversations, and verify database/Redis/storage headroom. Forecast numbers must be recorded before production; relative targets are not permission to skip capacity planning.

## Alerts and runbooks

Alert on:

- Sustained send/storage/key failure.
- Outbox age/backlog and Redis disconnect.
- Grant rejection or access denial anomaly.
- Reconnect/backpressure spike.
- Scanner definitions stale, scan/parser backlog, quarantine growth.
- Cleanup/tombstone failure or storage quota exhaustion.
- AI provider/cost/failure anomaly.
- Backup failure or missed restore exercise.

Runbooks cover:

- Revoke all Messenger grants/close sockets.
- Disable new sends, uploads, media, or AI independently.
- Rotate leaked grant/storage/KMS/provider/internal secrets.
- Quarantine suspicious object/parser version.
- Drain/replay outbox safely.
- Repair General membership reconciliation.
- Resume retention cleanup.
- Restore database/storage and replay tombstones.
- Investigate metadata-only audit without accessing content by default.
- Notify affected workspace owners under incident policy.

Every kill-switch change is authorized, audited, reversible, and tested.

## Dependency failure policy

| Failure | User-visible behavior | Safety behavior |
| --- | --- | --- |
| Postgres | Messenger unavailable | Fail all content/access operations closed |
| Redis/outbox publish | REST durable, realtime degraded | Keep outbox pending; bounded fallback limits |
| Realtime gateway | Poll/reconnect | No effect on durable authorization |
| KMS/key provider | Content unavailable | Never store/return plaintext fallback |
| Object storage | Upload/media unavailable | Text stays available; no false ready |
| Scanner/media worker | Upload processing delayed | Fail closed; no attachment visibility |
| Cleanup worker | No immediate UI change | Access already disabled; alert/retry |
| AI queue/provider | Human message succeeds; AI status fails/degrades | No broadened context or silent retry |
| Audit sink/DB write | Sensitive mutation fails if required audit is transactional | Never log content as fallback |

## Errors

Security/operations keep the common envelope `{ code, error, retryable, requestId, retryAfterMs? }`.

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | Strict schema/origin/input validation failed |
| `401` | `authentication_required` | No valid session/service identity |
| `403` | `workspace_write_denied` | Caller is an active reader but lacks required writer/owner capability |
| `404` | `resource_not_found` | Missing, cross-workspace, removed-member, blocked-member, or otherwise inaccessible private resource |
| `409` | `security_state_conflict` | Key/deletion/state transition conflict |
| `429` | `rate_limited` | IP/user/workspace/cost limit |
| `503` | `messenger_disabled` | Operational kill switch |
| `503` | `key_service_unavailable` | Cannot safely encrypt/decrypt |
| `503` | `storage_unavailable` | Private storage dependency unavailable |
| `503` | `scanner_unavailable` | Attachment cannot become safe |
| `503` | `realtime_unavailable` | Realtime degraded; REST may remain available |

Externally identical errors may cover missing and unauthorized resources. Internal logs retain only safe reason categories.

Resource routes return `404` whenever the caller lacks current workspace/conversation membership, including after removal/block. `403` is reserved for a caller who still has active read access to the scope but lacks the stronger role required for the requested action. Targeted `access.revoked` realtime state may explain why a previously loaded view closed without changing later resource enumeration behavior.

## Edge cases

- KMS rotates while old messages are read: record key version selects decrypt-only key; new writes use active key.
- Re-encryption crashes midway: row-level idempotency and version checks resume safely.
- Block occurs after a media stream begins: active stream abort is attempted; new/range requests fail; already delivered bytes cannot be recalled.
- Presigned upload completes after revocation: completion/claim fails and cleanup deletes object.
- Outbox publishes access events late/duplicate: gateway applies max access version and minimal events contain no content.
- Redis is down on multiple instances: conservative local limits are not treated as global; high-cost operations fail closed.
- Spoofed `X-Forwarded-For` from an untrusted hop does not select rate identity.
- Scanner/parser succeeds but metadata commit fails: object remains inaccessible and retry/cleanup owns it.
- Retention races with download/AI: mark deleting first, deny new work, cancel queued AI, then remove bytes/payload.
- Backup restore predates block/deletion: current block state and tombstones apply before traffic.
- Workspace owner attempts DM export through admin tooling: content remains denied unless a separately approved legal workflow exists.
- Audit/log client submits secret text in UUID/filename fields: strict validation/encrypted filename and typed metadata prevent capture.
- Provider or model returns malicious HTML/URL/tool instruction: plain-text answer path and structured trusted handoff prevent execution.
- A future E2EE encoding appears before clients/key verification are ready: server rejects unsupported encoding and product does not claim E2EE.

## Security and load test plan

Required automated/dynamic tests:

- Full IDOR matrix for list/history/send/receipt/reaction/DM/upload/status/media/authorize/AI/draft handoff.
- Remove/block/role-change races at precheck, transaction, outbox, gateway, media, AI dispatch, and response commit.
- CSRF, websocket Origin, forged/expired/wrong-audience/stale-key/stale-version grant, cache/log token leakage.
- Message XSS/bidi/control/oversize and header/filename injection.
- MIME/extension spoof, malware, macro/encrypted container, parser/decompression/pixel bomb, timeout/crash, scanner outage.
- Rate limits for IP/user/workspace/conversation/bytes/cost, trusted-proxy spoofing, and Redis outage.
- Encryption round trip, ciphertext transplant failure, nonce handling, missing key, rotation, re-encryption, and scans proving no plaintext on persistent surfaces such as DB/backups/objects/queues/logs/temp/crash artifacts.
- Retention/object failure/tombstone/backup restore and revoked-access revalidation.
- AI context snapshot, no-DM/no-document boundary, consent, prompt injection, provider timeout/unknown outcome, draft ownership.
- Load at twice forecast, hot conversation, reconnect storm, outbox backlog recovery, slow consumers, media range, and cleanup pressure.

Security tests use synthetic content and never production messages.

## Production release gates

Do not enable Messenger in production until:

- Threat model and `docs/security-model.md` are approved.
- Schema migration/backfill/reconciliation and rollback/feature-disable plan are rehearsed.
- Every authorization/IDOR and revocation test passes.
- Encryption/KMS rotation, secret storage, TLS, private bucket policy, and persistent-surface no-plaintext scans pass.
- Scanner/media isolation and malicious-file corpus tests pass.
- Outbox/reconnect/idempotency/backpressure/failure-injection tests pass.
- Retention/deletion/tombstone/backup restore exercise passes.
- Provider privacy/data-use review and AI boundary tests pass.
- Rate limits, trusted-proxy configuration, alerts, dashboards, and runbooks are active.
- Dependency vulnerability review and parser patch levels are current.
- Load test meets SLOs at twice recorded forecast with headroom.
- Independent focused review covers broken access control, DM owner bypass, token leakage, XSS/active files, object exposure, parser compromise, AI egress, cryptography/key lifecycle, and deletion.

## Acceptance criteria

- Every trust boundary and enforcement-matrix row has an automated positive and negative test.
- Message bodies/sensitive filenames are envelope-encrypted; attachments/backups are encrypted; missing key service fails closed.
- Logs, audit, metrics, traces, outbox, websocket, and storage access records pass content/secret redaction tests.
- Remove/block prevents subsequent REST, websocket content fetch, media range, upload claim, and AI/draft actions; active connections/streams receive revocation handling.
- Owner cannot access third-party DM content through any public/internal product route.
- Malicious or unverifiable files never become `ready` or readable.
- Retention disables access before deletion, retries object cleanup, expires backups, and survives restore through tombstones.
- Redis/gateway/provider/scanner/storage failures degrade according to the failure matrix without losing committed messages or broadening access.
- SLO/load/reconnect/backpressure tests pass at twice forecast peak and leave bounded backlogs.
- Incident kill switches, secret rotation, outbox recovery, cleanup recovery, and restore runbooks are executed successfully in staging.
- Product and security copy explicitly says server-encrypted, not E2EE, and lists the future client-key/device work required before that claim changes.
