# 0001: Build the MVP Before the Platform

## Status

Accepted

## Context

The full project vision includes realtime collaboration, an infinite canvas, sandboxed execution, Git integrations, OAuth, AI collaborators, custom sync infrastructure, export workers, observability, and deployment automation.

Building all of that first would create architecture without evidence. The largest risk is not that the final platform lacks services. The largest risk is that no one sees a working collaborative room.

## Decision

Slate will start with a vertical MVP:

- Web workspace.
- Shared room.
- Realtime code.
- Realtime canvas.
- Presence.
- Persistence.
- Minimal sandboxed execution.

Custom infrastructure, Git, AI, and advanced deployment will wait until the core product loop works.

## Consequences

This makes the first milestone smaller, more testable, and more demonstrable.

It also means early implementation choices may be replaced. That is acceptable. Replacing a temporary provider after learning from a working demo is cheaper than designing a complete platform around untested assumptions.
