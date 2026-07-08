# Architecture

Slate should grow from a working vertical slice into a service-oriented system only where the boundary is justified.

## Product Loop

The core loop is:

1. A user opens a room URL.
2. Multiple users edit code and canvas state together.
3. Everyone sees presence and document changes in realtime.
4. A user runs code.
5. Output streams back to the room.
6. The room survives reloads and later visits.

Anything that does not support this loop is secondary.

## Tier A Architecture

Tier A should stay small:

- Web app for Monaco, native canvas, room UI, and realtime client state.
- Realtime provider for Yjs document synchronization.
- Persistence service or module for room snapshots.
- Execution service for sandboxed code runs.
- Local infrastructure for Redis, Postgres, or equivalent storage once required.

The initial sync provider can be off-the-shelf. Replacing it before the UX works is premature.

## Service Boundaries

The durable boundaries are:

- Realtime sync: long-lived connections, low latency, presence.
- Execution: untrusted code, CPU and memory pressure, strict isolation.
- Persistence: durable rooms, snapshots, metadata.
- Web: user experience and client state.

The weak early boundaries are:

- Gateway.
- Integrations.
- AI.
- Export worker.
- Kubernetes and infrastructure automation.

Those should wait until the product loop is proven.

## Strategic Constraint

A large architecture with no working demo has low portfolio value. A small demo that proves realtime collaboration has high portfolio value and creates evidence for every later architectural decision.
