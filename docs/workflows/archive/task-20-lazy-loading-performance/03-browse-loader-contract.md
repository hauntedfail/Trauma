# Task 20.3: Browse Loader Contract

## Goal

Expose page-based SolidStart server functions and revalidation helpers so UI
work can switch from all-row loading to page loading without mixing database
details into components.

## Ownership

Primary files:

- Modify `src/server/memories/browse.ts`
- Modify `src/components/memories/browse-loader.ts`
- Modify `tests/server/memories/browse.test.ts`
- Modify `tests/components/browse-loader.test.ts`
- Modify `tests/server/browse-loaders.test.ts`

Do not change visual UI in this subtask.

## Loader Contract

Add:

- `loadBrowseMemoryPage(request: BrowseMemoryPageRequest, options?: LoadBrowseMemoriesOptions): Promise<BrowseMemoryPage>`
- `getBrowseMemoryPage = query(async (request: BrowseMemoryPageRequest) => ...)`
- `revalidateBrowseMemoryPages()`
- `revalidateBrowseMemoryFirstPage()`

Keep `getBrowseMemories()` and `loadBrowseMemories()` only as compatibility
helpers until Task 20.4 removes route usage.

## Behaviour

- Fixture mode returns a deterministic page slice after applying the same
  `filterBrowseMemories()` semantics used today.
- Non-fixture mode:
  - loads runtime config;
  - starts the backup retry queue once for the page load;
  - initializes SQLite;
  - converts `BrowseQuery` into repository filter input;
  - maps repository rows to `BrowseMemory` with `flashbacks: []`;
  - returns `nextCursor` from the repository.
- The loader must not call `filterBrowseMemoryFlashbacks()` for page rows.
- The loader must not call `filterRenderableFlashbackRows()` for page rows.

## Implementation Steps

1. Add tests proving `loadBrowseMemoryPage()`:
   - surfaces missing config errors;
   - starts the backup retry queue;
   - returns `nextCursor` for fixture and SQLite-backed data;
   - returns rows without Flashbacks on the initial memory page;
   - applies fielded search and explicit Flashback filters before pagination.

2. Add loader tests proving:
   - `getBrowseMemoryPage.key` is used for page query invalidation;
   - `revalidateBrowseMemoryWorkspace()` revalidates memory pages and taxonomy;
   - `revalidateBrowseMemoryFirstPage()` exists for extraction success.

3. Implement the page loader and query wrapper.

4. Run:

```bash
mise exec -- bun run test tests/server/memories/browse.test.ts tests/components/browse-loader.test.ts tests/server/browse-loaders.test.ts
```

5. Commit with:

```bash
git add src/server/memories/browse.ts src/components/memories/browse-loader.ts tests/server/memories/browse.test.ts tests/components/browse-loader.test.ts tests/server/browse-loaders.test.ts
git commit -m "feat: expose memory browse page loader"
```

## Acceptance Criteria

- The route layer can request the first page and subsequent pages without
  knowing repository internals.
- Initial page rows carry no Flashback excerpts.
- Compatibility functions remain available until the component migration lands.
