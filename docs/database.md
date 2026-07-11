# Database Workflow

Slate uses Prisma migrations as the source of truth for database structure.

## Local Development

Run local schema changes through migrations:

```bash
cd apps/web
npm run db:migrate
```

Use `db:generate` after schema changes when you only need to refresh Prisma clients:

```bash
cd apps/web
npm run db:generate
```

`db:push` is for disposable local experiments only. Do not use it as the main project workflow because it bypasses migration history.

## Production-Like Environments

Apply committed migrations without creating new ones:

```bash
cd apps/web
npm run db:deploy
```

Check drift and pending migrations:

```bash
cd apps/web
npm run db:status
```

## Baseline

`0001_initial_schema` is the baseline migration for the current Slate schema. It includes users, sessions, workspaces, documents, realtime state, comments, job runs, and audit events.

Future schema changes should add new migration folders rather than editing the baseline.
