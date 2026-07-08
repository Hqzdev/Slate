# Realtime Model

Slate uses collaborative documents as the center of the product.

## Document State

The room document should contain:

- Code editor content.
- Canvas data.
- Room metadata needed to render the workspace.

Presence should not be stored in the document.

## Presence State

Presence should contain:

- User display name.
- User color.
- Online status.
- Editor cursor or selection.
- Canvas pointer or viewport when useful.

Presence is ephemeral and can be lost without corrupting the document.

## Synchronization

Tier A should use Yjs and a standard WebSocket provider. The objective is to prove product behavior quickly.

Tier B can replace the provider with a custom sync service once the behavior, persistence, and edge cases are known.

## Persistence

Room state should be saved as snapshots. Snapshotting only when the last user leaves is not enough because a process crash can lose active work.

Minimum strategy:

- Save periodically during active collaboration.
- Save on explicit durable events.
- Restore from the latest valid snapshot.
- Treat corrupt snapshots as recoverable failures.

Current sync service behavior:

- Stores each document room as a Yjs state update in `DocumentRealtime`.
- Restores persisted Yjs state before accepting room messages.
- Falls back to the canonical document content for code and note rooms if persisted realtime state is corrupt.
- Flushes pending room state on debounce, last socket close, and process shutdown.
- Exposes persistence health, room dirtiness, restore source, and last persist error through `/health`.

## Edge Cases

- Two users edit the same text range.
- A tab disconnects and reconnects.
- A user reloads during active edits.
- The sync process restarts.
- A snapshot write fails.
- A stale client reconnects with old state.
