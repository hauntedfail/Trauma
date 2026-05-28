# TRAUMA Execution Workflows

This directory contains task-scoped execution workflows. Each file is intended
to be read independently by a worker that owns one pull request.

Use this directory instead of a single large implementation plan. The goal is to
keep each worker's context focused on its own domain.

## Task Map

Status values describe the current `main` baseline. This directory is for
active or ready execution plans, not for long-term storage of completed PR
history. Once a workflow lands, keep only durable semantic knowledge in
architecture, reference, quality, or operations docs.

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 9 | [E2E integration hardening](task-09-e2e-integration-hardening.md) | Deterministic fixtures and full flow Playwright coverage | Available for further hardening |
| 11 | [Test suite health refactor](task-11-test-suite-health-refactor.md) | Test boundaries, weak assertions, startup coverage, script normalization | TODO after archived Task 10 baseline |
| 12 | [GitHub Actions and docs health](task-12-github-actions-and-docs-health.md) | CI trigger split, docs health checks, scheduled docs maintenance workflow | TODO after Task 11 |
| 13 | [Markdown reader library decision](task-13-markdown-reader-library-decision.md) | Reader library spike, ADR, dependency direction | TODO after archived Task 10 baseline |
| 14 | [Markdown reader refactor](task-14-markdown-reader-refactor.md) | Reader pipeline decomposition and behavior-preserving refactor | TODO after Task 13 |
| 15 | [Refactor wave integration](task-15-refactor-wave-integration.md) | Cross-task verification and workflow/docs synchronization | TODO after Tasks 11-14 |
| 22 | [Vim-like memory browse keybindings](task-22-vim-like-key-bindings.md) | `/memories` keyboard cursor, search focus, and selected-memory open behaviour | In progress on `feat/vim-like-key-bind` |

## Current Audit Notes

- Task 10 was stale in the active task map because its startup contract is
  already part of the merged baseline through `dev`, `start`, `preview`, and
  `dev:smoke`; the execution plan is now archived.
- Task 19 and its repair/follow-up plans are archived as historical Brilliant
  execution records. Current translation behaviour is represented by the code,
  architecture/reference docs, and tests, not active workflow plans.
- Tasks 11-15 remain active TODO plans after checking the current tree. In
  particular, `scripts/check-docs-health.ts`, `docs:check`,
  `.github/workflows/docs-health.yml`, `docs/references/reader-pipeline-decision.md`,
  and the Task 14 split reader modules are not present on `main`.

## Archived Workflows

`docs/workflows/archive/` contains historical execution plans that are no
longer active work. Do not start implementation from archived files. If an
archived task reveals a durable rule, move that rule into the owning semantic
document instead of reviving the old execution plan.

| Workflow | Archived Location | Reason |
| --- | --- | --- |
| Task 10: Runtime dev server stabilization | [archive/task-10-runtime-dev-server-stabilization.md](archive/task-10-runtime-dev-server-stabilization.md) | Startup contract is merged into the shared baseline. |
| Task 19: Brilliant Codex translation family | [archive/task-19-codex-translation.md](archive/task-19-codex-translation.md) | Translation implementation and follow-up repair plans have landed or been superseded. |

## Worker Rules

- Start at [docs/INDEX.md](../INDEX.md) for orientation before touching files;
  all durable project detail lives under `docs/`.
- Own only the files listed in the workflow unless the PR description explains
  why a boundary change is required.
- Read the workflow file, its referenced docs, and
  [coding standards](../references/coding-standards/INDEX.md) before coding.
- Keep PRs domain-scoped. Do not bundle unrelated UI, storage, importer, and
  backup changes.
- Add tests in the same PR as the behavior.
- Run the workflow's verification commands before handoff.
- Record exact commands and outcomes in the PR body.

## Shared Baseline

All workflows assume the bootstrap already exists:

- Bun `1.3.13`, pinned in `mise.toml` and `package.json`.
- SolidStart stable v1 through `@solidjs/start@1.3.2`.
- Drizzle, Vitest, and Playwright are installed.
- `bun run verify` runs typecheck, unit tests, and build.
- `bun run test:e2e` runs the Playwright smoke suite.
- Config and persistence foundations are merged, including path validation,
  migrations before repository exposure, and Bun SQLite connection lifecycle.
- Markdown content store APIs are merged, including content path resolution,
  writer/reader behavior, and filesystem-isolated fixtures.
- Importer and add-memory APIs are merged, including link-only fallback behavior
  and backup enqueue boundaries.
- Browse shell and reader pipeline foundations are merged, including
  repository-backed browse rows, shared shell layout, and sanitized markdown
  rendering.
- Highlight creation, toggle removal, `/highlights`, and highlight-aware
  `/memories` search are merged.
- Git backup queue and backup status tracking are merged.
- Runtime command stabilization is merged: `dev`, `start`, and `preview` run
  Vinxi through Bun for server code that depends on Bun APIs.
- Defuddle v0.18+ extraction, browser-assisted import API, and the local Chrome
  MV3 browser extension are merged.
- Backup environment failsafe, content-integrity alerts, and missing-file
  SQLite record deletion recovery are merged.
- `ExtractionStatus` is shared through `src/server/memory-status.ts` and used
  by markdown frontmatter validation and SQLite constraints.
- The refined frontend baseline is merged: design tokens, theme surfaces,
  brand assets, shell layout, browse/highlight surfaces, reader right rail,
  TOC behaviour, wax controls, and cross-device chrome are documented under
  [design system](../references/design-system/INDEX.md).

## Branching

Use concise branch names that match the workflow:

- `feat/importer-add-memory`
- `feat/browse-shell`
- `feat/reader-pipeline`
- `feat/highlights`
- `feat/git-backup-queue`
- `test/e2e-hardening`
- `fix/dev-server-startup`
- `test/test-suite-health`
- `ci/docs-health`
- `chore/reader-library-decision`
- `refactor/markdown-reader`
- `chore/refactor-wave-integration`
- `feat/vim-like-key-bind`
- `feat/brilliant`
