# TRAUMA Execution Workflows

This directory contains task-scoped execution workflows. Each file is intended
to be read independently by a worker that owns one pull request.

Use this directory instead of a single large implementation plan. The goal is to
keep each worker's context focused on its own domain.

## Task Map

Status values usually describe the current `main` baseline. When a workflow is
active on a named branch, the status names that branch explicitly. Workflow
files may still contain historical branch names and evidence because they are
execution records; do not treat completed triage records as active work queues.

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 7 | [Highlight system](task-07-highlight-system.md) | Selection UI, highlight persistence, `/highlights`, highlight-aware search | Merged baseline |
| 8 | [Git backup queue](task-08-git-backup-queue.md) | In-process queue, git commit/push, retry, backup status | Merged baseline |
| 9 | [E2E integration hardening](task-09-e2e-integration-hardening.md) | Deterministic fixtures and full flow Playwright coverage | Available for further hardening |
| 10 | [Runtime dev server stabilization](task-10-runtime-dev-server-stabilization.md) | `bun run dev` crash, deterministic host/port contract, startup smoke | Merged baseline |
| 11 | [Test suite health refactor](task-11-test-suite-health-refactor.md) | Test boundaries, weak assertions, startup coverage, script normalization | Ready after Task 10 |
| 12 | [GitHub Actions and docs health](task-12-github-actions-and-docs-health.md) | CI trigger split, docs health checks, scheduled docs maintenance workflow | Ready after Task 11 |
| 13 | [Markdown reader library decision](task-13-markdown-reader-library-decision.md) | Reader library spike, ADR, dependency direction | Ready after Task 10 |
| 14 | [Markdown reader refactor](task-14-markdown-reader-refactor.md) | Reader pipeline decomposition and behavior-preserving refactor | Ready after Task 13 |
| 15 | [Refactor wave integration](task-15-refactor-wave-integration.md) | Cross-task verification and workflow/docs synchronization | Ready after Tasks 10-14 |
| 16 | [Red call runtime triage](task-16-red-call-runtime-triage.md) | Runtime command contract, env loading, config path consistency, E2E recovery | Merged into main |
| 16b | [Drizzle and SQLite hardening](task-16b-db-orm-hardening.md) | Bun SQLite API cleanup, migration boundary, DB config alignment, repository safety | Merged into main |
| 16c | [Defuddle importer extraction refactor](task-16c-defuddle-importer-refactor.md) | Defuddle v0.18+ content extraction, importer fallback, markdown safety, fixture coverage | Merged into main |
| 16d | [Browser-assisted import extension](task-16d-browser-assisted-import.md) | Chrome MV3 extension, local import API, token validation, browser-captured content fallback | Merged into main |
| 16e | [Browser extension live DOM extraction](task-16e-browser-extension-live-dom-extraction.md) | Injected content-script bundle, live DOM extraction, site-specific selectors, no server URL fetch fallback | Merged into main |
| 16f | [Backup environment failsafe](task-16f-backup-environment-failsafe.md) | Backup path drift detection, red recovery UI, first-start git init, remote push warning behavior | Merged into main |
| 17 | [Front-end refine from sample](task-17-front-end-refine.md) | Refined sample translation, Tailwind tokens, brand assets, shell, browse/highlights, reader, visual QA | Active on `refine/frontend-sample` |

Task 17.8 is intentionally split under
`task-17-front-end-refine/08*.md`: the parent file is an execution map, while
strategy, tests, container ownership, safe-area layout tokens, implementation,
capability/preference media queries, responsive image markup, E2E, and
design-system docs each have their own focused workflow file.

## Archived Workflows

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 1 | [Project bootstrap](archive/task-01-project-bootstrap.md) | Toolchain, scaffold, baseline verification | Archived |
| 2 | [Config and persistence](archive/task-02-config-persistence.md) | Config loader, path validation, Drizzle schema, repositories | Archived |
| 2.5 | [Coding standards refactor](archive/task-02-5-coding-standards-refactor.md) | Standards audit, vulnerability cleanup, readability refactor | Archived |
| 3 | [Markdown store](archive/task-03-markdown-store.md) | `CONTENT.md` writer/reader and frontmatter contract | Archived |
| 4 | [Importer and add memory](archive/task-04-importer-add-memory.md) | URL extraction, link-only fallback, add memory server flow | Archived |
| 5 | [Browse shell and filters](archive/task-05-browse-shell-filters.md) | `/memories`, shell layout, list/grid, query filters, right-panel shortcuts | Archived |
| 6 | [Reader pipeline](archive/task-06-reader-pipeline.md) | `/memories/:id`, markdown render, sanitize, rich reader features | Archived |
| 16a | [Tailwind migration](archive/task-16a-tailwind-migration.md) | Tailwind v4 Vite plugin, `app.css` removal, component-local styling | Archived |

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
- The front-end refine workflow uses `refined_sample/` as a design source and
  decomposes it into existing Solid components rather than porting the sample as
  one large component.

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
- `refine/frontend-sample`

The historical triage branches named in Task 16 records have landed. New work
should branch from the current target branch and use a fresh name rather than
reusing old triage branch names.
