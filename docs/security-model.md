# Security Model

Slate has three main risk surfaces:

- Untrusted code execution.
- Provider tokens and source-control credentials.
- Collaborative document access.

## Execution Boundary

Execution must be isolated from all application processes. The execution service owns process creation, limits, cleanup, and output streaming.

Minimum execution guarantees:

- Allowlisted languages only.
- No network by default.
- CPU limit.
- Memory limit.
- Timeout.
- No application secrets.
- Temporary writable storage only.
- Full cleanup after each run.

## Token Boundary

OAuth and Git credentials must be treated as high-value secrets.

Requirements before integrations ship:

- Encryption at rest.
- No token logging.
- Scoped provider permissions.
- Revocation path.
- Clear separation between user credentials and service credentials.

## Document Boundary

Rooms start as link-shareable spaces. This is acceptable for MVP only if room IDs are unpredictable.

Before broader release:

- Membership model.
- Access checks on every document operation.
- Snapshot ownership.
- Audit trail for sensitive operations.

## Presence Boundary

Presence is ephemeral. It should never be used as proof of permission, ownership, or durable state.

## Messenger Boundary

Messenger is server-encrypted, not end-to-end encrypted. Slate services decrypt message text only after current workspace and conversation authorization succeeds. Workspace owners have no special right to read a DM unless they are one of its two members.

Every Messenger read, mutation, attachment operation, realtime grant, and AI action verifies the active session, unblocked workspace membership, workspace lineage, and active conversation membership. Private-resource denials are non-enumerating. Removing or blocking a member increments its access version, denies later REST work immediately, and sends a revocation event to active realtime connections.

Message text, sensitive filenames, AI extracts, and AI draft suggestions use a per-workspace data key wrapped by an application key provider. Ciphertext is bound to workspace, conversation, record, field, and key version. New writes use the active envelope; previous versions remain decrypt-only until no retained data or backups reference them. Encryption errors never fall back to plaintext.

Attachments use private object storage. Upload operations are exact-size, time-limited, and bound to one attachment ID. Stored objects are scanned and processed in an isolated media worker before they can become visible. The browser never receives a permanent object URL. Production storage requires TLS and server-side encryption.

Messenger realtime carries only minimal event identifiers and recovery cursors. Browser grants are short-lived, workspace-scoped, and not persisted. The outbox is the durable source of delivery; Redis and the gateway may degrade without losing accepted messages or weakening authorization.

Messenger AI is limited to General conversations. It has no workspace-document tools and no DM access. Provider egress is explicitly enabled, bounded, and uses only consented conversation content. A handoff to the general AI Assistant is a private draft artifact and still requires review plus Apply.

## Operations Boundary

Retention first marks a message unavailable, creates a deletion tombstone, and moves attached objects to deletion. The cleanup worker deletes every private variant before the message ciphertext is erased and the tombstone is completed. Tombstones remain until the configured backup-expiry interval and must be replayed before a restored environment serves traffic.

Production must set `TRUSTED_PROXY_CLIENT_IP_HEADER` to the one client-IP header injected by its trusted edge and prevent direct access to the application origin. Without that configuration, application code treats client IP as untrusted rather than accepting arbitrary forwarded headers.

Before Messenger is enabled in production, the release gates in `docs/messenger/07-security-and-operations.md` must pass: migrations and backfill rehearsal, authorization and revocation testing, key rotation, private storage and parser testing, retention/restore exercise, provider review, vulnerability review, alerts and runbooks, and load testing at twice recorded forecast.
