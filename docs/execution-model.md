# Execution Model

The execution system exists to run user code without trusting it.

## Tier A Scope

Start with one or two languages. Python and Node are enough to prove the product loop.

The current first executable environment is Node inside a one-run Docker container. The worker writes the submitted source snapshot into a temporary directory, mounts it read-only at `/workspace`, runs `node /workspace/<file>`, collects stdout/stderr, then removes the directory.

The first version should accept:

- Language.
- Source code.
- Optional standard input.

It should return:

- Standard output.
- Standard error.
- Exit code.
- Timeout status.
- Execution duration.

## Isolation

The first implementation can use per-run containers if it enforces limits from the beginning.

Required constraints:

- No network by default.
- Memory limit.
- CPU limit.
- Wall-clock timeout.
- No mounted project secrets.
- Controlled temporary filesystem.

For the Node container environment these constraints are enforced with Docker flags: `--network none`, memory and CPU limits, `--pids-limit`, a read-only root filesystem, a small `/tmp` tmpfs, and a read-only bind mount for the submitted file.

## Streaming

Output should stream back to the room. If streaming is too expensive for the first slice, a complete response is acceptable only as a temporary product compromise.

## Non-Goals

Do not start with:

- Firecracker.
- Warm pool orchestration.
- Arbitrary language support.
- Package installation.
- Internal network access.

Those are later system problems, not first-demo requirements.
