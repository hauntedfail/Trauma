# Task 17.4: Memory Browse And Highlight Surfaces

## Goal

Recreate the sample memory timeline and highlight excerpt surfaces with real
TRAUMA browse data, query filters, and `/highlights` rows.

## Ownership

Primary files:

- `src/components/memories/MemoryBrowse.tsx`
- `src/routes/highlights/index.tsx`
- `src/components/memories/browse-data.ts`
- `src/components/memories/browse-fixtures.ts`
- `tests/memories/browse-data.test.ts`
- `e2e/browse-shell.spec.ts`

Conditional files:

- `src/components/memories/MemoryRow.tsx` if `MemoryBrowse.tsx` becomes too
  large after porting the sample row.
- `src/components/highlights/HighlightExcerpt.tsx` if the same excerpt markup is
  needed by browse and `/highlights`.

## Source Mapping

- Sample `MemoryIndex` maps to `MemoryBrowse`.
- Sample `MemoryRow` maps to a focused row component or a local child component
  in `MemoryBrowse`.
- Sample `memory-row__hl` maps to reusable highlight excerpt styling.
- Sample `MemoryDetail` is not implemented here; reader route owns memory
  detail rendering.

## Decisions To Preserve

- Search stays URL-backed through the existing `q` query.
- List/grid view stays URL-backed through the existing `view` query.
- Category, tag, and highlight filters keep using current browse query helpers.
- Add memory remains the existing `AddMemoryForm` path and must not be replaced
  with mock sample behaviour.
- Highlight text participates in memory search.

## Execution Steps

1. Extract repeated class strings where it reduces component noise.

   Acceptable local constants:

   - pane frame
   - pane header
   - search pill
   - memory row
   - tag chip
   - highlight quote

   Do not create broad global CSS selectors for these classes.

2. Rework `MemoryBrowse` to match the sample hierarchy.

   Required structure:

   - sticky pane header with eyebrow and title
   - search pill with search icon and `Search memories` accessible name
   - stable list/grid segmented control
   - timeline-like memory rows
   - visible URL, description, category chips, tag chips, and saved state
   - highlight quote block when a display highlight exists
   - empty state for no matches

3. Keep route behaviour unchanged.

   Required URL behaviours:

   - typing search updates `q`
   - list/grid updates `view`
   - active category can be toggled off without clearing `q` or `view`
   - highlight shortcut navigates to `/memories?highlight=<id>`

4. Rework `/highlights`.

   Required structure:

   - pane header with `Highlights`
   - each row shows source memory title
   - each row links to `/memories/:id#highlightId`
   - quote block shows prefix, marked text, and suffix
   - empty state for no highlights

5. Keep fixture data representative.

   `browse-fixtures.ts` should retain:

   - at least one category filter
   - at least one tag filter
   - at least one highlight filter
   - one memory without highlights
   - enough rows to exercise list and grid density

6. Run focused verification:

   ```bash
   mise exec -- bun run test tests/memories/browse-data.test.ts tests/components/highlights-route-state.test.ts
   mise exec -- bun run test:e2e -- e2e/browse-shell.spec.ts
   ```

## Acceptance Criteria

- `/memories` matches the refined timeline direction without losing query
  functionality.
- `/highlights` reads like a source-linked excerpt list.
- View mode controls keep stable dimensions across state changes.
- Existing E2E query/filter/navigation assertions still pass.
