# 18.6 Reader memory actions

## Goal

Wire Task 18 into memory reader mode: shared action menu, read status, attached taxonomy rendering, and delete behaviour.

## Files likely owned

- `src/server/reader/page-data.ts`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/route-state.ts`
- `src/components/memories/MemoryActionMenu.tsx`
- `src/components/memories/MemoryReadStatusControl.tsx`
- `tests/server/reader/page-data.test.ts`
- `tests/components/memory-reader-actions.test.tsx`

## Reader data contract

Reader page data for the active memory must include:

- `id`
- `title`
- `url`
- `description`
- `faviconUrl`
- `contentPath`
- `extractionStatus`
- `read`
- attached `tags`
- attached `categories`
- existing rendered content/highlight data

Reader mode must not fetch or render global taxonomy lists.

## Header rendering contract

Reader header right edge:

- shared `MemoryActionMenu`
- read status control

Lower/right header area:

- read status label/control
- attached tags/categories for the current memory

Keep the header compact. Do not redesign reader typography or content layout.

## Action menu contract

Use the same `MemoryActionMenu` component as browse memory items.

Menu items available from reader:

- `Delete memory`
- `Add category`

Delete from reader:

1. Confirm deletion.
2. Call delete API.
3. Navigate to `/memories` after success.
4. Show concise error on failure.

Add category from reader:

1. Opens shared taxonomy popover.
2. Creates or resolves category by name.
3. Attaches category to the active memory.
4. Updates visible reader category chips after success.

## Attached taxonomy rendering

Reader mode renders only categories/tags attached to the current memory.

Rules:

- Do not render all tags/categories from the app.
- Do not render empty taxonomy sections if the memory has no attached records, unless needed for the `Add category` action.
- Preserve existing highlight and markdown rendering behaviour.

## Read status behaviour

Render `MemoryReadStatusControl` in the header.

Rules:

- Initial state comes from reader page data.
- Toggle persists through API.
- Failure reverts local state and shows a concise error.

## Tests

Cover:

- page data includes read, categories, and tags
- reader header renders shared action menu
- reader header renders read status control
- reader renders only attached taxonomy
- delete from reader navigates to `/memories` on success
- delete failure shows error and does not navigate
- add category attaches and updates visible reader taxonomy
- existing highlight rendering remains intact

## Verification

```sh
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/components/memory-reader-actions.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Reader uses the shared memory action menu.
- Reader does not duplicate browse menu logic.
- Reader only displays taxonomy attached to the current memory.
- Reader deletion and read status work without breaking highlight behaviour.

