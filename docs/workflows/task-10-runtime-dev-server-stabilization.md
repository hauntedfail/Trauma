# Task 10: Runtime Dev Server Stabilization Workflow

## Goal

Make local development startup reliable. `bun run dev` must start the app
without exit code 1 on a clean checkout with the pinned toolchain.

## Required Context

- [Technology stack](../references/technology-stack.md)
- [Local/self-hosting operation](../operations/local-self-hosting.md)
- [Verification strategy](../quality/verification.md)
- [Coding standards](../references/coding-standards/INDEX.md)

## Current Failure To Reproduce

Run:

```bash
mise exec -- bun run dev
```

Observed failure:

```text
Unable to find a random port on any host
error: script "dev" exited with code 1
```

## Ownership

Primary files and directories:

- `package.json`
- `app.config.ts`
- `mise.toml`
- `playwright.config.ts`
- Dev/server scripts under `scripts/**` if introduced.
- Runtime startup tests or smoke checks under `tests/**` or `e2e/**`.

Do not refactor reader, importer, database repositories, or UI layout in this
task unless the dev startup failure is directly caused by those surfaces.

## Implementation Steps

1. Capture the startup failure.
   - Run `mise exec -- bun run dev`.
   - Record the exact exit code and stack trace in the PR notes.
   - Check whether the failure depends on occupied ports, host binding, sandbox
     permissions, or Vinxi random-port behavior.

2. Define the local dev server contract.
   - Choose explicit default host and port behavior.
   - Prefer deterministic configuration over random-port discovery.
   - Keep the dev contract compatible with Playwright and local browser testing.

3. Implement the smallest startup fix.
   - Update SolidStart/Vinxi config or package scripts as needed.
   - If a helper script is added, keep it thin and deterministic.
   - Do not hide startup failures by swallowing errors.

4. Add a startup smoke check.
   - Add a command that starts the dev or preview server with explicit host and
     port, probes `/memories`, then shuts down cleanly.
   - The check must fail if the server cannot bind or exits early.
   - Avoid depending on a long-lived background process in CI.

5. Update docs only for the new contract.
   - Document exact local dev commands.
   - Document any `HOST` or `PORT` environment variables if they become part of
     the contract.

## Acceptance Criteria

- `mise exec -- bun run dev` no longer exits with code 1 on a clean checkout.
- The selected host/port behavior is deterministic and documented.
- A smoke check catches early startup crashes.
- Existing verification still passes.

## Verification

Run:

```bash
mise exec -- bun run dev
bun run typecheck
bun run test
bun run build
```

Run E2E only after the startup contract is stable:

```bash
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Original startup failure output.
- Final startup command and URL.
- Any host/port contract changes.
- Exact verification commands and outcomes.
