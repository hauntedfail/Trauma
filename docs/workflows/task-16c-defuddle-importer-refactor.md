# Task 16c: Defuddle Importer Extraction Refactor Workflow

## Goal

Replace Trauma's custom URL import main-content extraction with Defuddle v0.18
or higher while preserving the existing add-memory storage contract, Markdown
safety boundary, link-only fallback behavior, and reader compatibility.

## Parent Workflow

This is a triage subtask of [Task 16](task-16-red-call-runtime-triage.md).
Task 16 owns runtime/env recovery. This workflow owns importer extraction
quality and the Defuddle dependency boundary.

Current status: this workflow has landed on `main`. Keep this file as the
Defuddle importer execution record; create a new workflow for follow-up import
behaviour changes.

## Research Basis

- [URL import extraction research](../research/2026-05-12-url-import-content-extraction-markdown-generation.md)
- Context7 library docs for `/kepano/defuddle`
- [Defuddle GitHub README](https://github.com/kepano/defuddle)
- [Defuddle package overview](https://socket.dev/npm/package/defuddle)

Defuddle documentation confirms the Node path uses `defuddle/node` with a DOM
`Document` supplied by a DOM implementation such as `linkedom` or `jsdom`.
Defuddle can return Markdown content with `{ markdown: true }`, but this
workflow treats that Markdown as untrusted extractor output. Trauma should use
Defuddle for article extraction and metadata, then persist Markdown through the
project-owned Markdown serialization boundary unless a separate safety review
accepts direct Defuddle Markdown persistence.

## Required Context

- [Runtime flows](../architecture/flows.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [Security boundaries](../references/coding-standards/security-boundaries.md)
- [Technology stack](../references/technology-stack.md)
- [Task 16 runtime triage](task-16-red-call-runtime-triage.md)

## Ownership

Primary files:

- `package.json`
- `bun.lock`
- `src/server/importer/**`
- `tests/server/importer/**`
- `tests/server/memories/add-memory.test.ts`

Conditional files:

- `docs/references/technology-stack.md` if new dependencies need to be recorded.
- `docs/references/coding-standards/security-boundaries.md` if the implementation
  creates a reusable importer safety rule not already documented.
- `docs/quality/verification.md` only if a new required verification command is
  introduced.

Out of scope:

- Reader renderer decomposition. Task 13 and Task 14 own reader pipeline work.
- Add memory UI redesign.
- Database schema redesign.
- Backup queue behavior except ensuring existing enqueue semantics still pass.
- Browser extension or Safari reader-mode assisted import.

## Defuddle Version Gate

Implementation must use `defuddle` v0.18 or higher. Do not silently downgrade to
an earlier package version. If `defuddle@^0.18.0` is not available from the
package registry when implementation starts, stop the task and record the
dependency availability blocker in the PR or workflow notes.

Preferred DOM implementation is `linkedom` because the project is intentionally
lightweight. Use `jsdom` only if Defuddle v0.18+ behavior or tests show
`linkedom` is insufficient.

## Parent Exec Plan

Execute the domain plans in order. Each domain plan is intentionally scoped so a
worker can hold the relevant files in context without reading one oversized
implementation document.

1. [Dependency and runtime boundary](task-16c-defuddle-importer-refactor/01-dependency-runtime-boundary.md)
2. [Extraction adapter](task-16c-defuddle-importer-refactor/02-extraction-adapter.md)
3. [Importer integration and fallback contract](task-16c-defuddle-importer-refactor/03-importer-integration-and-fallback.md)
4. [Regression fixtures and test health](task-16c-defuddle-importer-refactor/04-regression-fixtures-and-test-health.md)
5. [Documentation, verification, and PR handoff](task-16c-defuddle-importer-refactor/05-docs-verification-handoff.md)

## Impact Summary

Direct implementation impact:

- Current extraction helpers inside `src/server/importer/index.ts` should be
  removed or moved behind a legacy test fixture only if needed for comparison.
- Fetch, redirect validation, timeout, max-byte, and public-host SSRF protections
  remain in the importer fetch boundary.
- Defuddle must parse already-fetched bounded HTML. It must not introduce a new
  network path that bypasses `normalizeImportUrl()`, pinned public-host fetch, or
  redirect validation.
- Persisted Markdown remains `{storePath}/memories/{memoryId}/CONTENT.md`.
- SQLite continues to store metadata only, not the Markdown body.

Secondary impact to check:

- Defuddle output may change content selection, metadata, link, image, table,
  code block, footnote, highlight, or raw HTML shapes. Importer and reader tests
  must prove the saved Markdown still renders safely.
- Defuddle result metadata may improve `title`, `description`, `favicon`, `site`,
  `author`, `published`, `image`, and `language`, but the initial PR should map
  only fields already represented by Trauma unless a separate storage design is
  added.
- Link-only fallback should remain resilient when Defuddle returns blank content,
  throws, or produces content below the readable-body threshold.
- Dependency changes can affect install time and CI cache behavior.

## Acceptance Criteria

- `defuddle@^0.18.0` or higher is installed and locked.
- A DOM implementation is installed and justified.
- URL import uses Defuddle for main content extraction and metadata.
- Persisted Markdown is generated through a project-owned serialization boundary
  that escapes text-node Markdown and filters unsafe display URLs.
- Existing URL fetch, redirect, timeout, response-size, and public-host guards
  remain in place.
- Defuddle async/third-party fallback is disabled unless a separate threat model
  is written and accepted.
- Existing add-memory success and link-only fallback behavior still works.
- `CONTENT.md` frontmatter contract remains unchanged.
- Reader route can render newly generated Markdown without unsafe HTML or URL
  behavior.
- Unit tests cover Defuddle success, blank extraction fallback, thrown extraction
  fallback, unsafe URL handling, and representative article fixtures.
- `bun run verify` passes.

## Verification Commands

Run from the implementation branch:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/importer/importer.test.ts
mise exec -- bun run test tests/server/memories/add-memory.test.ts
mise exec -- bun run test tests/server/reader/markdown-renderer.test.ts
mise exec -- bun run verify
```

Run E2E only after the runtime branch can start the app reliably:

```bash
mise exec -- bun run test:e2e
```

## Branching And PR Flow

Historical branch flow for this merged task:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage-defuddle-importer
```

The PR targeted the active triage branch at the time. New follow-up work should
branch from the current target branch and use a fresh branch name.

## PR Handoff

The PR description must include:

- Defuddle and DOM implementation versions.
- Confirmation that Defuddle does not bypass the importer fetch/SSRF boundary.
- Markdown output differences observed in fixtures.
- Link-only fallback cases covered by tests.
- Exact verification commands and outcomes.
