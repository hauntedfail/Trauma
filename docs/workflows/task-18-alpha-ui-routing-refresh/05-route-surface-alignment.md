# 18-alpha.5 Route surface alignment

## Goal

Align route surfaces with the refreshed shared components and define the limited
routing scope for this branch. This subtask does not create broad new route
features; it ensures existing route surfaces use the new UI foundations
consistently.

## Files likely owned

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/memories/MemoryReadStatusControl.tsx`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/components/icons/TraumaIcons.tsx`
- Modify: `src/routes/memories/index.tsx`
- Modify: `src/routes/memories/[id].tsx`
- Modify: `src/routes/flashbacks/index.tsx`
- Modify: `src/routes/moments/index.tsx`
- Modify: `tests/components/app-shell.test.ts`
- Modify: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `tests/components/memory-browse-actions.test.ts`
- Modify: `tests/components/memory-read-status.test.ts`
- Modify: `tests/components/memory-reader-actions.test.ts`
- Modify: `tests/components/trauma-icons.test.ts`
- Optional modify: `docs/references/design-system/interaction-and-accessibility.md`
  if route behaviour changes.

## Routing scope

Allowed route work in this branch:

- ensure refreshed popup and taxonomy components behave across existing routes
  `/memories`, `/memories/:id`, `/flashbacks`, `/moments`, and `/settings`
- keep `/memories` query filters for search, category, tag, Flashback, and view
  mode working after taxonomy component consolidation
- keep the `/memories` main-pane search field focus indicator aligned with the
  rounded search surface. When the search input is focused, the visible
  indicator must fit the search bar outline and rounded corners, matching the
  focus treatment used by the New tag/New category popup input fields.
- keep product-language labels consistent across surfaces: the memories right
  rail title must use `Flashbacks`, matching the memory page right rail and
  shell navigation tab label
- align read-status rendering on `/memories` and `/memories/:id`:
  - move the read-status control from the lower-right memory-card footer to the
    action cluster immediately left of the meatballs menu button
  - apply the same action-cluster placement in memory reader mode
  - render icon-only visible UI, with no visible `Read`, `Unread`, `Mark read`,
    or `Mark unread` label text
  - preserve an accessible button name with `aria-label` so icon-only rendering
    does not remove screen-reader context
  - use an open-eye icon for `read: false`
  - use a closed-eye icon for `read: true`
  - clicking the icon toggles read status using the existing read-status API and
    optimistic/error behaviour
- restructure the memory page main pane:
  - the route-local sticky header renders only the previous/back button and the
    `Memory` label
  - the header must not render title text, URL/source link, read-status button,
    taxonomy chips, or meatballs menu actions
  - the main pane content begins with the memory title as the first primary
    content element
  - render the memory's attached category/tag chips directly below the title,
    using the shared taxonomy chip component from `18-alpha.1`
  - move the URL/source display above the title
  - render the URL/source display and button icon group in the same row
  - move the button icon group, including read-status and meatballs menu, to the
    upper-right of the title block/main content intro rather than the sticky
    route header
  - keep the title/content hierarchy readable: URL/action row first, title
    second, taxonomy chips third, markdown reader body after that
- keep root redirect to `/memories`
- keep disabled shell controls disabled unless their route already exists and
  has a working page contract

Blocked route work in this branch:

- adding new public `/categories` or `/tags` pages
- changing API routes
- changing browse query key names
- adding a filter drawer or navigation drawer
- turning right-rail filter components into primary route pages

If the implementation discovers that a new route is required, stop and update
this workflow before coding the route.

## Implementation steps

1. Run the focused route/source tests before changes to identify current
   assertions.
2. Update route surfaces to import the new shared taxonomy and popup-backed menu
   components where needed.
3. Verify category/tag filter query toggles still preserve unrelated query
   state.
4. Add or update a focused component/source contract test for the memory search
   focus surface before changing the implementation. The test should assert that
   the rounded search container owns the focus indicator, using an inset ring or
   equivalent rounded-corner-safe style rather than relying on the inner
   transparent input outline.
5. Update the `/memories` search surface style only after the test fails for the
   current implementation.
6. Add or update icon tests for the shared open-eye and closed-eye icons before
   wiring them into read status controls.
7. Add or update read-status component tests so the control renders icon-only
   visible content while retaining an accessible name and preserving toggle
   request behaviour.
8. Update `MemoryReadStatusControl` so it can render the icon-only action
   variant required by browse cards and reader headers. Do not duplicate read
   status request logic in route components.
9. Update `/memories` memory cards so the read-status toggle sits immediately
   left of the meatballs menu button in the header action cluster, and remove
   the lower-right footer placement.
10. Update memory reader mode so the same icon-only read-status toggle sits
    immediately left of its meatballs menu button.
11. Add or update memory reader tests for the main pane structure before
    changing reader markup:
    - sticky reader header contains previous/back control and `Memory`
    - sticky reader header does not contain the memory title
    - URL/source link and reader action icons render in the same intro row above
      the title
    - title renders as the first primary content heading in the main pane intro
    - category/tag chips render below title using the shared taxonomy chip path
12. Update memory reader markup to match the new intro/header split. Keep data
    loading, read-status mutation, delete mutation, Flashback, and Moment
    behaviour unchanged.
13. Verify memory-row navigation still ignores nested interactive controls,
    including the moved read-status button.
14. Verify `/moments` action menu delete still does not break navigation to a
   memory section.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/app-shell-taxonomy.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-browse-actions.test.ts tests/components/memory-action-menu.test.ts tests/components/moment-action-menu.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-read-status.test.ts tests/components/memory-reader-actions.test.ts tests/components/trauma-icons.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Existing route behaviour survives the component refresh.
- `/memories` filter state remains URL-query based.
- The `/memories` search bar focus indicator fits the rounded outer search
  surface and no longer renders as a corner-mismatched inner outline.
- Read-status controls render as icon-only buttons immediately left of the
  meatballs menu on both `/memories` cards and `/memories/:id` reader mode.
- Read-status icon semantics are consistent: open eye means unread
  (`read: false`), closed eye means read (`read: true`).
- Icon-only read-status buttons keep accessible names and continue to toggle
  through the existing read-status API.
- Memory page sticky header renders only previous/back navigation and the
  `Memory` label.
- Memory page main pane intro renders URL/source and action icons in one row
  above the title, then taxonomy chips below the title.
- Memory page action icons no longer live in the sticky route header.
- Memory page taxonomy chips reuse the same shared taxonomy chip design as
  memories browse rows.
- Right-rail Flashback list headings use the plural `Flashbacks` everywhere.
- No new public route appears without an explicit workflow update.
- Disabled future shell controls remain visually and semantically disabled.
