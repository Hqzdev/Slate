# Phase 2: General group page and UI

## Implementation status

Implemented on July 11, 2026. The shipped slice includes canonical workspace/view/conversation URL state with Back/Forward recovery, a site-native Messenger sidebar row and unread badge, focused General components, typed REST parsing, numeric sequence merging, older-page scroll anchoring, REST catch-up polling, caller-only pending reconciliation, exact retry/discard/edit behavior, debounced max-only receipts, accessible reaction identities, owner/editor and viewer states, desktop/mobile layouts, and workspace-switch cancellation. The active code, note, or canvas surface remains mounted, inert, hidden, and isolated from global canvas/document shortcuts while Messenger is active.

Realtime websocket delivery remains phase 3. Phase 2 uses authorized REST history as the source of truth and periodically recovers after its contiguous sequence cursor. Attachments, direct-message controls, and Slate AI treatment remain absent.

## Goal and phase boundary

This phase adds the dedicated Messenger workspace view using the phase 1 REST contracts. It ships General text history, sending, unread state, receipts, and reactions.

The following controls remain absent until their own phases:

- No attachment button or selected-file tray before phase 4.
- No `New message` action or DM rows before phase 5.
- No special `@slateai` treatment, pending AI state, or draft handoff before phase 6.

This boundary prevents non-working UI and lets General ship against a complete text contract before storage, DM privacy, and provider dependencies are introduced.

## User scenarios

1. A member selects `Messenger` and sees General without closing the active document or losing unsaved editor state.
2. A reader loads the latest messages, scrolls upward for older pages, returns to the latest item, and sees accurate unread state.
3. An owner/editor sends plain text and sees `pending -> sent` without a duplicate when the realtime echo or HTTP retry arrives.
4. A send fails before commit. The local item remains with `Retry` and `Discard` and keeps the same `clientRequestId` for retry.
5. A viewer reads and advances receipts but sees a read-only composer explanation.
6. A writer adds/removes an allowed reaction and every client converges after duplicate or out-of-order updates.
7. The browser goes offline or the realtime service is not yet enabled. REST history remains usable and reconnect recovery catches up later.
8. Access is revoked while General is open. Private state, object URLs, pending capabilities, and the active Messenger socket are cleared before navigating to a safe workspace view.

## Workspace integration

### Navigation and URL state

Add `"messenger"` to `WorkspaceView` and to `getWorkspaceViewSnapshot` in `WorkspaceShell.tsx`. The sidebar order in the `Workspace` section is:

1. Dashboard
2. Messenger
3. Activity
4. Comments

AI Assistant remains in `Tools`.

Use a site-native `MessengerIcon` in `Icons.tsx` rather than reusing the document-comment icon. The sidebar row displays the aggregate unread badge, capped visually at `99+` while preserving the full count in an accessible label.

The canonical deep link is:

```text
/workspace?workspaceId=<workspaceId>&view=messenger&conversationId=<conversationId>
```

The selection order is:

1. An authorized `conversationId` from the URL.
2. The last opened conversation ID for this workspace, if still authorized.
3. General.

Only workspace and conversation IDs may be stored as navigation preference. Message bodies, filenames, decrypted previews, and grants are never persisted in `localStorage`. Back, forward, reload, and workspace switching must preserve or safely repair the URL.

Introduce one `navigateWorkspaceView` helper that updates both React state and `window.history`. Subscribe view state to `popstate` rather than using `getWorkspaceViewSnapshot` only as a one-time initializer. Sidebar actions, conversation selection, mobile back, browser back/forward, and workspace switching all use that coordinator.

### Component boundaries

`WorkspaceShell` switches the view and owns only the aggregate badge integration. Messenger state belongs in focused components:

- `WorkspaceMessengerPage` coordinates route selection and responsive layout.
- `ConversationRail` renders General now and DM rows after phase 5.
- `ConversationHeader` renders title, participants, capabilities, and connection state.
- `MessageTimeline` owns pagination, sequence merging, visibility, and scroll anchoring.
- `MessageGroup` and `MessageItem` render safe message content and reactions.
- `MessageComposer` owns draft text, IME behavior, pending sends, retry, and role state.
- `MessengerDetailsPanel` renders General membership and later shared-media entry points.
- `useMessengerUnread` loads the badge and, after phase 3, consumes workspace-level events even when the page is not selected.
- `messengerClient.ts` contains typed DTO parsing and API calls.

