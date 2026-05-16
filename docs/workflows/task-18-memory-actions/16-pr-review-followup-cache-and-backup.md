# 18.16 PR review follow-up: cache, Flashback backup, and stale anchors

## Goal

Turn the actionable Task 18 implementation PR review comments into implementation work after the
Task 18 product-language migration.

This is a correction subtask. It does not reopen Task 19 and does not change the
desktop design work from Task 17.

## Review sweep

Source:

- Pull request: `https://github.com/hauntedfail/Trauma/pull/21`
- Head branch: `feat/task-18-memory-actions`
- Base branch: `workflow18-read-status`
- Thread-aware review read: 16 review threads, no pagination.

Vocabulary normalization:

- Review comments that say `highlight` now mean Task 18 `Flashback`.
- Review comments that say section-bookmark `Flashback` now mean Task 18
  `Moment`.
- Old wording does not invalidate backend findings when the data-flow issue
  still exists.

Non-actionable review items:

- CodeRabbit skipped automatic review because the base branch is not the
  default branch. This is not an implementation issue.
- The top-level Codex review item about refreshing highlight lists after
  successful toggles is covered by the Flashback revalidation tasks below.

## Review thread ledger

All actionable Task 18 implementation PR review threads are mapped below.
Outdated line anchors are still evaluated when the backend or cache issue
remains true after the product-language migration.

| Review thread | Current product term | Disposition |
| --- | --- | --- |
| Keep highlight changes in backed-up markdown | Keep Flashback changes durable outside SQLite | Covered by domain C. Do not rewrite `CONTENT.md`; use `FLASHBACKS.json` durability. |
| Back up memory deletions before dropping the record | Memory deletion backup | Covered by domain F and 18.15. |
| Revalidate cached browse data after reader deletes | Reader delete cache coherence | Covered by domain A. |
| Resolve stale Flashback anchors before linking | Resolve stale Moment anchors before linking | Covered by domain E. |
| Revalidate browse data after card taxonomy actions | Card taxonomy cache coherence | Covered by domain A. |
| Revalidate browse cache after card deletes | Browse delete cache coherence | Covered by domain A. |
| Ignore stale highlight ranges when rendering | Ignore stale Flashback ranges when rendering | Covered by domain D. |
| Revalidate cached memories after read toggles | Read status cache coherence | Covered by domain A. |
| Revalidate browse data after reader category adds | Reader taxonomy cache coherence | Covered by domain A. |
| Refresh reader highlight tabs after toggles | Refresh reader Flashback tabs after toggles | Covered by domains A and B. |
| Revalidate deleted reader entries | Reader delete cache invalidation | Covered by domain A. |
| Reset reader-local state on memory changes | Reader state reset | Covered by domain B. |
| Persist highlights only after export succeeds | Persist Flashbacks only after export succeeds | Covered by domain C. |
| Mark highlight backups queued before returning | Mark Flashback backups queued before returning | Covered by domain C. |
| Include highlight exports in deletion backups | Include Flashback exports in deletion backups | Covered by domain F and 18.15. |
| Retry failed highlight backups with the export path | Retry failed Flashback backups with the export path | Covered by domain C. |

## Required review threads by domain

### A. Mutation cache revalidation

Review findings covered:

- Revalidate browse data after reader deletes.
- Revalidate browse cache after card deletes.
- Revalidate cached reader entry after reader deletes.
- Revalidate cached memories after read toggles.
- Revalidate browse data after card taxonomy actions.
- Revalidate browse data after reader category adds.
- Refresh Flashback lists after successful Flashback toggles.

Files:

- `src/components/memories/browse-loader.ts`
- `src/components/flashbacks/flashbacks-loader.ts`
- `src/components/moments/moments-loader.ts`
- `src/components/reader/reader-memory-loader.ts`
- `src/routes/memories/[id].tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/components/memories/MemoryReadStatusControl.tsx`
- `src/components/reader/MemoryReader.tsx`
- `tests/components/memory-browse-actions.test.ts`
- `tests/components/memory-read-status.test.ts`
- `tests/components/memory-reader-actions.test.ts`
- `tests/components/memory-reader-flashback-selection.test.ts`

Implementation plan:

1. Move the reader query out of the route file into a reusable loader:

```ts
// src/components/reader/reader-memory-loader.ts
import { query, revalidate } from "@solidjs/router";

import { loadReaderMemory } from "~/server/reader/page-data";

export const getReaderMemory = query(async (memoryId: string) => {
  "use server";

  return loadReaderMemory(memoryId);
}, "reader-memory");

export function revalidateReaderMemory(memoryId?: string) {
  return revalidate(
    memoryId === undefined ? getReaderMemory.key : getReaderMemory.keyFor(memoryId),
  );
}
```

2. Update `src/routes/memories/[id].tsx` to import `getReaderMemory` from the
   new loader and remove the inline query.

3. Add a Flashback browse revalidation helper:

```ts
// src/components/flashbacks/flashbacks-loader.ts
import { query, revalidate } from "@solidjs/router";

export function revalidateFlashbackBrowseRows() {
  return revalidate(getFlashbackBrowseRows.key);
}
```

