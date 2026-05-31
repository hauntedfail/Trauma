# Task 20.5: Lazy Flashback Browse Data

## Goal

Split Flashback data from memory page loading so shell shortcuts and memory-card
excerpts can be fetched only when that surface needs them.

## Ownership

Primary files:

- Modify `src/server/db/repositories.ts`
- Modify `src/server/flashbacks/browse.ts`
- Modify `src/components/flashbacks/flashbacks-loader.ts`
- Modify `src/components/shell/AppShell.tsx`
- Modify `src/components/memories/MemoryBrowse.tsx`
- Modify `src/components/memories/browse-data.ts`
- Modify `tests/server/flashbacks/repository.test.ts`
- Modify `tests/server/browse-loaders.test.ts`
- Modify `tests/components/flashbacks-loader.test.ts`
- Modify `tests/components/app-shell.test.ts`
- Modify `tests/memories/browse-data.test.ts`

## Data Contracts

Add dedicated loaders:

- `loadRecentFlashbackBrowseRows({ limit }: { limit: number }): Promise<FlashbackBrowseRow[]>`
- `loadBrowseFlashbacksForMemories(input: { memoryIds: string[]; selectedFlashbackId: string }): Promise<Record<string, BrowseFlashback[]>>`
- `getRecentFlashbackBrowseRows(limit: number)`
- `getBrowseFlashbacksForMemories(input: { memoryIds: string[]; selectedFlashbackId: string })`

Repository support:

- recent Flashback candidates ordered by `flashbacks.createdAt desc`;
- Flashbacks for a bounded list of memory IDs;
- a direct lookup for `selectedFlashbackId` so `?flashback=<id>` can show the
  selected excerpt even when the page has only one matching memory.

## Behaviour

- `AppShell` must not derive recent Flashbacks from `getBrowseMemories()` or
  memory pages.
- Memory cards render without a Flashback excerpt until their page's Flashback
  batch is loaded.
- For ordinary browse pages, fetch Flashbacks for only the currently loaded page
  of memory IDs.
- For `?flashback=<id>`, ensure the selected Flashback is present for the
  matching memory card.
- Renderability validation still runs for Flashback rows, but only for the
  bounded candidate rows requested by the lazy loader.
- Existing `/flashbacks` route can continue using `loadFlashbackBrowseRows()`.

## Implementation Steps

1. Add repository tests proving:
   - recent candidates are ordered by Flashback creation time;
   - bounded memory-ID lookup returns only requested memories;
   - selected Flashback lookup works across source and translated variants.

2. Add loader tests proving:
   - recent shortcut loader filters stale translated Flashbacks;
   - memory-card Flashback loader returns a record keyed by memory ID;
   - empty memory ID input returns an empty record without opening content
     files.

3. Update `AppShell` to call the recent Flashback query lazily for the right
   rail. It should keep taxonomy and backup alert loading unchanged.

4. Update `MemoryBrowse` to request Flashbacks for loaded page memory IDs after
   memory rows render. Pass the loaded Flashbacks into `MemoryItem`.

5. Update browse-data helpers so `getMemoryDisplayFlashback()` operates on the
   memory row plus the lazily loaded Flashback list.

6. Run:

```bash
mise exec -- bun run test tests/server/flashbacks/repository.test.ts tests/server/browse-loaders.test.ts tests/components/flashbacks-loader.test.ts tests/components/app-shell.test.ts tests/memories/browse-data.test.ts
```

7. Commit with:

```bash
git add src/server/db/repositories.ts src/server/flashbacks/browse.ts src/components/flashbacks/flashbacks-loader.ts src/components/shell/AppShell.tsx src/components/memories/MemoryBrowse.tsx src/components/memories/browse-data.ts tests/server/flashbacks/repository.test.ts tests/server/browse-loaders.test.ts tests/components/flashbacks-loader.test.ts tests/components/app-shell.test.ts tests/memories/browse-data.test.ts
git commit -m "feat: lazy load browse flashbacks"
```

## Acceptance Criteria

- Initial memory page data contains no nested Flashbacks.
- Shell recent Flashbacks use their own bounded query.
- Memory-card Flashback excerpts are hydrated per loaded page, not archive-wide.
- Flashback filter deep links still show the matching memory and selected
  excerpt.