Do not add all Messenger fetch, retry, scroll, and composer state directly to the existing large `WorkspaceShell` component.

To preserve unsaved editor/canvas state, keep the current document surface mounted while an auxiliary workspace view such as Messenger is active. Mark the hidden surface inert/`aria-hidden` and remove it from layout, but do not destroy its editor/Yjs provider merely because `workspaceView` changed. Unmount only when the active workspace/document lifecycle actually changes. This is the chosen mechanism; an unconditional unmount plus cleanup flush cannot preserve offline edits.

## Layout

Desktop uses three regions:

1. Conversation rail: General, last-message preview, timestamp, unread badge, and later DM rows.
2. Conversation area: header, message timeline, new-message marker, and composer.
3. Details panel: active members and connection status. Shared attachments appear only after phase 4.

The details panel collapses first. At the existing mobile breakpoint, show either the rail or active conversation, never two competing full-height scroll containers. The back action returns to the rail and updates URL state. The composer remains above the software keyboard and safe-area inset.

General is always first, named `General`, labelled `Workspace group`, and cannot be renamed, deleted, left, or manually reconfigured. Its header shows the workspace name and current active-member count. Membership controls link to existing workspace settings rather than duplicating invite/block management.

## Data model

The UI consumes only public types from `01-data-and-access.md`.

### Conversation view state

| Field | Meaning |
| --- | --- |
| `conversation` | Current authorized `Conversation` |
| `messagesById` | Canonical messages keyed by ID |
| `orderedMessageIds` | IDs sorted by numeric `sequence` |
| `oldestSequence` | Oldest loaded sequence |
| `newestSequence` | Newest loaded sequence |
| `contiguousThroughSequence` | Highest live/reconnect sequence confirmed by the server with no unresolved gap above the current recovery baseline |
| `retainedFromSequence` | First sequence that can still exist after retention |
| `serverLastSequence` | Latest sequence known by the server |
| `hasMoreBefore` | Whether older history exists |
| `pendingByClientRequestId` | In-memory unsent/awaiting HTTP items |
| `receipt` | Current user's delivered/read cursor |
| `connectionState` | `offline`, `connecting`, `recovering`, `live`, or `degraded` |

Decimal sequence strings are parsed through one comparison helper. Never sort them lexicographically.

The initial latest-page response establishes `contiguousThroughSequence = resolvedThroughSequence` even though older pagination is not loaded; historical pages are a separate backward cursor. After that baseline, a locally present higher message cannot advance the live cursor past a missing sequence.

### Local pending item

A pending item contains `clientRequestId`, normalized draft body, local creation time, `sending|failed` state, and a retryable error code. It exists only in memory for the current tab. A full reload may discard an uncommitted draft; cross-reload offline queuing is not part of the first release.

When the server returns a canonical message, remove the pending item by `clientRequestId` and insert by message ID/sequence. A later realtime notification cannot create a duplicate.

## APIs used

| UI action | API |
| --- | --- |
| Load sidebar badge | `GET /api/workspaces/:workspaceId/messenger/unread` |
| Load General summary | `GET /api/workspaces/:workspaceId/messenger/conversations` |
| Load latest history | `GET .../conversations/:conversationId/messages?limit=50` |
| Load older history | `GET .../messages?beforeSequence=<oldest>&limit=50` |
| Recover a gap | `GET .../messages?afterSequence=<contiguousThrough>&limit=100` until caught up |
| Send text | `POST .../messages` |
| Mark delivered/read | `PUT .../receipt` |
| Add reaction | `POST .../messages/:messageId/reactions` |
| Remove reaction | `DELETE .../messages/:messageId/reactions/:reactionId` |

Initial rendering uses REST even after realtime exists. The websocket accelerates invalidation; it does not replace authorized history loading.

## Realtime events used

Phase 2 works without realtime. After phase 3:

