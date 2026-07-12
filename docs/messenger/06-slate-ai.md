# Phase 6: Slate AI in Messenger

## Implementation status

Implemented on July 11, 2026 behind explicit `MESSENGER_AI_ENABLED=true` and the workspace setting. Valid standalone mentions in General create durable invocations without coupling human-message acceptance to provider availability. A dedicated worker constructs bounded, redacted context without workspace tools. Selected text, JSON, CSV, Markdown, PDF, and non-macro DOCX attachments are re-scanned and extracted in the isolated media service, encrypted with the active workspace data key, and decrypted only for the authorized provider request. Unknown post-dispatch outcomes require explicit user-confirmed redispatch. Messenger renders progress, safe failure/retry states, assistant responses, and requester-only AI Assistant handoff. AI remains unavailable in DMs and default-off globally.

## Goal and phase boundary

Slate AI is available only in the automatic General conversation and only after a writer sends a message containing a valid explicit `@slateai` mention. An ordinary message, a DM, a filename, or context text never invokes the provider.

Messenger AI has two separate outcomes:

1. An answer-only assistant reply posted back to General.
2. An optional explicit handoff to the existing private AI Assistant draft/apply flow for workspace changes.

The answer path never receives workspace-document context or mutation tools. This requires a dedicated `MessengerAiContextBuilder` and `MessengerAiService`. The current `AiAssistantService` cannot be called directly because it automatically builds workspace document context through `WorkspaceContextBuilder`.

## User scenarios

1. A writer sends `@slateai summarize the decision above` in General. The human message commits immediately and one background invocation posts one attributed answer.
2. A message without a valid standalone mention is stored normally and never reaches the provider.
3. `@slateai` in a DM remains plain text and creates no task, extraction, provider request, or response.
4. A writer explicitly selects eligible attachments from the invoking message for AI use. Only those safe extracts enter the prompt.
5. AI is disabled or temporarily unavailable. The human message remains accepted and the UI shows the AI outcome separately.
6. A response suggests creating/updating a workspace file. Only the invoking user sees `Open in AI Assistant`; no workspace read or write occurs until that explicit handoff.
7. The invoker is downgraded, removed, or blocked while the task runs. The task is cancelled before provider dispatch or response commit and no draft is created.
8. A provider request has an ambiguous timeout after dispatch. The system preserves one durable task and one-response invariant without claiming exactly-once provider execution.

## Invocation syntax

The server parses the persisted normalized message, not browser metadata.

A valid mention:

- Uses the exact ASCII handle `@slateai`, case-insensitive.
- Is bounded by start/end, whitespace, or punctuation.
- Is outside backtick inline/fenced code-like spans recognized by the deterministic mention parser.
- Is part of the message body, not a filename, attachment extract, reaction, quote metadata, or prior context.

Examples:

| Text | Invoke |
| --- | --- |
| `@slateai summarize this` | yes |
| `Please ask @SlateAI: what changed?` | yes |
| `@slateai @slateai answer once` | yes, one task |
| `mail@slateai.com` | no |
| `@slateaihelp` | no |
| `@slаteai` with Cyrillic `а` | no |
| `@slateai inside backticks` | no |
| DM body containing `@slateai` | no |

Mention detection may use Unicode normalization on a comparison copy, but confusable characters must not be converted into the ASCII handle. The stored human message remains unchanged. Only the valid invocation token is removed from the provider-facing user prompt.

## Data model

### `MessengerAiInvocation`

Required fields:

- `id`, `workspaceId`, `conversationId`.
- `sourceMessageId @unique`.
- `requestedByUserId`.
- `status`: `skipped`, `queued`, `running`, `completed`, `failed`, or `cancelled`.
- `contextThroughSequence BigInt` fixed to the source message sequence.
- `contextMessageIds Json` containing at most the selected source plus 20 prior message IDs.
- `contextFingerprint` over identifiers/configuration, not plaintext.
- `processingLeaseId`, `processingStartedAt`, `attemptCount`.
- `providerRequestId String?` and `providerDispatchState`: `not_dispatched`, `dispatching`, `dispatched`, or `outcome_unknown`.
- `responseMessageId String? @unique`.
- `errorCode`, `createdAt`, `updatedAt`, `completedAt`.
- Optional structured draft suggestion stored as envelope-encrypted ciphertext/nonce/key version after strict type/size validation. It never contains an executable tool call or URL.

Constraints:

- The source conversation must be General in the same workspace.
- The source message author must equal `requestedByUserId` and be `member`.
- One source message creates at most one invocation.
- One invocation creates at most one assistant response.
- An assistant response uses `authorKind = slate_ai`, `authorUserId = null`, `inReplyToMessageId = sourceMessageId`, and `aiInvocationId = invocation.id`.

