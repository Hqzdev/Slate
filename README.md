# Slate

Slate is a realtime collaborative coding workspace. The long-term product direction is a multiplayer code editor with an infinite canvas, sandboxed code execution, persistence, source-control integrations, and AI collaborators.

The project is intentionally built MVP-first. The first milestone is not a complete microservice platform. It is a working vertical demo: two browser tabs in one room editing code and canvas state together, with visible presence and a safe Run button.

## MVP

Tier A proves the product:

- Shared rooms by URL.
- Monaco editor synchronized with Yjs.
- Native canvas state synchronized with Yjs.
- Awareness and presence for online users.
- Persistent room snapshots.
- Sandboxed execution for a small set of languages.
- Local development through one documented command once the stack exists.

## Later Scope

Tier B adds the work that is valuable only after the demo is real:

- Custom sync service.
- Git repository import, edit, commit, and push.
- AI participant in the room.
- Stronger sandbox isolation.
- Export workers.
- Observability and load testing.

Tier C is deferred:

- Organizations.
- Billing.
- Multi-region deployment.
- Advanced permission models.

## Repository Layout

```text
apps/
  web/                 Browser workspace
services/
  sync/                Realtime synchronization service
  messenger-realtime/  Messenger notification gateway and outbox publisher
  messenger-media/     Isolated attachment validation and preview worker
  execution/           Sandboxed code execution service
packages/
  shared/              Shared domain types
  protocol/            Service contracts and wire formats
infra/
  docker/              Local infrastructure definitions
docs/
  decisions/           Architecture decision records
```

## Product Style

Slate should feel like a precise premium developer tool: restrained, fast, monochrome-first, and workspace-led. The design direction is documented in [docs/design-system.md](/Users/yaroslavfairfieldd/Documents/Github/Slate/docs/design-system.md).

## Architecture Principle

The project starts as a vertical product slice and grows into services only where the boundary is justified by load profile or security.

Realtime sync and sandbox execution have different operational risks. Sync holds long-lived connections and must stay low-latency. Execution runs untrusted code and must be isolated. Those are real service boundaries. A premature full platform is not.

## Current Status

The web app exists in [apps/web](/Users/yaroslavfairfieldd/Documents/Github/Slate/apps/web). It includes the landing page, login, registration, workspace management, Monaco, native canvas, comments, invites, activity, realtime grants, and run creation.

The local server stack is:

- Postgres for users, sessions, workspaces, documents, snapshots, jobs, activity, and audit events.
- Redis for rate limiting, realtime fanout, and the execution queue.
- MinIO for local private Messenger object storage.
- ClamAV for Messenger attachment malware scanning.
- Next API routes in `apps/web`.
- The sync service in `services/sync`.
- The execution worker in `services/execution`.
- The Messenger realtime gateway in `services/messenger-realtime`.
- The Messenger media worker in `services/messenger-media`.

## Local Server Stack

From the repository root, start the complete local stack:

```bash
npm run dev
```

On macOS, this opens Docker Desktop when needed. It then starts Postgres, Redis, MinIO, and ClamAV, creates the private Messenger bucket, generates the Prisma clients, applies database migrations, builds and starts the isolated Messenger media worker, and runs the web app, sync service, Messenger realtime gateway, and execution worker. Press `Ctrl+C` to stop the application services. Container infrastructure remains available for the next start.

Stop the local container infrastructure when it is no longer needed:

```bash
npm run dev:down
```

Install each workspace's dependencies before the first start:

```bash
npm --prefix apps/web install
npm --prefix services/sync install
npm --prefix services/messenger-realtime install
npm --prefix services/messenger-media install
npm --prefix services/execution install
```