| Event | UI response |
| --- | --- |
| `message.created` | Fetch after the contiguous recovery cursor and merge |
| `conversation.changed` | Refresh the affected summary and aggregate badge |
| `reaction.changed` | Fetch the affected message/delta |
| `receipt.changed` | Update caller-visible delivery state if newer |
| `capabilities.changed` | Refresh permissions and replace/remove composer |
| `access.revoked` | Clear inaccessible state, close view, and reload workspace access |

The UI ignores unknown event versions/types, records a content-free metric, and performs normal REST recovery.

## Message rendering

Render each message as plain text with `white-space: pre-wrap` and `overflow-wrap: anywhere`. React text escaping remains the only default rendering path. The first release does not linkify URLs or render user Markdown/HTML.

Each message exposes:

- Author avatar/name or the distinct Slate AI/system identity.
- Localized timestamp with a full accessible date label.
- Plain-text body.
- Reactions and an accessible reaction action for writers.
- Sender state where relevant.
- Attachments only after phase 4.
- A structured reply reference for Slate AI only after phase 6.

Visually group consecutive messages from the same author when they are at most five minutes apart and no date divider intervenes. Keep every message as a separately addressable semantic item even when headers are visually collapsed.

Date dividers use the user's locale and timezone. The server timestamp is displayed; sequence controls order.

## Timeline, scrolling, and pagination

- Treat the reader as `near latest` when the distance from the scroll bottom is at most 96 CSS pixels.
- Auto-scroll for the sender's canonical message or an incoming message only when the reader was near latest before the update.
- Otherwise preserve the scroll anchor and show a `New messages` affordance with a count.
- When prepending older history, preserve the first visible message and pixel offset.
- Load one older page per explicit threshold crossing; do not issue concurrent duplicate requests.
- A failed older-page request leaves existing history intact and offers retry at the top.
- A sequence gap triggers `afterSequence=<contiguousThroughSequence>` recovery before the connection is labelled live. A later message already present locally never moves the contiguous cursor past a missing earlier message.
- `retainedFromSequence` and `resolvedThroughSequence` close deleted-by-retention prefixes and empty pages without an infinite fetch loop.

## Unread and receipt behavior

The aggregate badge comes from the server, not a client-side subtraction.

Advance `deliveredThroughSequence` after an authorized message page is parsed. Advance `readThroughSequence` only when all are true:

- The conversation is active.
- The page is visible and window is focused.
- The latest displayed message is in or above the viewport's bottom boundary.
- The state remains true for 500 ms to avoid scroll/focus flicker.

Receipt updates are debounced and max-only. Multiple tabs may race safely. The server advances the sender's receipt in the message transaction, so own messages do not become unread. A Slate AI response counts as unread when General is not currently read.

For DMs after phase 5, sender labels derive from the other participant's cursor:

- `Sent`: message committed.
- `Delivered`: other participant's delivered cursor reached the sequence.
- `Read`: other participant's read cursor reached the sequence.

General does not show per-user receipt avatars in the first release.

## Composer behavior

The composer accepts plain text up to 8,000 Unicode code points after server normalization.

Desktop:

- Enter sends unless Shift is held or an IME composition is active.
- Shift+Enter inserts a newline.
- The send button always remains available.

Mobile:

- Enter inserts a newline.
- Only the explicit send button sends.

Send is disabled for whitespace-only content in phase 2. After phase 4, attachment-only messages become valid when at least one attachment is ready.

The client generates one `clientRequestId` with `crypto.randomUUID()` when the send attempt begins and reuses it for every retry of the same normalized payload. Editing a failed item creates a new request ID; retrying without edits keeps the old one. `Discard` removes only the local failed item.

The draft remains in the composer if the request fails before a pending item is created. Once a pending item exists, the composer clears and the retry controls live on that item.

## Reactions

Writers can choose from the central eight-emoji allowlist. The UI groups identical emoji with count and an accessible list of reacting member names already visible in the workspace. Clicking the caller's existing reaction removes it; clicking another allowed reaction adds it.

Optimistic reaction state is permitted, but the canonical server response wins. A denied or conflicted request rolls back the optimistic change without affecting the message.

