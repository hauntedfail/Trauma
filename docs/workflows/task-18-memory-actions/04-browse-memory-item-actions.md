# 18.4 Browse memory item actions

## Goal

Wire Task 18 behaviours into `/memories` memory items: read status, link-only status, footer tags, add-tag action, per-memory menu, and delete action.

## Files likely owned

- `src/components/memories/MemoryBrowse.tsx`
- `src/components/memories/browse-data.ts`
- `src/components/memories/browse-loader.ts`
- `src/components/memories/MemoryActionMenu.tsx`
- `src/components/memories/MemoryReadStatusControl.tsx`
- `src/components/memories/TaxonomyCreatePopover.tsx`
- `tests/memories/browse-data.test.ts`
- `tests/components/memory-browse-actions.test.tsx`

## Rendering contract

Each browse memory item must render:

- title
- URL
- description
- attached category chips if already present
- attached tag chips
- latest/selected highlight preview
- open link
- shared memory action menu
- read status control
- footer status line

Footer status line:

- For `extractionStatus === "link_only"`, render an error icon and text `Link-only`.
- For successful full-content memories, render no `Saved` label.
- Render attached tags on this line.
- Render an `Add tag` placeholder/action on this line.

Do not remove category chips unless a later design task explicitly moves them.

## Add tag behaviour

Clicking `Add tag`:

1. Opens the shared `TaxonomyCreatePopover`.
2. Uses tag mode labels.
3. Submits by name.
4. Calls the create-or-attach tag API for the current memory.
5. Updates the current memory's visible tag list after success.

The popup may create a new tag or resolve an existing tag by name. The user should not need to know which path occurred.

## Delete behaviour

The memory action menu on browse items includes `Delete memory`.

After successful delete:

- remove the memory from the current visible list, or
- revalidate/navigate using the existing route-data pattern.

Do not leave a deleted item visible until a full page refresh.

## Read status behaviour

Render `MemoryReadStatusControl` near the lower-right of the memory item.

Rules:

- Initial state comes from browse data.
- Toggle persists through the API.
- Failure leaves the item in its previous state and shows a concise error.

## Browse data changes

`BrowseMemory` needs:

- `read`
- `extractionStatus`
- attached categories
- attached tags

Search behaviour:

- Existing title/URL/description/tag/category/highlight search remains.
- Do not add read-status filtering in this subtask.

## Tests

Cover:

- successful memory does not render `Saved`
- link-only memory renders error icon and `Link-only`
- tags render in footer/status line
- `Add tag` opens popover
- submitting `Add tag` attaches tag and updates visible row
- delete menu item deletes and removes memory from view
- read control renders and toggles
- existing category/tag/highlight filtering still works

## Verification

```sh
mise exec -- bun run test tests/memories/browse-data.test.ts
mise exec -- bun run test tests/components/memory-browse-actions.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- `/memories` exposes all specified per-memory actions.
- Link-only state is visible and successful saved state is not redundantly shown.
- `Add tag` attaches a tag to the selected memory.
- Delete works from the browse item menu.
- Existing browse filtering is not regressed.
