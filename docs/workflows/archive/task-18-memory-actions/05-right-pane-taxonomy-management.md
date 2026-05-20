# 18.5 Right-pane taxonomy management

## Goal

Change the right-pane category/tag sections from visible-memory-derived filters to full taxonomy lists, and add `New category` / `New tag` creation popovers.

## Files likely owned

- `src/components/shell/AppShell.tsx`
- `src/components/memories/browse-data.ts`
- `src/components/memories/browse-loader.ts`
- optional `src/components/memories/taxonomy-loader.ts`
- `src/components/memories/TaxonomyCreatePopover.tsx`
- `tests/components/app-shell-taxonomy.test.tsx`
- `tests/memories/browse-data.test.ts`

## Data contract

Right-pane category/tag sections must list all categories/tags in the database.

They must not be derived from:

- only currently filtered memories
- only currently visible page rows
- only tags/categories attached to at least one memory

Each taxonomy item should include:

- `id`
- `name`
- `memoryCount`
- `lastAssignedAt`

Sort order:

1. `memoryCount` descending
2. `lastAssignedAt` descending, with `null` last
3. `name` ascending

## Category UI

In the right-pane Categories section:

- Add a plus icon button.
- Label: `New category`.
- Clicking opens `TaxonomyCreatePopover` anchored to that action.
- Popover receives a name input.
- Enter submits.
- Icon button next to input submits.
- On success, the category appears in the right-pane list.

Do not auto-select the new category filter unless the user explicitly clicks it after creation.

## Tag UI

Same as category, but:

- Section: Tags
- Label: `New tag`
- Endpoint: tag creation

Do not auto-select the new tag filter unless the user explicitly clicks it after creation.

## Existing filter behaviour

Keep existing category/tag filter buttons:

- Clicking a category filters `/memories?category=<id>`.
- Clicking the same active category toggles it off.
- Clicking a tag filters `/memories?tag=<id>`.
- Clicking the same active tag toggles it off.

The right-pane list being global must not break filtering against the current browse memory rows.

## Empty states

If no categories exist:

- render `New category`
- render a small empty-state hint

If no tags exist:

- render `New tag`
- render a small empty-state hint

## Tests

Cover:

- right pane shows categories/tags not attached to visible memories
- right pane includes zero-count categories/tags
- sort order is count, recent assignment, name
- `New category` opens popover and creates category
- `New tag` opens popover and creates tag
- creation does not auto-apply filter
- existing filter toggle behaviour remains

## Verification

```sh
mise exec -- bun run test tests/components/app-shell-taxonomy.test.tsx
mise exec -- bun run test tests/memories/browse-data.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Right pane is backed by full taxonomy data.
- Category/tag creation works from the right pane.
- Existing filtering remains intact.
- No reader UI is changed in this subtask.

