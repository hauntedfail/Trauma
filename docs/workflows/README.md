# Trauma Execution Workflows

This directory contains task-scoped execution workflows. Each file is intended
to be read independently by a worker that owns one pull request.

Use this directory instead of a single large implementation plan. The goal is to
keep each worker's context focused on its own domain.

## Task Map

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 2.5 | [Coding standards refactor](task-02-5-coding-standards-refactor.md) | Standards audit, vulnerability cleanup, readability refactor | Ready after Task 2 merge |
| 3 | [Markdown store](task-03-markdown-store.md) | `CONTENT.md` writer/reader and frontmatter contract | Ready after Task 2.5 quality gate |
| 4 | [Importer and add memory](task-04-importer-add-memory.md) | URL extraction, link-only fallback, add memory server flow | Ready after Tasks 2.5 and 3 |
| 5 | [Browse shell and filters](task-05-browse-shell-filters.md) | `/memories`, shell layout, list/grid, query filters, right-panel shortcuts | Ready after Task 2.5 |
| 6 | [Reader pipeline](task-06-reader-pipeline.md) | `/memories/:id`, markdown render, sanitize, rich reader features | Ready after Tasks 3 and 5 |
| 7 | [Highlight system](task-07-highlight-system.md) | Selection UI, highlight persistence, `/highlights`, highlight-aware search | Ready after Tasks 2.5, 3, and 6 |
| 8 | [Git backup queue](task-08-git-backup-queue.md) | In-process queue, git commit/push, retry, backup status | Ready after Tasks 2.5, 3, 4, and 7 |
| 9 | [E2E integration hardening](task-09-e2e-integration-hardening.md) | Deterministic fixtures and full flow Playwright coverage | Final integration pass |

## Archived Workflows

| Order | Workflow | Domain | Status |
| --- | --- | --- | --- |
| 1 | [Project bootstrap](archive/task-01-project-bootstrap.md) | Toolchain, scaffold, baseline verification | Archived |
| 2 | [Config and persistence](archive/task-02-config-persistence.md) | Config loader, path validation, Drizzle schema, repositories | Archived |

## Worker Rules

- Own only the files listed in the workflow unless the PR description explains
  why a boundary change is required.
- Read the workflow file, its referenced docs, and
  [coding standards](../references/coding-standards.md) before coding.
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

## Branching

Use concise branch names that match the workflow:

- `chore/coding-standards-refactor`
- `feat/markdown-store`
- `feat/importer-add-memory`
- `feat/browse-shell`
- `feat/reader-pipeline`
- `feat/highlights`
- `feat/git-backup-queue`
- `test/e2e-hardening`