### `MessengerAiInvocationAttachment`

This join model records explicit consent and bounded extraction:

- `invocationId` and `attachmentId` as a composite unique key.
- `consentedByUserId` and `consentedAt`.
- `extractionStatus`, `errorCode`, verified content hash, character count.
- Encrypted extracted text, nonce, key version, and `expiresAt`.

The attachment must already belong to the source message, have been uploaded by the requester, be `attached`/malware-clean, and use an AI-extractable format. Extraction data follows the shorter AI-task retention window and is never added to the normal message DTO.

### `MessengerAiHandoff`

This metadata-only link contains `id`, `invocationId`, `requestedByUserId`, target `aiConversationId`, and timestamps. It has no copied message/history/prompt field. The reviewed suggestion copied into the existing AI conversation is governed by that subsystem's encryption, ownership, and retention.

## Creation transaction

When the normal message endpoint accepts a valid General mention:

1. Persist the human message regardless of AI availability.
2. Validate `aiAttachmentIds` as a subset of attachments claimed by that same message.
3. Evaluate current writer access, workspace/global AI setting, and the cost/rate bucket.
4. Always create one `MessengerAiInvocation` for the valid mention: `queued` when eligible, otherwise `skipped` with `ai_disabled`, `ai_rate_limited`, or another safe reason. Create consent rows for the fixed selection.
5. Append `ai.invocation.changed` to the outbox.
6. After commit, enqueue only `queued` invocations on a dedicated Messenger AI queue.

If AI is disabled, rate-limited, or temporarily cannot enqueue, the message still succeeds and returns the durable `skipped` or `queued` invocation. Queue repair scans durable queued rows so a transient enqueue failure does not require duplicating the human message. A later explicit retry may move an eligible `skipped` invocation to `queued` without creating another human message/task row.

## Background task lifecycle

The worker uses a lease and performs authorization three times:

1. Before enqueue/lease.
2. Immediately before provider dispatch.
3. Immediately before saving the assistant response or draft suggestion.

At every point require:

- Active unblocked workspace membership.
- Owner/editor role.
- Active General conversation membership.
- General conversation kind.
- Source message and invocation still retained.
- Workspace `messengerAiEnabled = true` and global kill switch enabled.
- Selected attachments still authorized and extraction policy valid.

Any failure cancels or fails the invocation without posting an assistant message. A provider result received after access loss is discarded.

Successful response commit is one transaction:

- Recheck policy.
- Allocate the next General message sequence.
- Encrypt and insert one `slate_ai` message linked to the invocation/source.
- Mark invocation completed with `responseMessageId`.
- Update conversation summary.
- Append `message.created`, `conversation.changed`, and `ai.invocation.changed` outbox events.

The unique invocation/response constraints prevent two workers from storing two answers.

## Delivery guarantees

Slate guarantees:

- One durable invocation per source message.
- At most one stored assistant response per invocation.
- Safe lease/retry behavior before provider dispatch.
- No automatic duplicate storage after worker races.

Slate cannot honestly guarantee exactly one provider call unless the configured provider accepts an idempotency key. If a worker loses the result after provider dispatch but before durable commit:

- With provider idempotency, retry using the same key.
- Without it, mark `provider_outcome_unknown` and do not automatically redispatch.
- A user-initiated retry reuses the same invocation and clearly may call the provider again, while still storing at most one response.

This avoids a false exactly-once claim and uncontrolled provider cost.

## Context contract

`MessengerAiContextBuilder` constructs a fixed snapshot:

1. The invoking General message with valid mention tokens removed.
2. At most 20 immediately preceding retained General messages with `sequence < contextThroughSequence`.
3. A maximum combined message-context budget of 24,000 Unicode code points, trimming oldest context first.
4. Minimal display names needed to follow speakers.
5. Explicitly consented safe attachment extracts under the limits below.

It excludes:

- Every DM, even when the invoker participates.
- General messages newer than the invoking message.
- Other workspaces/conversations.
- Workspace documents, file tree, canvas, comments, activity, audit, settings, member emails, sessions, tokens, grants, and credentials.
- Attachments not owned by the source message or not explicitly selected.
- Raw image/video bytes and storage URLs.

Context message IDs and `contextThroughSequence` are fixed when the invocation is created. If retention removes required source/context before dispatch, fail `ai_context_unavailable` rather than substituting newer or unrelated data.

The system instruction treats all member messages and attachment extracts as untrusted content, never as policy or tool instructions.

## Attachment extraction

Initial AI-extractable formats:

- Plain text, Markdown, CSV, and JSON after encoding/size checks.
- PDF and non-macro DOCX only through the isolated media/extraction worker.

Excluded:

