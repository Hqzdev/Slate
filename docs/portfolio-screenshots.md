# Portfolio screenshot brief

Capture desktop images at the current workspace viewport and keep a consistent 1063 by 903 baseline. Use one neutral demo workspace named `Slate Product Demo`; no private e-mail addresses, tokens, repository URLs, or development alerts may be visible.

## Gallery

| File | Route and state | Required visible evidence | Status |
| --- | --- | --- |
| `01-landing.png` | `/` at the hero | Product message, graph, navigation, and primary action. | Captured |
| `02-dashboard.jpg` | Workspace dashboard | Documents, activity, execution status, and GitHub integration summary. | Captured |
| `03-files-code.jpg` | Code document | Monaco, synced state, sandbox selection, and execution action. | Captured |
| `04-canvas-overview.jpg` | Canvas document | Diagram, shape tools, grid, layers, and inspector. | Captured |
| `05-canvas-multiselect.jpg` | Canvas document with multiple shapes selected | Group selection bounds and resize handles. | Pending |
| `06-ai-draft.jpg` | AI panel with a generated draft | User request, structured response, draft card, and Apply boundary. | Captured |
| `07-ai-mermaid.jpg` | AI canvas diagram preview | Mermaid source and native diagram preview. | Pending |
| `08-github-sync.jpg` | Dashboard with configured repository | Repository identity, sync state, tracked-file count, and manual sync action. | Pending |
| `09-collaboration.jpg` | Members or settings surface | Roles, invitation control, and workspace boundary. | Pending |
| `10-run-output.jpg` | Successful run | Queued-to-complete result, output, duration, and shared activity context. | Pending |
| `11-mobile-landing.jpg` | `/` at 390 by 844 | Responsive landing hierarchy and actions. | Pending |
| `12-dark-workspace.jpg` | Workspace in dark theme | Dark theme quality and editor/canvas density. | Pending |

## Demo content

Use a fictional project named `Billing Platform`. Create these artifacts before capture:

- `src/charge.ts` with an idempotent `charge()` function.
- `src/retry.ts` with retry policy types.
- `README.md` note titled `Payment reliability decisions`.
- `System design` canvas with API, worker, queue, database, and provider nodes.
- A completed `node --test` run with a passing result.
- A GitHub repository card named `billing-platform` only when a real configured integration can be shown without exposing private data.

## Capture rules

- Take screenshots only from the running product.
- Do not use mocked screenshots, browser devtools, alerts, toast errors, empty states, or partially open menus.
- Wait for fonts, document content, avatars, and realtime status to settle.
- Capture the full workspace viewport, not isolated crop fragments.
- Save files to `docs/screenshots/` using the names above.
- Compress images before commit and keep the total gallery under 8 MB.
- Add each verified image to the `Product tour` section of the root README after it exists.