Until phase 3 provides targeted `reaction.changed` delivery, REST recovery revalidates at most the 100-message window beginning with the first visible message. The refresh is debounced after timeline scrolling and runs on the normal polling interval, so reaction convergence follows the reader without rescanning the full loaded history.

## Permissions and UI states

| State | Timeline | Composer | Reactions |
| --- | --- | --- | --- |
| Owner/editor | read | enabled | enabled |
| Viewer | read | replaced by read-only explanation | hidden/disabled with explanation |
| Removed/blocked | clear and exit | unavailable | unavailable |
| Temporary offline | cached in-memory history | draft allowed; send shows offline failure | disabled until recovery |

The UI is not an authorization boundary. Every server operation repeats the policy checks.

## Errors

| Code/status | UI behavior |
| --- | --- |
| `authentication_required` / `401` | Clear Messenger state and enter the existing authentication flow |
| `workspace_write_denied` / `403` | Refresh capabilities; keep readable history |
| `conversation_not_found` / `404` | Remove stale selection and fall back to General |
| `invalid_message` / `400` | Keep draft/pending item and show specific validation text |
| `idempotency_conflict` / `409` | Do not auto-retry; offer Discard and create-new-send guidance |
| `message_too_large` / `413` | Keep draft and show the current limit |
| `rate_limited` / `429` | Disable retry until `retryAfterMs` expires |
| `messenger_unavailable` / `503` | Keep current history, mark degraded, and offer retry |

Raw database, Redis, websocket, encryption, scanner, or provider errors are never rendered.

## Edge cases

- An unauthorized conversation ID in the URL produces the same fallback as a missing ID and does not reveal its title.
- Switching workspace cancels in-flight requests, closes the old workspace socket, clears message state, and selects the new General.
- Switching to Messenger never changes `activeTab` or destroys/resets editor/canvas state; the document surface remains mounted but inert/hidden.
- A canonical HTTP response and realtime notification may arrive in either order; ID and sequence merging must converge.
- A retry may return an older accepted canonical timestamp than the local pending item; the server value wins.
- A new message arriving during older-page loading must not jump the scroll position or be lost by replacing state.
- A role downgrade while text is drafted preserves the local draft for copy but removes the ability to send.
- A block while a send is in flight resolves according to the server transaction. A committed message may remain for authorized members, but the blocked client loses access.
- Long unbroken text, bidirectional Unicode, emoji sequences, empty lines, and mixed CRLF/LF must not overflow the layout or alter ordering.
- IME Enter events must never send partial composition text.
- Screen-reader live regions announce send-state changes and the new-message affordance, not every historical message on initial load.

## Accessibility

- Conversation rail uses a labelled navigation/list pattern with the active item exposed.
- Timeline uses `role="log"` with controlled live behavior after initial loading.
- Every message, reaction, state, unread badge, and connection status has an accessible name.
- Focus moves from rail to conversation heading on open and returns to the originating rail row on mobile back.
- Loading, empty, read-only, offline, failed, and revoked states are keyboard reachable and do not rely on color.
- Reduced-motion preferences disable nonessential entrance and scroll animations.

## Acceptance criteria

- `Messenger` appears in the Workspace sidebar with a correct aggregate unread badge and stable deep link.
- Opening/closing Messenger preserves the active file, unsaved document state, and workspace shell layout.
- Phase 2 renders only General/text/receipt/reaction controls; attachment, DM, and AI controls are absent.
- Latest, older, gap-recovery, empty, loading, offline, degraded, and retry states behave as documented.
- Sending, exact retry, HTTP/realtime race, and multi-tab receipt tests show no duplicates or cursor rollback.
- Viewer, writer, removed, blocked, and role-change UI states match server policy.
- Plain-text rendering passes XSS cases for HTML, SVG, Markdown links, bidi text, and oversized unbroken strings.
- Desktop/mobile keyboard, IME, focus, screen-reader, reduced-motion, and scroll-anchor tests pass.
- Mobile layout keeps the composer reachable above the keyboard and never traps the page between competing full-height scroll panes.
- Unauthorized/stale conversation URLs fall back safely without leaking DM metadata.
