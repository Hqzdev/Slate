# Contributing

This project is early. Contributions should make the first working product slice more real, not make the architecture look bigger.

## Priorities

1. Realtime editor and canvas demo.
2. Presence and room behavior.
3. Persistence.
4. Sandboxed execution.
5. Integrations only after the core loop works.

## Engineering Rules

- Keep changes minimal and intentional.
- Do not add placeholder services, fake workflows, or unused abstractions.
- Prefer composition over inheritance.
- Keep responsibilities narrow.
- Do not add comments to code.
- Use names and structure to make code self-explanatory.
- Delete dead code instead of preserving it.

## Pull Request Expectations

- Explain the user-facing behavior changed.
- Include the smallest useful verification path.
- Call out security implications when touching execution, auth, tokens, or persistence.
- Avoid unrelated refactors.

## Branches

Use short feature branches. Keep each branch focused on one product slice.
