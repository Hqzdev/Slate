# Roadmap

## Tier A: Working Demo

Goal: prove the product loop.

- Create the web app.
- Show Monaco and native canvas in one room.
- Synchronize code with Yjs.
- Synchronize canvas state with Yjs.
- Add awareness and visible participants.
- Add room URLs.
- Persist snapshots.
- Add sandboxed execution for one or two languages.
- Document local setup.

Demo: two tabs show synchronized code, canvas edits, presence, and execution output.

## Tier B: Senior Differentiators

Goal: turn the demo into a serious system.

- Replace temporary sync provider with a custom sync service.
- Add stronger sandbox isolation.
- Add Git repository import and push flow.
- Add AI collaborator as a room participant.
- Add export worker.
- Add observability.
- Add load testing.

## Tier C: Product Platform

Goal: make it product-complete.

- Organizations.
- Advanced permissions.
- Billing.
- Multi-region deployment.
- Full admin and audit surfaces.

## Anti-Roadmap

Do not start with:

- Kubernetes.
- Terraform.
- Full OAuth.
- AI agents.
- Git push flows.
- Custom sync protocol.

Those are credible only after the realtime room exists.
