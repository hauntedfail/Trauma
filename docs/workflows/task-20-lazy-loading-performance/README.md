# Task 20: Lazy Loading Performance Workflow

Implement these subtasks sequentially on `feat/lazy-loading`, which is derived
from `fix/perform`.

## Goal

Reduce perceived latency when opening `/memories`, opening reader pages, and
returning from memory extraction by moving expensive archive-wide work behind
server-side pagination and explicit lazy-loading boundaries.

## Architecture

The initial memories route must load a small page of memory summaries from
SQLite, not the entire archive and not every Flashback. Search, taxonomy,
read-state, and Flashback filters must remain global by moving their semantics
to the server query layer before infinite scroll is enabled. Global Flashback
lists must use dedicated lazy queries rather than piggybacking on the memories
payload.

## Required Context

- [Documentation index](../../INDEX.md)
- [Data and storage architecture](../../architecture/data-and-storage.md)
- [UI and routing architecture](../../architecture/ui-and-routing.md)
- [Runtime flows](../../architecture/flows.md)
- [Verification strategy](../../quality/verification.md)
- [SolidStart UI rules](../../references/coding-standards/solidstart-ui.md)
- [Drizzle and SQLite rules](../../references/coding-standards/drizzle-sqlite.md)
- [Testing and verification rules](../../references/coding-standards/testing-verification.md)

## Scope

In scope:

- Cursor-based server pagination for `/memories`.
- Server-side browse filtering that preserves existing query semantics.
- Infinite scroll for memory rows with deterministic fallback controls.
- Lazy Flashback loading for memory cards, shell shortcuts, and reader All tab.
- Focused revalidation so extraction success does not trigger archive-wide
  fetch work before reader navigation.
- Performance evidence recorded before handoff.

Out of scope for this branch:

- Markdown render caching.
- Extractor worker pooling.
- Backup integrity algorithm replacement.
- Visual redesign of the memories or reader routes.
- Changing the meaning of Flashback, Moment, category, tag, read, or
  translation variant state.

## Non-Negotiable Contracts

- Do not implement pagination as client-side slicing after loading every row.
- Do not use offset pagination. Use a stable cursor based on
  `createdAt desc, id desc`.
- Search must apply to the whole archive, not only the loaded pages.
- `?flashback=<id>` must find the owning memory even when that memory is not
  in the first page.
- Initial reader render must not fetch global Flashbacks while the Current tab
  is active.
- The `/flashbacks` route may keep its full-route behaviour until explicitly
  paginated, but shell and reader shortcuts must not depend on `/memories`
  loading all Flashbacks.
- Keep source and translated Flashback hrefs variant-aware.
- Keep backup failsafe safety checks intact; only move browse revalidation work
  out of the extraction hot path.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 20.1 | [Browse query and page contract](01-browse-query-and-page-contract.md) | M | Define shared query, cursor, and page response contracts before changing data access. |
| 20.2 | [SQLite repository pagination](02-sqlite-repository-pagination.md) | L | Add indexed cursor pagination and server-side filters at the repository boundary. |
| 20.3 | [Browse loader contract](03-browse-loader-contract.md) | M | Expose page-based server functions and scoped revalidation helpers. |
| 20.4 | [Memories infinite scroll UI](04-memories-infinite-scroll-ui.md) | L | Replace all-row rendering with page accumulation and intersection loading. |
| 20.5 | [Lazy Flashback browse data](05-lazy-flashback-browse-data.md) | L | Split Flashback shortcuts and card excerpts from the initial memory page. |
| 20.6 | [Reader lazy Flashback tab](06-reader-lazy-flashback-tab.md) | M | Defer global Flashbacks until the reader All tab is opened. |
| 20.7 | [Integration verification and handoff](07-integration-verification-and-handoff.md) | M | Validate behaviour, performance evidence, docs, and PR handoff. |

## Implementation Rules

- Implement all subtasks on the same branch, but keep commits grouped by the
  subtask boundaries above.
- Use TDD for repository, loader, search, and component state changes.
- Prefer repository/service functions over raw SQL in routes or components.
- Add a migration for any new SQLite index and bundle it through
  `src/server/db/bundled-migrations.ts`.
- Keep old public functions only as compatibility shims during the branch. By
  the final verification subtask, route code should use the page/lazy APIs.
- Preserve fixture mode with `TRAUMA_BROWSE_FIXTURES=1`.
- Preserve existing dirty or untracked local files that are unrelated to this
  branch.

## Verification Baseline

Each subtask lists focused commands. Before PR handoff, run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

Run E2E after the UI subtasks land:

```bash
mise exec -- bun run test:e2e
```

If full verification is blocked by unrelated local state, record the exact
blocker and still run the focused suites listed by each subtask.
