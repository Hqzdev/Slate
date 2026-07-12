# Messenger production runbook

## Deployment order

1. Apply migrations through `0020_messenger_ai_extraction_leases` with Messenger feature flags disabled.
2. Run the General reconciliation and validate zero invariant violations.
3. Verify production keyring, private storage encryption, trusted proxy header, realtime origins, scanner, and provider configuration.
4. Start the realtime publisher, media and AI extraction worker, Messenger AI worker, and retention cleanup on their own schedules.
5. Run smoke, security, failure-injection, and load checks in staging.
6. Enable text Messenger first. Enable realtime, attachments, and AI only after their own health checks pass.

## Scheduled jobs

Run `npm run messenger:retention:cleanup` at least hourly. It is idempotent and must alert when pending tombstones, deleting attachments, or failed cleanup age beyond the operational objective.

Run `npm run messenger:attachments:cleanup` as a separate frequent worker for abandoned uploads and media rejections.

Run `npm run messenger:direct-conversations:cleanup` at least hourly for abandoned provisional DMs.

Run `npm run messenger:ai:worker` as a supervised worker pool. Multiple instances coordinate through database leases. Keep `MESSENGER_AI_ENABLED=false` until provider and extraction checks pass.

Run `MESSENGER_ROTATE_WORKSPACE_ID=<workspace-id> npm run messenger:key:rotate` for each approved workspace key rotation. Retain every previous wrapping key in `MESSENGER_KEY_ENCRYPTION_KEYS` until all ciphertext and backups referencing it have expired.

## Incident controls

Set `MESSENGER_ENABLED=false` to stop all Messenger API access. Set `MESSENGER_REALTIME_ENABLED=false` to disable new realtime grants. Set `MESSENGER_ATTACHMENTS_ENABLED=false` to stop attachment operations. Disable Messenger AI through its workspace setting or service configuration.

For a suspected credential leak, disable the affected capability, rotate the relevant key or credential with overlap where needed, invalidate grants by changing access versions, and verify recovery using metadata-only audit events. Do not inspect message content unless the incident process explicitly authorizes it.

## Restore procedure

Restore into an isolated environment. Before serving traffic, apply current workspace membership and block state, replay incomplete deletion tombstones, remove expired grants, and verify that no deleted attachment object or message ciphertext is accessible. Record the restore exercise and its recovery point objective.

## Health and monitoring

Scrape `/metrics` and probe `/health/ready` on `messenger-realtime` and `messenger-media`. Install `monitoring/messenger/alerts.yml` and import `monitoring/messenger/dashboard.json`. Test alert delivery before rollout. A failed readiness probe, outbox dead letter, sustained backlog, or extraction failure spike blocks capability enablement.

## Staging gates

Run `npm run messenger:security:staging` with isolated authorized and forbidden workspace fixtures. Run `npm run messenger:load` with `MESSENGER_LOAD_FORECAST_CONCURRENCY` set to the recorded forecast; the harness applies the required 2x factor and fails above the configured p95 or one-percent error budget. Write-enabled load requires `MESSENGER_LOAD_ALLOW_WRITES=true` and disposable staging data. Execute scanner, Redis, storage, gateway, provider, worker-crash, key-rotation, and backup-restore failure exercises before production approval.
