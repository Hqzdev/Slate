# Git Sync

Slate has two separate Git integrations. The local Git Bridge watches a configured repository, creates commits only on its configured sync branch, and pushes through the machine's existing Git credential. The workspace GitHub App connects one selected GitHub repository, including private repositories, without exposing credentials to the browser. GitHub Actions validates every pushed `sync/**` branch.

Configure the GitHub App integration through [docs/github-app.md](github-app.md). It has its own owner-only import and commit boundary; it does not use the local bridge.

The bridge never checks out branches, force-pushes, stages an already staged index, or syncs `main`, `master`, or `production`. It refuses common secret-bearing paths before staging.

## Configure the bridge

Copy `services/git-bridge/.env.example` to `services/git-bridge/.env`. Set a random bridge token and one or more repository entries. The branch must be a non-protected branch such as `sync/slate` and must already be checked out locally.

Copy the same bridge URL and token into `apps/web/.env.local`. Set `SLATE_GIT_SYNC_ADMIN_EMAILS` to the authenticated Slate account permitted to request status and manual sync.

Start the bridge from the repository root:

```bash
npm run git-sync
```

The service listens only on `127.0.0.1:1238`. The browser talks only to the authenticated Slate API; the token and Git credential never reach the browser.

## Sync behavior

When `autoSync` is enabled, the bridge waits 1.5 seconds after the latest worktree event. A clean working tree is reported as `Synced`; changed tracked files are committed as `chore(sync): workspace changes` and pushed to the configured branch. Untracked files always require `Sync now`, so generated or copied files cannot be committed silently. If the remote branch is ahead, the Git index is already staged, the active branch is wrong, or a protected file is detected, the bridge stops and returns `Needs attention`.

GitHub Actions is a verification boundary, not a transport mechanism. It cannot see local changes until the bridge has pushed them. A successful Git Sync push therefore means `pushed`, not automatically merged into `main`.
