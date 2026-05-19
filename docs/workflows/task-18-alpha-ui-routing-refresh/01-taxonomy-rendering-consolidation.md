# 18-alpha.1 Taxonomy rendering consolidation

## Goal

Create a shared taxonomy rendering primitive so memory-row tags/categories and
right-rail category/tag filters are rendered from one component family instead
of separate local markup.

## Files likely owned

- Create: `src/components/taxonomy/TaxonomyList.tsx`
- Create: `tests/components/taxonomy-list.test.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/components/shell/AppShell.tsx`
- Optional modify: `src/components/memories/browse-data.ts`
- Optional modify: `tests/components/memory-reader-actions.test.ts`

## Component contract

Create a component family with one data shape and two display modes:

```ts
export interface TaxonomyListItem {
  id: string;
  name: string;
  memoryCount?: number;
}

export interface TaxonomyListProps {
  activeId?: string;
  emptyLabel?: string;
  items: readonly TaxonomyListItem[];
  kind: "category" | "tag";
  mode: "chips" | "filters";
  onSelect?: (item: TaxonomyListItem) => void;
}
```

Rules:

- `mode="chips"` is used by memory-row metadata and reader memory taxonomy
  chips. Memory page main content must use this same chip mode for the memory's
  attached categories and tags below the title.
- `mode="filters"` is used by the right rail category/tag sections.
- Counts render only when `memoryCount` is defined.
- Filter mode uses `aria-pressed` when `onSelect` is present.
- Chip mode is non-interactive unless `onSelect` is provided.
- Empty state text is supplied by the consumer, so category and tag wording can
  stay route-specific.
- The component must not know about browse query keys. Parents own routing and
  filter state.

## Implementation steps

1. Add `TaxonomyList` tests first:
   - chip mode renders names without counts when `memoryCount` is absent
   - filter mode renders counts when provided
   - active filter uses `aria-pressed="true"`
   - empty list renders the provided empty label
   - click calls `onSelect` with the selected item
2. Implement `TaxonomyList`.
3. Replace memory-row tag/category rendering in `MemoryBrowse.tsx`.
4. Replace memory page reader taxonomy chip rendering in `MemoryReader.tsx`
   with `TaxonomyList mode="chips"` so the memory page and memories browse
   route share one taxonomy-chip design.
5. Replace `TaxonomyFilterButton` usage in `AppShell.tsx` right rail with
   `TaxonomyList`.
6. Remove local taxonomy rendering helpers that become unused.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/taxonomy-list.test.tsx
mise exec -- bun --bun x vitest run tests/components/app-shell-taxonomy.test.ts tests/components/memory-browse-actions.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-reader-actions.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Memory-row taxonomy and right-rail taxonomy render through the shared
  taxonomy component family.
- Right-rail category/tag filtering keeps current query behaviour.
- Memory-row taxonomy keeps current visual density and does not become a route
  filter by accident.
- Memory page taxonomy chips below the title match the memories browse chip
  design and come from the same shared taxonomy component.
- No data loading or API behaviour changes are introduced.
