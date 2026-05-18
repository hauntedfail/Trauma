# 18-alpha.5 Route surface alignment

## Goal

Align route surfaces with the refreshed shared components and define the limited
routing scope for this branch. This subtask does not create broad new route
features; it ensures existing route surfaces use the new UI foundations
consistently.

## Files likely owned

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/memories/browse-data.ts`
- Modify: `src/components/memories/MemoryReadStatusControl.tsx`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/components/icons/TraumaIcons.tsx`
- Modify: `src/components/flashbacks/FlashbackExcerpt.tsx`
- Modify: `src/components/flashbacks/FlashbackShortcutList.tsx`
- Modify: `src/routes/memories/index.tsx`
- Modify: `src/routes/memories/[id].tsx`
- Modify: `src/routes/flashbacks/index.tsx`
- Modify: `src/routes/moments/index.tsx`
- Modify: `tests/components/app-shell.test.ts`
- Modify: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `tests/components/memory-browse-actions.test.ts`
- Modify: `tests/memories/browse-data.test.ts`
- Modify: `tests/components/memory-read-status.test.ts`
- Modify: `tests/components/memory-reader-actions.test.ts`
- Modify: `tests/components/flashbacks-route-state.test.ts`
- Create: `tests/components/flashback-excerpt.test.ts`
- Modify: `tests/components/trauma-icons.test.ts`
- Optional modify: `docs/references/design-system/interaction-and-accessibility.md`
  if route behaviour changes.

## Routing scope

Allowed route work in this branch:

- ensure refreshed popup and taxonomy components behave across existing routes
  `/memories`, `/memories/:id`, `/flashbacks`, `/moments`, and `/settings`
- keep `/memories` query filters for search, category, tag, Flashback, and view
  mode working after taxonomy component consolidation
- extend the `/memories` search grammar while keeping the search input synced to
  the URL `q` query parameter:
  - the search bar value is exactly `parseBrowseQuery(location.search).q`
  - typing in the search bar writes the raw input back to `?q=...` using the
    existing replace-navigation pattern so browser history is not polluted per
    keystroke
  - do not add new top-level URL query keys for fielded search; field filters
    live inside `q`
  - unqualified terms remain broad free-text search over title, URL,
    categories, tags, and Flashback text/context
  - fielded syntax supports `title:{some title}`, `url:{example.com}`,
    `tag:{sqlite}`, `category:{research}`, and `flashback:{selected text}`
  - braced values may contain spaces and are trimmed before matching
  - non-braced field syntax may be accepted for single-token values, such as
    `tag:sqlite` or `url:example.com`
  - read-state filters are `read` and `unread` as standalone query tokens
  - field filters, read-state filters, explicit right-rail filters, and
    unqualified free-text terms combine with AND semantics
  - if both `read` and `unread` appear, the result is empty because the query
    asks for mutually exclusive states
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
- align Flashback excerpt rendering across `/flashbacks` and the right pane:
  - render the persisted Flashback string at normal readable text contrast
  - render the stored prefix/suffix context before and after the Flashback
    string
  - render prefix/suffix context at lower contrast than the Flashback string so
    the selected text remains the focal content
  - do not render the Flashback text as ordinary full-row body copy without
    context distinction
  - keep the right pane Flashback component bounded as an independent scroll
    region when its content overflows
  - do not apply a TOC-style component-level fade to Flashback lists; the
    visual effect belongs to the stored prefix/suffix context spans for each
    Flashback item
  - reuse a shared Flashback excerpt/list primitive where practical so
    `/flashbacks` and right pane Flashbacks do not drift visually
- align `/flashbacks` page cards:
  - use the same Flashback string plus lower-contrast context rendering
  - render the source memory title as supplemental metadata at the bottom-left
    of the card
  - make the source title smaller and visually subordinate to the Flashback
    string
  - remove the current `Source memory` label because the title context is
    self-evident
  - render a meatballs menu button for each Flashback card
  - the first-pass menu contains `Delete flashback`
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
4. Add browse-data parser/filter tests for the expanded search grammar before
   changing implementation:
   - `parseBrowseQuery("?q=title%3A%7Breader+mode%7D")` preserves the raw
     search string as `q`
   - `filterBrowseMemories(..., parseBrowseQuery("?q=title:{...}"))` filters by
     title only
   - `url:{...}`, `tag:{...}`, `category:{...}`, and `flashback:{...}` target
     their own fields without matching unrelated fields
   - `read` matches only `read: true`; `unread` matches only `read: false`
   - `read unread` yields no results
   - free-text terms still perform broad search across title, URL, taxonomy,
     and Flashback text/context
   - field filters combine with explicit `category=`, `tag=`, and `flashback=`
     query parameters using AND semantics
