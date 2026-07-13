# GitHub Sync

Slate connects private repositories through a GitHub App. The app installation must be restricted to the repositories selected by the workspace owner.

## Production setup

1. Set `APP_URL` to the public HTTPS origin of Slate.
2. In GitHub App settings, set the callback URL to `${APP_URL}/api/github/callback`.
3. Grant the app `Contents: Read and write` permission.
4. Install the app only for the intended repositories.
5. Set `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_PRIVATE_KEY` in the server environment.

## Sync behavior

- The first import reads supported text files smaller than 80 KiB and skips binary or oversized files.
- Slate reads GitHub files in bounded concurrent batches.
- `Check GitHub changes` produces a preview before any workspace write.
- Slate refuses to apply an incoming update when the same tracked file has local changes.
- `Commit & push` requires the remote branch head observed by Slate, preventing an overwrite of a newer remote commit.

GitHub webhooks are optional. They require a public Slate URL and can later trigger the same preview flow; they are not required for the manual refresh flow.
