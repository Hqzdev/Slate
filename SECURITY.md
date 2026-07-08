# Security

Slate is planned to run untrusted user code, store OAuth tokens, and synchronize collaborative documents. These are high-risk areas. Security work is part of the product, not a late hardening phase.

## Current Status

The repository is a scaffold. No production service, authentication system, token storage, or sandbox exists yet.

## Core Security Boundaries

- Untrusted code must never execute inside the web, sync, gateway, or persistence process.
- Sandboxed execution must run with CPU, memory, filesystem, network, and time limits.
- Execution environments must not receive application secrets.
- OAuth tokens must be encrypted at rest before any Git or provider integration is implemented.
- Secrets must not be committed, logged, printed in errors, or injected into sandbox containers.
- Realtime presence is ephemeral and must not be treated as authoritative document state.

## Initial Sandbox Requirements

The first execution service must enforce:

- No network by default.
- Memory limit.
- CPU limit.
- Wall-clock timeout.
- Read-only runtime filesystem where possible.
- Writable temporary directory only.
- Clean process termination after timeout.
- Explicit language allowlist.

## Reporting

Until a public disclosure process exists, report vulnerabilities privately to the project owner.