- Images and video; no OCR/vision in the first release.
- Archives, encrypted/password-protected documents, macro-enabled files, executables, HTML/SVG, and unsupported containers.
- Any file that is not `attached`, malware-clean, and explicitly selected.

Limits:

- At most three selected attachments.
- At most 10 MiB per selected source for extraction.
- At most 32,000 extracted Unicode code points total.
- No network access during parsing.
- Strict CPU, memory, decompression, page, object, and wall-time limits.

If any explicitly selected attachment cannot be extracted under policy, fail the invocation before provider dispatch. Do not silently continue with a reduced prompt because the user consented to a specific context set. The user may send a new invocation without that attachment after seeing the failure.

## Provider boundary and privacy

The service may reuse the existing configured provider client, timeout handling, credentials, and TLS configuration, but uses a Messenger-specific prompt/orchestration path with no workspace tools.

Before dispatch:

- Present clear UI copy that the explicitly invoked content is sent to the configured AI provider.
- Apply input/output limits and best-effort secret-pattern redaction.
- Never claim that redaction detects every secret; users remain warned not to share credentials.
- Send no Slate session, grant, object-storage credential, internal ID not required by the prompt, or audit metadata.
- Record only provider correlation/status in logs and audit, never prompt/response content.

Production enablement requires reviewed provider retention, regional, contractual, and data-use settings.

## Workspace action handoff

The answer-only Messenger model has no mutation tools and does not call `WorkspaceContextBuilder`.

If the answer identifies a possible document/note/table/canvas/update task, it may return a bounded structured `draftSuggestion`. The server renders this as a separate trusted UI card, not a model-authored Markdown link.

Only the invoking user sees `Open in AI Assistant`. Clicking it:

1. Requires current workspace writer permission.
2. Creates or opens a private user-owned `AiConversation` using the existing AI endpoint.
3. Copies only the reviewed suggestion/prompt and an explicit Messenger source reference.
4. Lets the existing AI Assistant read authorized workspace context and prepare `AiDraftAction`.
5. Requires the existing preview and explicit Apply action.
6. Rechecks writer permission and current document version at Apply.

Other General participants see the assistant text but cannot enumerate or open the invoker's AI conversation/draft IDs. No draft is created merely because the group response mentioned a file action.

The handoff confirmation states that it creates a separate private AI Assistant artifact governed by the AI Assistant's own retention policy, not Messenger message retention. Store a metadata-only `MessengerAiHandoff` link from source/invocation to target AI conversation; do not copy General history. Workspace deletion removes both systems, while ordinary Messenger retention may delete the source after the user deliberately retained the reviewed suggestion in AI Assistant.

## APIs

### Initial invocation

The normal `POST .../messages` request includes optional `aiAttachmentIds`. A valid mention creates the invocation automatically and returns:

```json
{
  "message": {},
  "aiInvocation": {
    "id": "invocation-id",
    "status": "queued"
  }
}
```

`status` may be `skipped` with a safe reason when the human message succeeded but current AI policy did not permit dispatch.

### Retry/status

`POST /api/workspaces/:workspaceId/messenger/conversations/:conversationId/messages/:messageId/ai-invocations` accepts:

```json
{
  "confirmProviderRedispatch": false
}
```

- Requires the source to already contain a valid mention.
- Returns the existing completed/running invocation idempotently.
- Moves an eligible `skipped` invocation to `queued` or reclaims a safely retryable failed lease.
- Rejects DM, disabled AI, or changed consent.
- Requires `confirmProviderRedispatch: true` when `providerDispatchState = outcome_unknown`.

`GET /api/workspaces/:workspaceId/messenger/ai-invocations/:invocationId` returns safe status to authorized General members, while private handoff/draft identifiers are visible only to the requester.

### Draft handoff

The UI uses existing workspace AI conversation/task APIs after explicit click. Messenger does not introduce a second file-mutation endpoint.

## Realtime events

`ai.invocation.changed` contains `invocationId` and `skipped|queued|running|completed|failed|cancelled` only. General members fetch safe status through REST.

The assistant answer appears through the normal minimal `message.created { messageId, sequence }` event. No provider response text, prompt, extract, draft payload, action ID, or error internals travel in the AI status event.

## Permissions

| Operation | Owner | Editor | Viewer | Removed/blocked |
| --- | --- | --- | --- | --- |
| Invoke in General | allow | allow | deny | deny |
| View safe General AI response/status | allow | allow | allow | deny |
| Invoke in DM | deny | deny | deny | deny |
| Consent own source-message attachment | allow | allow | deny | deny |
| See private draft handoff | requester only | requester only | deny | deny |
| Open AI Assistant handoff | allow | allow | deny | deny |
| Apply own authorized draft | allow | allow | deny | deny |

The worker rechecks current permissions; the role at message-send time is not a permanent capability.