4. Add a shared client helper that revalidates all browse-side data affected by
   Task 18 mutations:

```ts
// src/components/memories/browse-loader.ts
export function revalidateBrowseMemoryWorkspace() {
  return Promise.all([
    revalidateBrowseMemories(),
    revalidateBrowseTaxonomy(),
  ]);
}
```

5. After read/unread success, revalidate browse memory data and the active
   reader cache for the memory id.

6. After card tag/category attach success, revalidate browse memories and
   taxonomy.

7. After card delete success, revalidate browse memories, taxonomy, Flashback
   browse rows, Moment browse rows, and the deleted reader cache key.

8. After reader delete success, revalidate the same affected caches before
   navigating to `/memories`.

9. After reader category attach success, revalidate browse memories, taxonomy,
   and reader memory for the current id.

10. After Flashback toggle success, parse the successful API response, update
    the reader-local current Flashbacks list, and revalidate:

```ts
void revalidateFlashbackBrowseRows();
void revalidateReaderMemory(input.memoryId);
void revalidateBrowseMemories();
```

Acceptance criteria:

- A deleted memory cannot reappear after navigation back from `/memories`.
- A deleted reader page does not render from cached `reader-memory` when the
  browser back button is used.
- Read/unread state remains correct after returning to `/memories`.
- Newly attached tags/categories update right-rail counts and filters without a
  hard refresh.
- Flashback `Current` and `All` lists update after a successful toggle.

### B. Reader-local state reset on memory changes

Review finding covered:

- Reset reader-local state on memory changes.

Files:

- `src/components/reader/MemoryReader.tsx`
- `tests/components/memory-reader-actions.test.ts`

Implementation plan:

1. Add a `currentFlashbacks` signal initialized from
   `props.result.memory.flashbacks`.
2. Use `currentFlashbacks()` in `ReaderRightRailContent` instead of
   `props.result.memory.flashbacks`.
3. Add a prop-change effect keyed by `props.result.memory.id`.
4. When the memory id changes, reset reader-local state:

```ts
setCategories([...props.result.memory.categories]);
setMoments([...props.result.memory.moments]);
setCurrentFlashbacks([...props.result.memory.flashbacks]);
setPendingMomentKey("");
setPendingSelectionKey("");
setErrorMessage("");
closeReaderMenus();
```

5. Keep cleanup of right-rail content on component unmount.

Acceptance criteria:

- Direct client navigation from one reader memory to another does not inherit
  category chips, Moment state, Flashback tabs, pending states, or errors from
  the previous memory.

### C. Flashback persistence, export, and backup ordering

Review findings covered:

- Keep Flashback changes durable outside SQLite.
- Persist Flashbacks only after export succeeds.
- Mark Flashback backups queued before returning.
- Retry failed Flashback backups with the export path.

Files:

- `src/server/flashbacks/toggle.ts`
- `src/server/flashbacks/export.ts`
- `src/server/backup/index.ts`
- `src/server/db/repositories.ts`
- `tests/server/flashbacks/toggle.test.ts`
- `tests/server/backup/git-backup.test.ts`

Implementation plan:

1. Preserve the Task 18 decision that `CONTENT.md` is not rewritten for
   Flashbacks. The durable backup artifact for Flashbacks is
   `memories/{memoryId}/FLASHBACKS.json`.

2. Capture the previous Flashback DB rows and previous export file state before
   replacement.

3. Replace Flashback rows only as part of a service operation that can
   compensate on export or enqueue failure.

4. Write `FLASHBACKS.json` atomically. The export writer should write a temp file
   under the same memory directory and rename it to `FLASHBACKS.json`.

5. If export write fails after DB replacement, restore the previous Flashback DB
   rows before returning an API failure.

6. If backup enqueue fails after DB replacement/export write, restore the
   previous Flashback DB rows and previous export file before returning an API
   failure.

7. If backup is enabled and enqueue returns `queued`, update the owning memory's
   `backup_status` to `queued` before the API returns. Clear stale
   `last_backup_error`.

8. If backup is disabled, keep the memory backup status `disabled`.

9. Update backup retry logic so retrying pending/queued/failed memories enqueues
   both the memory content path and the Flashback export path:

```ts
contentPaths: [
  backup.contentPath,
  getFlashbackMetadataExportPath(backup.id),
]
```

The runner already tolerates paths with no staged diff after `git add`; this
keeps content and Flashback export retry behaviour aligned.

Acceptance criteria:

- A Flashback API failure after export/enqueue failure does not leave SQLite in
  the new state.
- A successful Flashback toggle leaves SQLite, `FLASHBACKS.json`, and memory
  backup status in one consistent state.
- Startup retry for a failed Flashback backup stages `FLASHBACKS.json`, not only
  `CONTENT.md`.
- Tests cover backup enabled, backup disabled, export failure, enqueue failure,
  and retry.

### D. Flashback stale range tolerance in reader rendering

Review finding covered:

- Ignore stale Flashback ranges when rendering.

Files:

