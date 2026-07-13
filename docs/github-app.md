# GitHub App repository sync

Slate connects a workspace to one selected GitHub repository through a GitHub App. The workspace owner installs the app, chooses the repository and branch, imports supported text files, then commits tracked file changes from the workspace.

## Create the GitHub App

In the GitHub App registration:

- Set the callback URL to `${APP_URL}/api/github/callback`.
- Enable `Request user authorization (OAuth) during installation`.
- Set repository access to `Only select repositories`.
- Give `Contents` read and write permission. Metadata remains read-only.
- Generate a private key and record the App slug, App ID, client ID, and client secret.

Set these server-only values in `apps/web/.env.local`:

```bash
GITHUB_APP_SLUG=your-app-slug
GITHUB_APP_ID=your-app-id
GITHUB_APP_CLIENT_ID=your-client-id
GITHUB_APP_CLIENT_SECRET=your-client-secret
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

Never expose the private key or client secret through `NEXT_PUBLIC_` variables. Use literal `\n` escapes when the private key is stored on one environment-variable line.

## Access model

Only the workspace owner can install or disconnect the app, select a repository, import files, or commit and push. Editors and viewers can see the connection status but cannot receive GitHub credentials or trigger write operations.

The install callback is bound to a single-use, expiring Slate state. OAuth confirms that the user completing the callback can access the GitHub installation. Slate immediately revokes that user token and uses a short-lived, repository-scoped installation token only for the requested GitHub operation.

## Import and commit boundary

Import supports up to 25 non-binary text files, each no larger than 80 KiB. Supported source files become code documents; Markdown becomes note documents. A repository with no eligible files is rejected.

The first version tracks only imported files. It commits changed mapped documents and deletes mapped documents that were archived in Slate. It does not add arbitrary new workspace documents, sync canvas documents, force-push, merge remote changes, or overwrite a branch whose head moved after the dashboard was refreshed.

GitHub webhook reconciliation is intentionally deferred. The dashboard reads the current branch head before a commit and rejects a stale commit request, so a user must refresh and resolve remote changes outside Slate before trying again.
