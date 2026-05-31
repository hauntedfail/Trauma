# Task 20.7: Integration Verification and Handoff

## Goal

Prove that the lazy-loading branch improves the intended access paths without
breaking browse, reader, Flashback, extraction, or backup safety behaviour.

## Ownership

Primary files:

- Modify `docs/workflows/README.md` if task status or notes changed during
  implementation.
- Modify durable architecture or reference docs only if implementation changes
  a lasting contract.
- Do not add product code in this subtask except small fixes required by failed
  verification.

## Required Behaviour Checks

Manual or automated checks must cover:

- `/memories` initial route loads a bounded first page.
- Infinite scroll appends a second page without duplicates.
- `/memories?q=<term>` searches the full archive, not only loaded rows.
- `/memories?flashback=<id>` opens the memory that owns the Flashback and shows
  the selected excerpt after lazy hydration.
- Right-rail recent Flashbacks render without forcing all memories to load.
- Reader default Current tab does not fetch global Flashbacks.
- Reader All tab fetches global Flashbacks on demand.
- Add-memory success navigates to the reader without starting the old all-memory
  browse query.
- Backup failsafe alerts still surface when configured tests simulate backup
  drift or inconsistency.

## Performance Evidence

Record before/after timings in the PR body for the same local data set:

- `loadBrowseMemoryPage()` first page.
- `loadBrowseFlashbacksForMemories()` for one page of memory IDs.
- `loadRecentFlashbackBrowseRows({ limit: 5 })`.
- `loadReaderMemory()` for a large memory source page.
- Reader default render path with Current tab.
- Reader All-tab Flashback query.
- Add-memory API success path through navigation-triggered revalidation.

Use the same measurement harness shape as the earlier `fix/perform` inspection:
run loaders directly under `mise exec -- bun`, use the configured local
`trauma.config.json`, and keep browser-trace claims separate from loader
timings.

## Verification Commands

Run focused suites first:

```bash
mise exec -- bun run test tests/memories/browse-data.test.ts tests/components/browse-data-query.test.ts
mise exec -- bun run test tests/server/db/schema.test.ts tests/server/db/repositories.test.ts
mise exec -- bun run test tests/server/memories/browse.test.ts tests/server/browse-loaders.test.ts tests/server/flashbacks/repository.test.ts
mise exec -- bun run test tests/components/browse-loader.test.ts tests/components/flashbacks-loader.test.ts tests/components/app-shell.test.ts tests/components/memory-browse-actions.test.ts tests/components/reader-flashback-tabs.test.ts
```

Then run the broad checks:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
mise exec -- bun run test:e2e
```

## PR Handoff

The PR description must include:

- Subtask checklist and commit mapping.
- Exact verification commands and outcomes.
- Performance timing table.
- Any known blocker from unrelated local dirty state.
- Confirmation that no unrelated files from `.sawyer/exclude-whitelist.txt`
  were staged.
- Confirmation that backup failsafe behaviour was not weakened.

## Acceptance Criteria

- The branch implements the workflow without unrelated visual redesign.
- Initial memory and reader paths no longer perform archive-wide Flashback work.
- Search and deep links remain semantically global.
- Verification results and performance evidence are reproducible from the PR
  description.
