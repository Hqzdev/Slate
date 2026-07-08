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
