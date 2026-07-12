# Phase 5: Direct messages

## Implementation status

Implemented on July 11, 2026. The implementation includes canonical unordered-pair creation with serializable conflict recovery, provisional visibility, first-message activation, strict participant access, shared attachments/realtime/unread contracts, removal and block revocation, explicit reactivation, UI recipient selection, unavailable states, and cleanup of expired empty provisional conversations. Production rollout remains governed by the phase 7 IDOR and staging matrix.

## Goal and phase boundary

This phase adds one private one-to-one conversation for each unordered pair of users inside one workspace. DMs reuse the message, receipt, reaction, attachment, unread, outbox, realtime, encryption, retention, and media contracts from earlier phases while enforcing a stricter two-participant boundary.

The first release has no group DMs, cross-workspace DMs, public/share links, forwarding, external participants, owner/admin content override, or Slate AI in DMs.

## User scenarios

1. An owner/editor selects `New message` and chooses another current, unblocked workspace member.
2. The server finds or creates the canonical pair conversation. The sender can compose immediately; the recipient does not see a never-used provisional DM.
3. The first accepted message activates the DM. The recipient receives `conversation.added`, sees the row/unread count, and can read it even when their workspace role is viewer.
4. Either participant later opens the same person again. The server returns the existing canonical conversation and never creates a duplicate.
5. A third workspace member, including the owner, guesses the DM ID. Every history, send, receipt, media, reaction, and realtime operation is denied without revealing the DM.
6. One participant is removed or blocked. That user's DM memberships and active delivery/media are revoked. The remaining participant may read retained history but cannot send new messages or uploads to the unavailable recipient.
7. A previously removed user rejoins. General returns automatically, but old DMs remain inactive until an owner/editor participant explicitly opens/creates that same canonical pair.

## UI behavior

After phase 5, `ConversationRail` adds:

- `New message` for owners/editors only.
- Activated DM rows ordered after General by last-message time.
- The other participant's avatar/name, safe last-message preview, timestamp, unread count, and unavailable state.
- Provisional DM state only for the creator while composing/uploading the first message.

The picker searches current active workspace members already available through an authorized member endpoint. It excludes the current user, blocked/removed users, and users outside the active workspace. Search is local over the bounded member list or uses a workspace-authorized endpoint; it never becomes a global user directory.

A viewer has no `New message` action because creating an empty conversation is a write with no useful viewer outcome. A viewer can receive and read a DM initiated by a writer but cannot send, upload, or react.

The active DM header shows only the other participant's identity and current availability. It does not show the full workspace member list or imply that owners can inspect content.

## Data model

### Canonical pair

For users `A` and `B`:

1. Reject `A == B`.
2. Confirm both have current unblocked `WorkspaceMember` rows in the same `workspaceId`.
3. Sort user IDs lexicographically.
4. Build `directPairKey = lowerUserId + ":" + higherUserId`.
5. Use `@@unique([workspaceId, directPairKey])`.

User IDs cannot contain the delimiter under the current ID format. If that assumption changes, replace the representation with two explicit sorted columns and a composite unique constraint rather than relying on string parsing.

The same pair in two workspaces has two isolated DM conversations because `workspaceId` participates in uniqueness and authorization.

### Conversation fields

A DM `MessengerConversation` has:

- `kind = direct`.
- `generalKey = null`.
- Non-null `directPairKey`.
- `createdByUserId` for cleanup/audit of the initial provisional creation.
- `activatedAt = null` until first accepted message, then immutable non-null.
- `lastMessageSequence` and `lastMessageAt` shared with General.

Exactly two `MessengerConversationMember` rows represent the canonical pair. Conversation membership is durable and uses `active/revoked` rather than deleting history/audit lineage.

### Provisional DM

The create endpoint may need a conversation ID before the first message so attachments can bind to the correct conversation. A newly created DM is therefore provisional:

- Visible only to a participant whose `MessengerConversationMember.openedAt` is non-null because that user explicitly called create/open.
- Not included in the recipient's conversation list or unread count.
- Emits targeted `conversation.added` only to each explicit opener so the live gateway can authorize that provisional conversation; it emits nothing to a passive recipient.
- Deleted by an idempotent cleanup job after 24 hours if it has no messages and no live/ready attachments.

The first message transaction sets `activatedAt`, ensures both receipts, advances the sender's receipt only, and appends `conversation.added` plus `message.created`. The recipient can never observe a conversation with a partially committed first message.

### Reactivation after removal/rejoin

Removal/block sets the affected user's membership in every DM to `revoked`. The other participant remains active, can read retained history, and sees the recipient as unavailable; sends require both canonical users to be active/unblocked. Rejoining a workspace reactivates only General.

