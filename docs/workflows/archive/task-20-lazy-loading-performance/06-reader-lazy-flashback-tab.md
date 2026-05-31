# Task 20.6: Reader Lazy Flashback Tab

## Goal

Prevent reader pages from fetching global Flashbacks until the user opens the
All tab in the reader right rail.

## Ownership

Primary files:

- Modify `src/components/reader/MemoryReader.tsx`
- Modify `tests/components/reader-flashback-tabs.test.ts`
- Modify `tests/components/reader-memory-loader.test.ts`
- Modify `tests/components/memory-reader-actions.test.ts`
- Modify `tests/components/memory-reader-flashback-selection.test.ts`

Do not change `loadReaderMemory()` in this subtask unless a type boundary
requires it.

## Behaviour

- `ReadyMemoryReader` must not create a global `getFlashbackBrowseRows()`
  resource during initial render.
- `ReaderFlashbackTabs` keeps Current as the default active tab.
- Opening All for the first time starts the global Flashback query.
- Returning to Current does not discard already loaded All-tab rows.
- If `initialTab: "all"` is provided in tests or future route state, the All
  query can start immediately.
- The All tab loading state remains visible while rows are unresolved.
- Flashback toggle revalidation still invalidates:
  - the reader memory query;
  - the global Flashback query;
  - browse memory page caches.

## Implementation Steps

1. Add tests proving:
   - render with the default Current tab does not call the global Flashback
     query;
   - rendering with `initialTab: "all"` shows the loading state when rows are
     unavailable;
   - the All tab still builds source and translated memory hrefs with
     `buildMemoryVariantAnchorHref`;
   - the Current tab still uses `buildSameMemoryAnchorHref`;
   - source text no longer contains `createAsync(() => getFlashbackBrowseRows())`
     inside `ReadyMemoryReader`.

2. Move global Flashback query ownership into `ReaderFlashbackTabs` or a small
   child component. Gate the query behind a signal such as `shouldLoadAll`.

3. Keep `flashbackRows` as an optional test/fixture override so existing
   render-to-string tests can provide rows directly.

4. Run:

```bash
mise exec -- bun run test tests/components/reader-flashback-tabs.test.ts tests/components/reader-memory-loader.test.ts tests/components/memory-reader-actions.test.ts tests/components/memory-reader-flashback-selection.test.ts
```

5. Commit with:

```bash
git add src/components/reader/MemoryReader.tsx tests/components/reader-flashback-tabs.test.ts tests/components/reader-memory-loader.test.ts tests/components/memory-reader-actions.test.ts tests/components/memory-reader-flashback-selection.test.ts
git commit -m "feat: lazy load reader all flashbacks"
```

## Acceptance Criteria

- Opening a reader page with the default Current tab does not request global
  Flashbacks.
- Opening All still exposes every renderable Flashback across memories.
- Current-memory Flashbacks remain available from `loadReaderMemory()`.
