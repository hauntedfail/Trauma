# Task 07: Highlight System Workflow

## Goal

Implement text selection highlight toggles in reader mode, highlight-aware
search data, the `/highlights` browse view, optimistic UI, SQLite persistence,
and `<mark data-highlight-id>` insertion/removal in `CONTENT.md`.

## Required Context

- [Data and storage architecture](../architecture/data-and-storage.md)
- [Runtime flows](../architecture/flows.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)

## Ownership

Primary files and directories:

- `src/components/reader/**`
- `src/components/highlights/**`
- `src/routes/highlights/**`
- `src/server/highlights/**`
- `src/server/store/**` highlight insertion helpers.
- `src/server/db/**` highlight repository helpers.
- `tests/server/highlights/**`
- Highlight-focused E2E specs.

Avoid changing the reader pipeline except where needed to surface highlight UI.

## Implementation Steps

1. Define highlight contract.
   - `id`
   - `memory_id`
   - `text`
   - `prefix`
   - `suffix`
   - `start_offset`
   - `end_offset`
   - Toggle operation: create highlight or remove highlight coverage for the
     selected range.

2. Implement selection capture.
   - Capture selected text.
   - Capture prefix/suffix context.
   - Capture offsets against normalized reader text.
   - Detect whether the selected range is already fully highlighted.

3. Implement optimistic UI.
   - Show highlight immediately for unhighlighted selections.
   - Remove styling immediately for already-highlighted selections.
   - When unhighlighting, remove styling only from the selected range.
   - Disable duplicate submission for the active selection.
   - Roll back or mark failed when persistence fails.

4. Implement server persistence.
   - For unhighlighted text, insert a highlight row.
   - Insert `<mark data-highlight-id="...">selected text</mark>` into
     `CONTENT.md`.
   - For already-highlighted text, delete, shrink, or split highlight rows so
     only the selected range is unhighlighted.
   - Remove, shrink, or split `<mark data-highlight-id>` ranges in `CONTENT.md`
     to match SQLite.
   - Enqueue backup through the Task 8 boundary.

5. Implement highlight browse data.
   - Add repository methods for listing highlights with memory title.
   - Return highlighted `text`, muted `prefix`, muted `suffix`, memory ID,
     memory title, and highlight ID.
   - Support highlight-aware `/memories?q=...` search by matching highlight
     text and prefix/suffix context.

6. Implement `/highlights`.
   - Render highlight rows with memory title, muted prefix, highlighted text,
     and muted suffix.
   - Use a dense GitHub PR file-review-inspired layout.
   - Link each row to the source memory highlight anchor.
   - Do not render full memory bodies in this view.

7. Add tests.
   - Same text appearing multiple times anchors correctly using hybrid selector.
   - Mark insertion preserves markdown outside the selection.
   - Selecting an exact existing highlight removes that highlight.
   - Selecting a subset of an existing highlight preserves the unselected
     highlighted text on both sides.
   - Selecting across multiple highlights removes only the selected overlaps.
   - Highlight list repository returns source memory title and context.
   - `/memories?q=...` can match highlight text/context.
   - Failed persistence reports failure to the UI.

8. Add E2E coverage.
   - Select text in `/memories/:id`.
   - Verify highlight appears.
   - Select the highlighted text again.
   - Verify only the selected text is unhighlighted.
   - Reload and verify persisted highlight appears.
   - Visit `/highlights` and verify the quote row shows memory title plus
     prefix/highlight/suffix context.
   - Search `/memories?q=...` for text that exists only in a highlight and
     verify the source memory appears.

## Acceptance Criteria

- Reader remains non-editable except for highlight creation.
- Highlight records are canonical in SQLite.
- `CONTENT.md` stores persisted mark tags.
- Selecting already-highlighted text toggles off only the selected range.
- `/highlights` lists highlight excerpts with source memory titles.
- `/memories?q=...` includes highlight text/context in search results.
- Existing sanitization allows the persisted marks.
- Backup enqueue happens after markdown write.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Selection anchoring strategy.
- Toggle/unhighlight behavior for exact, partial, and multi-highlight
  selections.
- `/highlights` row shape and source-memory linking.
- Highlight-aware `/memories?q=...` search behavior.
- Failure/rollback behavior.
- Mark insertion examples.
- Exact verification commands and outcomes.
