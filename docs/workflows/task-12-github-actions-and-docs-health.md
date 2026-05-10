# Task 12: GitHub Actions And Docs Health Workflow

## Goal

Separate code verification from documentation health, and add scheduled docs
maintenance checks that keep agent-facing documentation current without turning
`AGENTS.md` into a large rulebook.

## Required Context

- [Documentation index](../INDEX.md)
- [Review feedback policy](../references/coding-standards/review-feedback-policy.md)
- [Verification strategy](../quality/verification.md)
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

## Ownership

Primary files and directories:

- `.github/workflows/**`
- `docs/**`
- `AGENTS.md`
- `README.md`
- `scripts/check-docs-health.ts`
- `package.json`

Do not change application runtime behavior in this task.

## Implementation Steps

1. Audit current GitHub Actions.
   - Confirm code paths that should trigger CI.
   - Confirm docs-only changes do not run expensive app checks unless workflow
     files or executable scripts changed.
   - Keep release verification on tag pushes.

2. Define docs health checks.
   - Check that `AGENTS.md` is a short map and links to owning docs.
   - Check that `docs/INDEX.md` links to existing files.
   - Check that `docs/workflows/README.md` links to existing workflow files.
   - Check that coding standards do not contain PR-specific history.
   - Check for broken relative links in markdown.
   - Check archived workflow links and active workflow links separately.
   - Check that every markdown file under `docs/` is linked from either
     `docs/INDEX.md`, `docs/workflows/README.md`, or another indexed doc.
   - Check for stale references to the removed review-learning document.
   - Check for pull-request-number markers, merge-commit narratives, and
     commit-hash narratives in coding standards and architecture docs.

3. Implement the smallest executable checker.
   - Create `scripts/check-docs-health.ts`.
   - Add `docs:check` to `package.json` and point it at that script.
   - The script must exit non-zero with actionable messages.
   - Avoid adding a broad documentation framework unless needed.
   - Keep checks deterministic and local.

4. Add a docs workflow.
   - Create `.github/workflows/docs-health.yml`.
   - Trigger on docs-related paths, `AGENTS.md`, `README.md`,
     `scripts/check-docs-health.ts`, `package.json`, workflow dispatch, and a
     weekly scheduled cadence.
   - Upload a report artifact when useful.
   - Do not auto-commit documentation rewrites in the first version.
   - Do not require secrets.

5. Update docs maintenance instructions.
   - Document the docs health command in the appropriate workflow or quality
     doc.
   - Keep `AGENTS.md` as a pointer, not the detailed rule source.

## Acceptance Criteria

- Code CI and docs health have clear triggers.
- Docs-only changes have a cheaper, relevant validation path.
- Scheduled docs health exists and can be run manually.
- The docs checker catches stale links and PR-history accumulation.
- `bun run docs:check` is the local docs health command.
- `.github/workflows/docs-health.yml` is the GitHub Actions entrypoint.
- No workflow depends on secrets for normal validation.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Run the new docs health command locally. Also validate workflow syntax by
inspecting the YAML diff and, when available, using GitHub Actions checks after
push.

## PR Handoff

The PR description must include:

- CI trigger changes.
- Docs health checks implemented.
- Scheduled cadence.
- Exact verification commands and outcomes.
