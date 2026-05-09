# Trauma Execution Workflows

This directory contains task-scoped execution workflows. Each file is intended
to be read independently by a worker that owns one pull request.

Use this directory instead of a single large implementation plan. The goal is to
keep each worker's context focused on its own domain.

## Task Map

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 4 | [Importer and add memory](task-04-importer-add-memory.md) | URL extraction, link-only fallback, add memory server flow | Ready |
| 5 | [Browse shell and filters](task-05-browse-shell-filters.md) | `/memories`, shell layout, list/grid, query filters, right-panel shortcuts | Ready |
| 6 | [Reader pipeline](task-06-reader-pipeline.md) | `/memories/:id`, markdown render, sanitize, rich reader features | Ready after Task 5 |
| 7 | [Highlight system](task-07-highlight-system.md) | Selection UI, highlight persistence, `/highlights`, highlight-aware search | Ready after Task 6 |
| 8 | [Git backup queue](task-08-git-backup-queue.md) | In-process queue, git commit/push, retry, backup status | Ready after Tasks 4 and 7 |
| 9 | [E2E integration hardening](task-09-e2e-integration-hardening.md) | Deterministic fixtures and full flow Playwright coverage | Final integration pass |
| 10 | [Runtime dev server stabilization](task-10-runtime-dev-server-stabilization.md) | `bun run dev` crash, deterministic host/port contract, startup smoke | Refactor wave entry point |
| 11 | [Test suite health refactor](task-11-test-suite-health-refactor.md) | Test boundaries, weak assertions, startup coverage, script normalization | Ready after Task 10 |
| 12 | [GitHub Actions and docs health](task-12-github-actions-and-docs-health.md) | CI trigger split, docs health checks, scheduled docs maintenance workflow | Ready after Task 11 |
| 13 | [Markdown reader library decision](task-13-markdown-reader-library-decision.md) | Reader library spike, ADR, dependency direction | Ready after Task 10 |
| 14 | [Markdown reader refactor](task-14-markdown-reader-refactor.md) | Reader pipeline decomposition and behavior-preserving refactor | Ready after Task 13 |
| 15 | [Refactor wave integration](task-15-refactor-wave-integration.md) | Cross-task verification and workflow/docs synchronization | Ready after Tasks 10-14 |

## Archived Workflows

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 1 | [Project bootstrap](archive/task-01-project-bootstrap.md) | Toolchain, scaffold, baseline verification | Archived |
| 2 | [Config and persistence](archive/task-02-config-persistence.md) | Config loader, path validation, Drizzle schema, repositories | Archived |
| 2.5 | [Coding standards refactor](archive/task-02-5-coding-standards-refactor.md) | Standards audit, vulnerability cleanup, readability refactor | Archived |
| 3 | [Markdown store](archive/task-03-markdown-store.md) | `CONTENT.md` writer/reader and frontmatter contract | Archived |

## Worker Rules

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
- `ExtractionStatus` is shared through `src/server/memory-status.ts` and used
  by markdown frontmatter validation and SQLite constraints.

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