Open [http://localhost:3000](http://localhost:3000).

Available routes:

- `/` — landing page.
- `/login` — sign in.
- `/register` — account creation.
- `/workspace` — product workspace prototype.

Health checks:

- Web API: [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)
- Sync service: [http://127.0.0.1:1234/health](http://127.0.0.1:1234/health)
- Execution worker: [http://127.0.0.1:1235/health](http://127.0.0.1:1235/health)
- Messenger realtime: [http://127.0.0.1:1236/health/live](http://127.0.0.1:1236/health/live)
- Messenger media: internal container health check on port `1237`.
- MinIO API: [http://127.0.0.1:9000/minio/health/live](http://127.0.0.1:9000/minio/health/live)
- MinIO console: [http://127.0.0.1:9001](http://127.0.0.1:9001)

## Messenger Foundation

Messenger phase 1 provides the encrypted server data layer and APIs; the Messenger page itself starts in phase 2. Production must set `MESSENGER_KEY_ID`, `MESSENGER_KEY_ENCRYPTION_KEY`, and `MESSENGER_FINGERPRINT_KEY`. Both key values are independent 32-byte base64 secrets. During wrapping-key rotation, `MESSENGER_KEY_ENCRYPTION_KEYS` holds a JSON object of every retained key ID to base64 key while `MESSENGER_KEY_ID` selects the active writer key. Local development has an explicit non-production fallback.

Messenger retention runs as a separate idempotent cleanup worker: `npm --prefix apps/web run messenger:retention:cleanup`. It creates deletion tombstones before removing object variants and ciphertext. Rotate an approved workspace key with `MESSENGER_ROTATE_WORKSPACE_ID=<workspace-id> npm --prefix apps/web run messenger:key:rotate`. Production must also set `TRUSTED_PROXY_CLIENT_IP_HEADER` to the header supplied only by its trusted edge proxy.

After deploying migration `0015_messenger_foundation`, reconcile existing workspaces before enabling Messenger:

```bash
npm --prefix apps/web run messenger:backfill
```

The command is idempotent and reports only aggregate counts and its workspace cursor. A database whose name contains `test` can run the destructive foundation smoke test:

```bash
npm --prefix apps/web run messenger:smoke
```

The smoke test verifies encrypted persistence, idempotent send, stable sequence allocation, viewer denial, unread/receipt behavior, and reactions, then removes its own fixture.

Keep `MESSENGER_ENABLED=false` during migration and reconciliation. Set it to `true` only after backfill finishes with zero invariant violations; all Messenger REST routes otherwise fail closed.

Messenger realtime is independently gated by `MESSENGER_REALTIME_ENABLED`. Production must provide `MESSENGER_REALTIME_PUBLIC_URL`, `MESSENGER_REALTIME_GRANT_ACTIVE_KID`, `MESSENGER_REALTIME_GRANT_KEYS`, and `MESSENGER_REALTIME_ALLOWED_ORIGINS`. Grants expire after two minutes, are never persisted by the browser, and websocket events contain only identifiers and recovery cursors. Keep the realtime flag disabled until migration `0016_messenger_realtime_outbox_leases` is deployed and the gateway health check is ready.

Messenger attachment upload is independently gated by `MESSENGER_ATTACHMENTS_ENABLED`. Migration `0017_messenger_attachments_foundation` adds encrypted attachment metadata, durable media jobs, atomic message claims, cleanup state, and the missing realtime dead-letter status. Local development uses the private `slate-messenger` MinIO bucket. Production must provide a private S3-compatible endpoint, bucket, credentials, TLS, server-side encryption, quotas, and lifecycle monitoring before enabling the flag.

Messenger AI is independently default-off through `MESSENGER_AI_ENABLED=false` and can be stopped immediately with `MESSENGER_AI_KILL_SWITCH=true`. Migration `0020_messenger_ai_extraction_leases` adds crash-recoverable leases for consented attachment extraction in the isolated media service. The Messenger AI worker runs separately from the web process. Realtime and media expose `/health/ready` and `/metrics`; staging security and 2x-forecast load gates are available through `npm run messenger:security:staging` and `npm run messenger:load`.

Verify the direct-upload lifecycle against local Postgres and MinIO:

```bash
npm --prefix apps/web run messenger:storage:smoke
npm --prefix apps/web run messenger:media:smoke
npm --prefix apps/web run messenger:attachments:cleanup
```

The storage smoke reserves an encrypted attachment, performs the signed exact-size POST, rejects an invalid-size upload, confirms storage metadata, creates the durable media job, abandons the object, and removes its fixture. The media smoke verifies clean PNG processing, its generated WebP thumbnail, and a real MinIO Range read, then requires the EICAR test pattern to finish as `malware_detected`; it removes every object and database fixture. The browser UI exposes uploads only when both Messenger rollout flags are enabled.

## AI Assistant

The workspace AI panel uses GigaChat through server-only credentials. The safe MVP can answer questions, read workspace documents, prepare draft code, notes, GFM tables, and native canvas diagrams, and propose full-content updates for completely observed code and note documents. Drafts change the workspace only after Apply. Existing document updates use a bounded diff preview and a live Yjs content-hash check so concurrent edits are never overwritten silently. Canvas updates remain deferred.

Put the GigaChat values from `apps/web/.env.example` in `apps/web/.env.local` so credentials stay scoped to the web runtime. Prefer the ready-to-use Basic credential in `GIGACHAT_AUTHORIZATION_KEY`; separate client ID and secret values are also supported. Keep `GIGACHAT_MAX_CONCURRENCY=1` for the default personal API quota unless the provider raises the limit. Put the same random `SYNC_INTERNAL_API_SECRET` of at least 32 characters in the web and sync environments. The sync service uses a minimal service-local Prisma client and only imports an allowlist of database and realtime settings from the shared `apps/web/.env` file.

The main GigaChat endpoint requires the Russian trusted root certificate. `npm run dev` and `npm start` use the bundled official certificate automatically. Deployments can override it by setting `NODE_EXTRA_CA_CERTS` before Node starts:

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/to/russian_trusted_root_ca_pem.crt
cd apps/web
npm run dev
```

Do not disable TLS verification. See the [GigaChat certificate guide](https://developers.sber.ru/docs/ru/gigachat/certificates).

Run the server smoke test after all services are up:

```bash
node scripts/smoke-server.mjs
```

The smoke test checks health endpoints, AI storage readiness, registration, workspace creation, document creation, realtime authorization, run creation, and worker completion.

Workspace status:

- Monaco editor is mounted in the code panel.
- Editor content is backed by Yjs and synced through the local WebSocket sync service.
- The native SVG canvas is mounted in the canvas panel.
- Canvas state persists to documents and syncs across tabs through the local WebSocket sync service.
- The Run button creates queued jobs for the execution worker.

## Next Step

Harden the server chain:

1. Add a single local stack command for all services.
2. Add reconnect and persistence tests around the sync service.
3. Add run cancellation, streaming status, and stronger execution result metadata.