5. Implement a small query-token parser in `browse-data.ts`. Keep it pure and
   deterministic; do not parse fielded search in `MemoryBrowse.tsx`.
6. Update `filterBrowseMemories` so all search modes are applied in the shared
   browse-data layer, not in UI components.
7. Verify the search input continues to read from `query().q` and write raw
   input through `updateQuery({ q: value }, { replace: true })`.
8. Add or update a focused component/source contract test for the memory search
   focus surface before changing the implementation. The test should assert that
   the rounded search container owns the focus indicator, using an inset ring or
   equivalent rounded-corner-safe style rather than relying on the inner
   transparent input outline.
9. Update the `/memories` search surface style only after the test fails for the
   current implementation.
10. Add or update icon tests for the shared open-eye and closed-eye icons before
   wiring them into read status controls.
11. Add or update read-status component tests so the control renders icon-only
   visible content while retaining an accessible name and preserving toggle
   request behaviour.
12. Update `MemoryReadStatusControl` so it can render the icon-only action
   variant required by browse cards and reader headers. Do not duplicate read
   status request logic in route components.
13. Update `/memories` memory cards so the read-status toggle sits immediately
   left of the meatballs menu button in the header action cluster, and remove
   the lower-right footer placement.
14. Update memory reader mode so the same icon-only read-status toggle sits
    immediately left of its meatballs menu button.
15. Add or update memory reader tests for the main pane structure before
    changing reader markup:
    - sticky reader header contains previous/back control and `Memory`
    - sticky reader header does not contain the memory title
    - URL/source link and reader action icons render in the same intro row above
      the title
    - title renders as the first primary content heading in the main pane intro
    - category/tag chips render below title using the shared taxonomy chip path
16. Update memory reader markup to match the new intro/header split. Keep data
    loading, read-status mutation, delete mutation, Flashback, and Moment
    behaviour unchanged.
17. Add or update Flashback excerpt/list tests before changing Flashback route
    or right pane markup:
    - prefix and suffix context render around the selected Flashback text
    - selected Flashback text uses normal text contrast
    - prefix/suffix context uses lower-contrast text tokens plus the shared
      Flashback context blur/mask treatment
    - right pane Flashback lists do not expose component-level TOC fade hooks;
      the blur belongs to each item context span
    - `/flashbacks` row renders source memory title at the bottom-left without
      a `Source memory` label
    - `/flashbacks` row renders a meatballs menu with `Delete flashback`
18. Use `FlashbackInlineText` as the shared Flashback text primitive so the
    route and right pane share context rendering rules.
19. Update `/flashbacks` rows to use the shared inline rendering, subordinate
    source title metadata, and Flashback action menu.
20. Wire `Delete flashback` only through the existing Flashback removal/toggle
    mutation path. If the current backend cannot delete by Flashback id without
    changing API routes or persistence semantics, stop and update this workflow
    before implementing an API change.
21. Verify memory-row navigation still ignores nested interactive controls,
    including the moved read-status button.
22. Verify `/moments` action menu delete still does not break navigation to a
   memory section.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/memories/browse-data.test.ts
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/app-shell-taxonomy.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-browse-actions.test.ts tests/components/memory-action-menu.test.ts tests/components/moment-action-menu.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-read-status.test.ts tests/components/memory-reader-actions.test.ts tests/components/trauma-icons.test.ts
mise exec -- bun --bun x vitest run tests/components/flashback-excerpt.test.ts tests/components/flashbacks-route-state.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Existing route behaviour survives the component refresh.
- `/memories` filter state remains URL-query based.
- `/memories` search supports fielded `title:`, `url:`, `tag:`,
  `category:`, `flashback:`, and standalone `read`/`unread` filters inside the
  existing `q` parameter.
- The search bar input and URL `?q=` stay synchronized with the raw user input.
- Fielded search, free-text search, explicit right-rail filters, and read-state
  filters combine predictably with AND semantics.
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
- Flashback excerpts on `/flashbacks` and in the right pane render selected text
  at normal contrast with lower-contrast, subtly blurred prefix/suffix context
  around it.
- Flashback right pane lists use per-item context blur/mask styling rather than
  component-level scroll-edge overlays.
- `/flashbacks` rows render source memory title as small bottom-left metadata
  and no longer render a `Source memory` label.
- `/flashbacks` rows provide a meatballs menu with `Delete flashback` using
  the shared action-menu danger style.
- Right-rail Flashback list headings use the plural `Flashbacks` everywhere.
- No new public route appears without an explicit workflow update.
- Disabled future shell controls remain visually and semantically disabled.
