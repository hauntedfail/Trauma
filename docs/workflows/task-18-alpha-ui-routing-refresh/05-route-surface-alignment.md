# 18-alpha.5 Route surface alignment

## Goal

Align route surfaces with the refreshed shared components and define the limited
routing scope for this branch. This subtask does not create broad new route
features; it ensures existing route surfaces use the new UI foundations
consistently.

## Files likely owned

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/routes/memories/index.tsx`
- Modify: `src/routes/memories/[id].tsx`
- Modify: `src/routes/flashbacks/index.tsx`
- Modify: `src/routes/moments/index.tsx`
- Modify: `tests/components/app-shell.test.ts`
- Modify: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `tests/components/memory-browse-actions.test.ts`
- Optional modify: `docs/references/design-system/interaction-and-accessibility.md`
  if route behaviour changes.

## Routing scope

Allowed route work in this branch:

- ensure refreshed popup and taxonomy components behave across existing routes
  `/memories`, `/memories/:id`, `/flashbacks`, `/moments`, and `/settings`
- keep `/memories` query filters for search, category, tag, Flashback, and view
  mode working after taxonomy component consolidation
- keep product-language labels consistent across surfaces: the memories right
  rail title must use `Flashbacks`, matching the memory page right rail and
  shell navigation tab label
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
4. Verify memory-row navigation still ignores nested interactive controls.
5. Verify `/moments` action menu delete still does not break navigation to a
   memory section.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/app-shell-taxonomy.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-browse-actions.test.ts tests/components/memory-action-menu.test.ts tests/components/moment-action-menu.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Existing route behaviour survives the component refresh.
- `/memories` filter state remains URL-query based.
- Right-rail Flashback list headings use the plural `Flashbacks` everywhere.
- No new public route appears without an explicit workflow update.
- Disabled future shell controls remain visually and semantically disabled.