Workspace AI setting is owner-controlled and audited. A global operational kill switch overrides it and cancels queued/running work before further provider dispatch.

## Errors

AI errors are separate from the human message result.

| Status | Code | Retryable | Meaning |
| --- | --- | --- | --- |
| `404` | `ai_invocation_not_found` | no | Missing or inaccessible invocation |
| `403` | `workspace_write_denied` | no | Active General reader no longer has writer capability |
| `409` | `ai_invocation_in_progress` | yes | Existing task still owns a live lease |
| `409` | `provider_outcome_unknown` | no | Dispatch may have succeeded; resend only with explicit confirmation |
| `422` | `ai_not_available_in_direct_message` | no | Conversation is not General |
| `422` | `ai_attachment_consent_required` | no | Attachment was not explicitly selected |
| `422` | `ai_attachment_processing` | yes | Attachment extraction is not complete |
| `422` | `ai_attachment_unsupported` | no | Attachment cannot be safely extracted |
| `422` | `ai_context_unavailable` | no | Source/bounded context no longer exists |
| `413` | `ai_context_too_large` | no | Invocation/extract exceeds hard limits |
| `429` | `ai_rate_limited` | yes | Cost/user/workspace quota exceeded |
| `503` | `ai_disabled` | no | Workspace/global/provider configuration disabled |
| `503` | `provider_unavailable` | yes | Provider dependency failed before known dispatch |
| `504` | `provider_timeout_before_dispatch` | yes | Timeout occurred before a provider dispatch was accepted |

Provider safety refusal maps to `provider_content_blocked` without exposing provider internals.

## Rate and cost controls

Use all of:

- Early per-IP mutation limit.
- Authenticated per-user and per-workspace invocation buckets.
- Maximum one in-flight Messenger AI invocation per user.
- Configurable small workspace concurrency matching provider quota.
- Daily token/extraction cost budget per workspace.
- Stricter byte/page/time limits for extraction.

The current generic IP limiter alone is insufficient. Redis failure behavior is fail-closed for provider-cost operations unless a deliberately small local emergency budget is configured.

## Edge cases

- Multiple valid mentions in one message create one invocation.
- Case variants invoke; Unicode homoglyphs do not.
- Mention in filename, extract, quoted prior message, inline/fenced code-like span, DM, or `@slateaihelp` does not invoke.
- Human message commits but queue enqueue fails: durable queued-row repair enqueues later without a second message.
- Two workers lease the same task: one lease/unique response wins.
- Provider succeeds but commit fails: follow provider-idempotency/unknown-outcome policy, never claim exactly once.
- New General messages arrive while AI runs: fixed `contextThroughSequence` excludes them.
- Retention removes the source before dispatch: cancel/fail without broadening context.
- User is downgraded, removed, blocked, or AI is disabled before dispatch: no provider call.
- Access is lost after provider response but before commit: discard output and create no response/draft.
- Selected attachment becomes rejected/deleting: fail that consent path and never substitute another attachment.
- Prompt injection inside a message/extract cannot grant workspace tools because the answer path has none.
- Provider returns Markdown/HTML/URL: Messenger renders bounded plain text; any handoff is a separate server-generated structure.
- Provider returns oversized content: enforce output limit before encryption/storage and mark a safe failure if it cannot be bounded.
- Assistant response ordering uses its commit-time sequence and `inReplyToMessageId`, not the invocation start time.
- Another General member guesses the invoker's draft or AI conversation ID: existing owner-user access denies it.

## Acceptance criteria

- Valid standalone mention in General creates one durable task and at most one stored assistant response.
- Ordinary text, code-like mention, filename/extract mention, confusable handle, and every DM mention produce zero provider calls.
- Provider mock receives only the invoking message, at most 20 prior General messages through the fixed sequence, and explicitly consented safe extracts.
- Provider mock receives no DMs, newer messages, workspace documents, file tree, comments, activity, audit, sessions, grants, credentials, or unselected attachments.
- Two workers, duplicate enqueue, HTTP retry, and user retry preserve one invocation/one stored-response constraints.
- Ambiguous post-dispatch failure follows the documented no-automatic-redispatch behavior.
- Block, removal, downgrade, AI disable, and retention races before dispatch/commit create no response or draft.
- Extraction tests reject malware, encrypted/macro/archive content, parser bombs, oversized sources, and non-consented files.
- Human message success is independent from AI queue/provider success.
- Messenger response renders plain text and model-controlled content cannot create a trusted link/action.
- Workspace changes require explicit requester handoff, existing private AI ownership, preview, writer permission, version checks, and Apply.
- Other group members cannot enumerate/open the requester's AI conversation or draft.
- Audit/log/telemetry contain IDs, status, cost, and safe error codes only, never prompt, response, extract, filename, token, or provider credential.
