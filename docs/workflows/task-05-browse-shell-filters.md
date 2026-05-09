# Task 05: Browse Shell And Filters Workflow

## Goal

Implement the canonical browse experience: `/`, `/memories`, X-like shell,
list/grid view option, query filters, and responsive navigation/filter drawers.

## Required Context

- [UI and routing architecture](../architecture/ui-and-routing.md)
- [Glossary](../references/glossary.md)
- [Verification strategy](../quality/verification.md)

## Ownership

Primary files and directories:

- `src/app.tsx`
- `src/routes/index.tsx`
- `src/routes/memories/**`
- `src/components/shell/**`
- `src/components/memories/**`
- UI-focused tests and E2E specs.

Do not implement importer internals, markdown store, reader rendering, or backup.

## Implementation Steps

1. Preserve canonical routing.
   - `/` redirects to `/memories`.
   - `/memories` owns browse/search/filter state.
   - Do not add `/category`, `/tags`, or `/memories/new`.

2. Build app shell components.
   - Shared left navigation.
   - Center content region.
   - Right category/tag filter panel.
   - Mobile left drawer and right filter drawer.

3. Implement query state.
   - `q`
   - `category`
   - `tag`
   - `view=list|grid`

4. Render memory list states.
   - Empty state.
   - Loading state if route data is async.
   - List view.
   - Grid view.

5. Connect to repository interfaces.
   - Use Task 2 repository functions when available.
   - Keep mock/fixture fallback only in tests.

6. Add Playwright coverage.
   - `/` reaches `/memories`.
   - Query filter changes URL state.
   - List/grid control does not shift layout.
   - Narrow viewport exposes drawer controls.

## Acceptance Criteria

- Route and query model matches the foundation docs.
- Left navigation is shared app shell, not page-local.
- Right filter panel updates `/memories` query state.
- Responsive behavior is implemented from the start.
- UI text fits at mobile and desktop widths.

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

- Routes touched.
- Query parameters supported.
- Responsive behavior verified.
- Exact verification commands and outcomes.
