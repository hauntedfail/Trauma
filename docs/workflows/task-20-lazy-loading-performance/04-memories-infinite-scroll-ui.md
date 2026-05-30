# Task 20.4: Memories Infinite Scroll UI

## Goal

Change `/memories` from rendering one all-row array to accumulating server pages
with infinite scroll, while preserving current filters, read-state tabs, action
menus, and deletion behaviour.

## Ownership

Primary files:

- Modify `src/components/memories/MemoryBrowse.tsx`
- Modify `src/components/memories/AddMemoryForm.tsx`
- Modify `tests/components/memory-browse-actions.test.ts`
- Modify `tests/components/app-shell.test.ts`
- Modify `tests/e2e/**` when a memories route E2E exists or must be added.

Do not implement Flashback excerpt lazy loading in this subtask; memory cards
should render correctly without excerpts.

## UI State Contract

`MemoryBrowse` owns:

- loaded pages for the current `BrowseQuery`;
- the current `nextCursor`;
- `isLoadingNextPage`;
- `loadNextPageError`;
- removed memory IDs for optimistic deletion;
- a scroll sentinel observed after hydration.

When `q`, `category`, `tag`, `flashback`, or `view` changes, discard old pages
and request the first page for the new query.

## Behaviour

- Server filtering replaces `filterBrowseMemories()` in the route component.
- `filterBrowseMemories()` remains covered by tests for fixture and shared
  query semantics, but it must not be the production route filter after this
  subtask.
- The fallback empty state means no server results for the current query.
- Use a manual `Load more` button as a deterministic fallback when
  `IntersectionObserver` is unavailable or when the previous load failed.
- Deleting a memory removes it from all loaded pages and revalidates memory
  pages, taxonomy, Flashbacks, Moments, and reader data as before.
- Add-memory success should revalidate the first memory page and taxonomy
  without starting an archive-wide memory fetch before navigating to the
  reader.

## Implementation Steps

1. Add component/source tests proving:
   - `MemoryBrowse` imports `getBrowseMemoryPage`, not `getBrowseMemories`;
   - `MemoryBrowse` no longer calls `filterBrowseMemories()` for production
     route rendering;
   - query changes reset accumulated pages;
   - delete removes a memory from loaded page state;
   - `AddMemoryForm` uses first-page scoped revalidation after successful
     creation.

2. Add or update E2E coverage for:
   - first page renders memories;
   - search still finds a memory that is not part of the initial page fixture;
   - loading the next page appends rows without duplicating the first page;
   - read-state tabs still update the URL and results.

3. Implement page accumulation with Solid signals and memos. Keep effects pure;
   perform async loading from event handlers or lifecycle hooks.

4. Run:

```bash
mise exec -- bun run test tests/components/memory-browse-actions.test.ts tests/components/app-shell.test.ts
mise exec -- bun run test:e2e
```

5. Commit with:

```bash
git add src/components/memories/MemoryBrowse.tsx src/components/memories/AddMemoryForm.tsx tests/components/memory-browse-actions.test.ts tests/components/app-shell.test.ts tests/e2e
git commit -m "feat: add infinite scroll to memories"
```

## Acceptance Criteria

- `/memories` does not request all memories on initial load.
- Query changes produce server-filtered first pages.
- Infinite scroll appends deterministic cursor pages.
- Extraction success no longer kicks off the old all-memory browse query.
