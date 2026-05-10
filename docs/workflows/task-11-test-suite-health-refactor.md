# Task 11: Test Suite Health Refactor Workflow

## Goal

Make the test suite a reliable guardrail for refactor work instead of a loose
collection of feature tests.

## Required Context

- [Verification strategy](../quality/verification.md)
- [Review feedback policy](../references/coding-standards/review-feedback-policy.md)
- [Coding standards](../references/coding-standards/INDEX.md)
- [Task 10](task-10-runtime-dev-server-stabilization.md)

This task consumes the startup contract produced by Task 10. It must not modify
Task 10 workflow text, Task 10 runtime code, or the startup smoke implementation
unless the Task 10 PR has already merged and exposed a broken public command.

## Ownership

Primary files and directories:

- `tests/**`
- `e2e/**`
- `vitest.config.ts`
- `playwright.config.ts`
- `package.json` scripts.
- Test utilities or fixtures under `tests/**` and `e2e/**`.

Do not change product behavior in this task unless a test exposes a real defect
and the fix is necessary to make the suite truthful.

Do not edit `scripts/dev-smoke.ts`, dev server config, or Task 10 workflow
files in this task. Treat them as external inputs.

## Implementation Steps

1. Inventory current tests.
   - Classify every test as unit, integration, route/server-function, or E2E.
   - Identify tests that depend on fixtures, real filesystem paths, network,
     port availability, or production config.
   - Record whether each test can run without a dev server.

2. Define test boundaries.
   - Unit tests cover pure parsing, formatting, routing helpers, and validators.
   - Integration tests cover SQLite, config, store, importer, and reader
     server modules with isolated temp state.
   - E2E tests cover user flows through the app shell.
   - Startup smoke remains owned by Task 10; this task only wires the stable
     command into verification once it exists on `main`.

3. Remove false confidence.
   - Strengthen assertions that can pass on `null`, empty arrays, or swallowed
     runtime failures.
   - Ensure empty-state tests do not mask missing config, failed DB init, or
     missing runtime adapters.
   - Search for assertions that compare optional dimensions or nullable values
     without first proving the target exists.
   - Search for fixture data leaking into production route/server loaders.
   - Search for tests that treat caught runtime/config/DB errors as empty
     product data.
   - Search for filesystem tests that write under real `data/`, `.trauma/`, or
     the repository root instead of temp directories.

4. Add deterministic startup coverage.
   - Integrate the Task 10 smoke check into local verification or CI.
   - Ensure the test fails when the app exits before serving a route.
   - If Task 10 has not merged, document the pending integration instead of
     reimplementing startup smoke here.

5. Normalize scripts.
   - Keep `bun run verify` as the baseline code verification command.
   - Add focused scripts only when they reduce ambiguity, for example
     `test:unit`, `test:e2e`, or `test:startup`.
   - If `test:startup` is added, it must call the Task 10 public smoke command
     rather than duplicating server startup logic.
   - Do not introduce npm/yarn/pnpm lockfiles.

6. Document the test contract.
   - Update workflow docs only when a human needs to know which command to run.
   - Prefer executable checks over prose.

## Acceptance Criteria

- Test categories and ownership are clear.
- Tests do not write to real app data directories.
- Runtime startup failure is caught by a check.
- Existing weak assertions are strengthened where they affect refactor safety.
- Fixture-backed data cannot appear in production loaders unless gated by an
  explicit test/runtime flag.
- Missing config, DB initialization failure, and missing runtime adapters cannot
  be asserted as normal empty states.
- `bun run verify` remains the baseline local and CI command.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

Run any new focused script introduced by this task.

## PR Handoff

The PR description must include:

- Test inventory summary.
- New or changed scripts.
- Any product defects found while hardening tests.
- Exact verification commands and outcomes.
