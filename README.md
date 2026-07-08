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
  persistence/         Rooms, documents, and snapshots
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

The web prototype exists in [apps/web](/Users/yaroslavfairfieldd/Documents/Github/Slate/apps/web). It includes the landing page, login, registration, and a workspace shell with real Monaco and native canvas surfaces.

## Web App

Start the sync service first:

```bash
cd services/sync
npm install
npm run dev
```

Then start the web app:

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Available routes:

- `/` — landing page.
- `/login` — sign in.
- `/register` — account creation.
- `/workspace` — product workspace prototype.

Workspace status:

- Monaco editor is mounted in the code panel.
- Editor content is backed by Yjs and synced through the local WebSocket sync service.
- The native SVG canvas is mounted in the canvas panel.
- Canvas state persists to documents and syncs across tabs through the local WebSocket sync service.
- The Run button still uses a mocked sandbox output stream.

## Next Step

Replace the mocked workspace surfaces with real product engines:

1. Add explicit presence and remote cursor UI.
2. Add sync-service persistence.
3. Replace mocked Run output with the execution service.
4. Move canvas sync from browser-local persistence to a networked room store.
