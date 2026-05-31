# Task 15: Refactor Wave Integration Workflow

## Goal

Verify that the runtime, tests, CI, docs health, and reader refactor work
together after Tasks 10-14.

## Required Context

- [Task 10](archive/task-10-runtime-dev-server-stabilization.md)
- [Task 11](task-11-test-suite-health-refactor.md)
- [Task 12](task-12-github-actions-and-docs-health.md)
- [Task 13](task-13-markdown-reader-library-decision.md)
- [Task 14](task-14-markdown-reader-refactor.md)
- [Verification strategy](../quality/verification.md)

## Ownership

Primary files and directories:

- `docs/workflows/README.md`
- `docs/quality/**`
- `README.md`
- CI workflow files if integration exposes gaps.
- Small test or script fixes needed to make the full verification sequence
  truthful.

Do not add new product features in this task.

## Implementation Steps

1. Re-run the complete local verification sequence.
   - Install dependencies from the lockfile.
   - Run typecheck, unit/integration tests, build, E2E, startup smoke, and docs
     health.
   - Record exact commands and outcomes.
   - Use the exact commands in this workflow's Verification section.

2. Check workflow consistency.
   - Ensure Task 10-14 workflow files match the implemented code.
   - Archive or mark workflows complete only when their PRs are merged.
   - Keep `docs/workflows/README.md` current.

3. Check documentation consistency.
   - Confirm `AGENTS.md` remains a short map.
   - Confirm `docs/INDEX.md` links to current docs.
   - Confirm technology-stack and architecture docs match the reader and CI
     decisions.

4. Fix integration-only gaps.
   - Address broken scripts, missing docs links, stale workflow statuses, or
     incorrect verification commands.
   - Do not refactor implementation modules unless an integration check proves
     the current behavior is broken.

5. Confirm CI behavior.
   - Push a PR and inspect GitHub Actions.
   - Confirm code changes trigger code CI.
   - Confirm docs-only changes trigger docs health but not unnecessary expensive
     app checks.
   - Confirm release workflow still runs on tag pushes.
   - Use `gh pr checks --watch`.
   - Use `gh run list --branch <branch> --limit 10`.
   - Use `gh run view <run-id> --log-failed` for any failed run.

## Acceptance Criteria

- Full local verification sequence passes.
- GitHub Actions behavior matches the intended trigger split.
- Docs health check passes.
- `docs/workflows/README.md` accurately reflects the refactor wave state.
- No stale PR-specific review history is added to coding standards.

## Verification

Run:

```bash
bun install --frozen-lockfile
bun run docs:check
```

Run the Task 10 startup smoke command exactly as documented by Task 10 after it
has merged. Then run:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

After opening or updating the PR, run:

```bash
gh pr checks --watch
gh run list --branch <branch> --limit 10
gh run view <run-id> --log-failed
```

## PR Handoff

The PR description must include:

- Full verification matrix.
- Remaining known risks, if any.
- Workflow/docs updates made.
- GitHub Actions results.