An owner/editor participant may call the DM create/open endpoint later. If both canonical users are currently active/unblocked:

- Reuse the existing pair conversation.
- Reactivate both DM memberships transactionally.
- Preserve `activatedAt` and retained message history.
- Preserve receipt cursors, clamped to the retained range as needed.
- Append `conversation.added`/`capabilities.changed` for currently authorized users.

This is an explicit product choice: the same pair regains its retained history after deliberate reactivation. If a future product needs a fresh privacy epoch, it requires a different conversation-generation model and cannot silently alter this contract.

A remaining `WorkspaceBlock` always prevents reactivation. Unblock alone is insufficient because it does not restore `WorkspaceMember`.

## Creation transaction

`POST /api/workspaces/:workspaceId/messenger/direct-conversations` accepts:

```json
{
  "recipientUserId": "user-id"
}
```

The service:

1. Requires the requester to be a current workspace writer.
2. Rejects self-DM.
3. Loads both current workspace members and block state inside the transaction.
4. Computes the canonical sorted pair.
5. Upserts the conversation by `workspaceId + directPairKey`.
6. Creates/reactivates exactly two conversation memberships and receipts.
7. Sets the requester's member `openedAt`. It does not set the passive recipient's `openedAt` before activation.
8. Appends targeted `conversation.added` for the requester, metadata-only security audit when newly created/reactivated, and no workspace-wide Activity event.
9. Returns the canonical `Conversation`.

Response status:

- `201` for a new provisional conversation.
- `200` for an existing active or reactivated conversation.

Concurrent requests from both users rely on the unique constraint and transaction retry. The result is one conversation with two member rows and both requesters' `openedAt` set, so either can continue composing without exposing an empty DM to a passive recipient.

## Shared API contracts

DM operations use the same workspace-nested routes and DTOs as General:

| Action | Route |
| --- | --- |
| List activated DMs | `GET /api/workspaces/:workspaceId/messenger/conversations` |
| Open/create canonical DM | `POST /api/workspaces/:workspaceId/messenger/direct-conversations` |
| Read latest/older/recovery history | `GET .../conversations/:conversationId/messages` |
| Send/activate | `POST .../conversations/:conversationId/messages` |
| Advance own receipt | `PUT .../conversations/:conversationId/receipt` |
| React | `POST/DELETE .../messages/:messageId/reactions` |
| Reserve/read attachment | Phase 4 routes under the same conversation |
| Authorize workspace realtime | `POST /api/workspaces/:workspaceId/messenger/realtime/authorize` |

There is no DM-specific message, upload, download, or websocket bypass. Every shared service resolves the resource back to the same workspace and exactly two active conversation members.

## Conversation list behavior

For the current user, the list query returns:

- General.
- Activated DMs where the caller's conversation membership is active.
- A live provisional DM where the caller's `openedAt` is non-null.

It never returns:

- A provisional DM created by the other participant.
- A DM where the caller is not one of the canonical pair.
- A revoked DM.
- A conversation inferred only from owner role or workspace membership.

The same rule is enforced in history/media/message policy: before activation, an active member row without `openedAt` does not authorize the passive recipient.

The title, avatar, and availability derive from the other canonical member. Last-message preview is decrypted only after the caller passes both workspace and DM membership checks.

## Realtime events

| Event | Recipient |
| --- | --- |
| `conversation.added` for provisional open | The explicit requester only, after gateway reauthorization |
| `conversation.added` after first message | Both active pair members; practically new for the recipient |
| `conversation.added` after reactivation | Both reactivated pair members |
| `message.created` | The two active pair members only |
| `conversation.changed` | The two active pair members only |
| `reaction.changed` | The two active pair members only |
| `receipt.changed` | The two active pair members only |
| `attachment.changed` | Creator while unclaimed; both after message claim |
| `access.revoked` | Affected participant and gateway connection registry |
| `conversation.changed` on recipient loss | Remaining participant, to render unavailable/read-only state |

Events contain IDs/cursors only. A workspace-wide socket does not mean workspace-wide DM visibility; the gateway's server-side membership set filters every event.

## Receipts and unread

DM unread uses the same cursor model:

- Own sent messages are not unread to the sender.
- The first message creates unread state for the recipient only after activation.
- A read cursor may advance only over messages visible to that participant.
- Delivered/read labels shown to a sender derive only from the other participant's cursor.
- No online status or typing indicator is inferred from receipts.
- A revoked participant's old cursor remains stored but is not exposed until legitimate reactivation.

## Attachments

An attachment reservation is bound to the DM conversation and uploader from the start. The attachment service repeats the two-member check at reservation, completion, claim, status, and content stream.

Workspace owner status does not authorize another pair's object. A guessed attachment ID returns the same non-enumerating response as a missing attachment.