- `src/server/reader/page-data.ts`
- `src/server/flashbacks/toggle.ts`
- `src/server/store/flashback-markers.ts`
- `tests/server/reader/page-data.test.ts`
- `tests/server/flashbacks/flashback-markers.test.ts`

Implementation plan:

1. Treat `FlashbackMarkerError` from applying saved Flashback records as stale
   Flashback metadata, not as a reader-route crash.

2. Prefer filtering invalid Flashback records over dropping all records:

```ts
const renderResult = renderMarkdownWithValidFlashbacks(content.markdown, memory.flashbacks);
```

The helper should return:

```ts
{
  markdown: string;
  staleFlashbackIds: string[];
}
```

3. If focused filtering is too invasive, catch `FlashbackMarkerError` in
   `loadReaderMemory`, render clean markdown with no Flashback marks, and keep
   the route available. This is acceptable as an intermediate implementation
   only if tests prove the route no longer crashes.

4. Do not guess new offsets for stale Flashbacks.

Acceptance criteria:

- Out-of-bounds or protected-range Flashback records do not crash
  `/memories/:id`.
- The reader opens the memory content without invalid marks.
- Stale Flashback metadata remains available for later cleanup/export work
  unless explicitly deleted by user action.

### E. Moment stale anchor resolution

Review finding covered:

- Resolve stale section-bookmark anchors before linking.

Vocabulary mapping:

- Old review term `Flashback` in this thread refers to current Task 18 `Moment`.

Files:

- `src/server/moments/browse.ts`
- `src/server/db/repositories.ts`
- `src/components/moments/MomentBrowse.tsx`
- `src/components/reader/MemoryReader.tsx`
- `tests/server/browse-loaders.test.ts`
- `tests/components/moment-route.test.ts`
- `tests/components/reader-moment-actions.test.ts`

Implementation plan:

1. Add Moment target resolution against the current reader ToC.

2. Resolution order:

```text
stored sectionAnchor exact match
  -> unique current sectionPath match
  -> stale unresolved Moment
```

3. Extend Moment browse rows with:

```ts
targetAnchor: string | null;
targetStatus: "current" | "resolved_from_path" | "stale";
```

4. Build hrefs with `targetAnchor`, not always the stored `sectionAnchor`.

5. If `targetStatus` is `stale`, render the Moment row as non-blocking stale
   state and avoid a dead fragment link.

6. Do not silently mutate the stored Moment row while browsing. If automatic
   repair is desired later, add a separate explicit repair workflow.

Acceptance criteria:

- A Moment whose heading id changed but section path is still unique links to
  the current anchor.
- A Moment whose section cannot be resolved does not link to a dead fragment.
- Reader-side Moment active state uses the resolved target where available.

### F. Delete backup coverage from PR review

Review findings covered:

- Back up memory deletions before dropping the record.
- Include Flashback exports in deletion backups.

Owning plan:

- Execute the detailed delete plan in
  `docs/workflows/task-18-memory-actions/15-memory-delete-consistency-and-backup-hardening.md`.

Additional requirement from this review sweep:

- Deletion backup must include `FLASHBACKS.json` in addition to `CONTENT.md`, or
  stage every tracked path under the deleted memory directory.

## Verification

Targeted test command:

```sh
mise exec -- bun --bun x vitest run tests/server/routes/api-memory-delete.test.ts tests/server/memories/delete-memory.test.ts tests/server/flashbacks/toggle.test.ts tests/server/backup/git-backup.test.ts tests/server/reader/page-data.test.ts tests/server/browse-loaders.test.ts tests/components/memory-browse-actions.test.ts tests/components/memory-read-status.test.ts tests/components/memory-reader-actions.test.ts tests/components/memory-reader-flashback-selection.test.ts tests/components/reader-moment-actions.test.ts tests/components/moment-route.test.ts
```

Full verification before handoff:

```sh
mise exec -- bun run typecheck
mise exec -- bun run verify
```

Manual smoke:

1. Toggle read/unread on `/memories`, navigate away/back, and confirm state
   stays current.
2. Attach tag/category from a memory card and confirm right rail updates.
3. Attach category from reader and confirm `/memories` reflects it.
4. Create and remove a Flashback; confirm reader body, `Current`, and `All`
   Flashback lists update.
5. Delete from reader, navigate back with browser history, and confirm deleted
   content does not reappear.
6. Edit or simulate stale Flashback offsets and confirm reader does not crash.
7. Edit or simulate stale Moment anchors and confirm Moment list avoids dead
   fragments.
8. Delete a memory with `CONTENT.md` and `FLASHBACKS.json` tracked by backup and
   confirm both deletions are staged/committed.

## Acceptance criteria

- Every actionable Task 18 implementation PR review thread is either implemented
  by this subtask or explicitly delegated to 18.15.
- Current product language is used in new code and docs.
- No implementation writes Flashback marks into `CONTENT.md`.
- Flashback durability is provided through SQLite plus `FLASHBACKS.json` backup.
- Cache revalidation keeps browse, reader, right rail, Flashback, Moment, and
  taxonomy views coherent after Task 18 mutations.
