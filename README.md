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
- Next API routes in `apps/web`.
- The sync service in `services/sync`.
- The execution worker in `services/execution`.

## Local Server Stack

From the repository root, start the complete local stack:

```bash
npm run dev
```

On macOS, this opens Docker Desktop when needed. It then starts Postgres and Redis, generates the Prisma clients, applies database migrations, and runs the web app, sync service, and execution worker. Press `Ctrl+C` to stop the application services. Postgres and Redis remain available for the next start.

Stop Postgres and Redis when they are no longer needed:

```bash
npm run dev:down
```

Install each workspace's dependencies before the first start:

```bash
npm --prefix apps/web install
npm --prefix services/sync install
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