If the DM is provisional, only its creator can see the upload state. The recipient sees the attachment only after the first message transaction activates the DM and claims the ready attachment.

## AI behavior

`@slateai` is ordinary plain text in a DM. The message endpoint:

- Does not create `MessengerAiInvocation`.
- Does not call a provider.
- Does not expose an AI retry endpoint outcome.
- Does not inspect attachments for AI.

A forged AI invocation request for a DM returns `ai_not_available_in_direct_message` without provider dispatch.

## Permissions

| Operation | Pair member owner/editor | Pair member viewer | Workspace member outside pair | Removed/blocked pair member |
| --- | --- | --- | --- | --- |
| Create/reactivate DM | allow | deny | only with self as one side and writer role | deny |
| List/read activated DM | allow | allow | deny | deny |
| Send/upload/react when both pair members are active | allow | deny | deny | deny |
| Advance own receipt | allow | allow | deny | deny |
| Receive events | allow | allow | deny | deny |
| Download attached file | allow | allow | deny | deny |
| Invoke Slate AI | deny | deny | deny | deny |

The workspace owner can remove/block members and see metadata-only security audit events, but cannot read a DM unless they are one of its two canonical participants.

## Errors

| Status | Code | Retryable | Meaning |
| --- | --- | --- | --- |
| `400` | `invalid_recipient` | no | Missing/malformed recipient or self-DM |
| `403` | `workspace_write_denied` | no | Viewer cannot create/reactivate |
| `404` | `recipient_unavailable` | no | Recipient is missing, outside the workspace, removed, or blocked |
| `404` | `conversation_not_found` | no | Missing/inaccessible DM |
| `409` | `conversation_inactive` | no | Reactivation preconditions failed |
| `409` | `idempotency_conflict` | no | Retried message ID changed payload |
| `429` | `dm_rate_limited` | yes | Creation/reactivation bucket exhausted |
| `503` | `messenger_unavailable` | yes | Durable DM transaction unavailable |

The external status/code for missing, cross-workspace, removed, and blocked recipients is always `404 recipient_unavailable`. A safe internal reason category may differ in restricted metrics; response status, code, and text do not.

## Edge cases

- Both users create the same DM simultaneously: one pair row wins and each successful create/open transaction marks that requester's `openedAt`.
- A create request races with member removal/block: the in-transaction member/block recheck denies or commits before revocation; no half-membership remains.
- The first send races from both sides: one conversation activates once; both messages receive unique sequences.
- A provisional creator closes the browser: cleanup removes the empty conversation only after live uploads expire.
- A provisional conversation contains a ready upload but no message: upload cleanup runs first, then DM cleanup.
- A recipient becomes viewer after activation: read access remains, send/upload/react disappears.
- A writer becomes viewer with a failed local send: retry is denied and the UI preserves text only for copy/discard.
- A member is removed while the other sends: the send either commits before revocation or is denied; the removed client cannot fetch afterward, while the remaining participant retains read-only history.
- Both users later rejoin: the first explicit writer open/reactivate restores the same retained conversation, not a duplicate.
- One user remains blocked after rejoin attempt: reactivation fails closed.
- The workspace owner requests a third-party DM ID: response is indistinguishable from missing.
- The same two global users share several workspaces: each workspace history, receipts, files, grants, and retention remain isolated.
- A user changes display name/avatar: the DM row derives current safe identity while historical author attribution follows the product's deleted/renamed-user policy.
- Retention deletes every message: the activated DM may remain as an empty canonical row; creating it again reuses the row.
- AI-like text, code, filenames, or Unicode confusables in a DM never enqueue AI.

## Acceptance criteria

- Database and service tests prove exactly one DM per unordered pair per workspace under concurrent creation.
- A DM has exactly two canonical member rows and no third user can list, read, send, react, update receipts, receive events, or access media.
- Owner/admin role never bypasses third-party DM content isolation.
- Viewer cannot create a DM but can read an existing DM initiated by a writer.
- A provisional DM is visible only to participants whose `openedAt` records an explicit open/create action and appears to a passive recipient atomically with the first accepted message.
- Empty provisional DMs and their abandoned uploads are cleaned without deleting activated conversations.
- Removal/block revokes active REST, realtime, attachment, and media access for the affected user.
- Rejoin alone does not restore DMs; explicit valid reactivation reuses the canonical pair and retained history.
- Cross-workspace pair IDs and attachments remain isolated even for the same two users.
- DM unread, delivered, read, retry, offline recovery, and multi-tab behavior reuse and pass the shared contracts.
- `@slateai` in a DM produces no task, provider request, extracted attachment data, or assistant response.
- IDOR tests cover every DM route and use non-enumerating external failures.
