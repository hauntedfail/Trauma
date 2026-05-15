# Task 17.8c: Container Ownership

## Intent

Add explicit container boundaries without changing layout yet.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
and complete [08b Responsive Contract Tests](08b-responsive-contract-tests.md)
before starting.

## Files

- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify: `src/routes/highlights/index.tsx`
- Modify: `src/routes/[...404].tsx`
- Modify: `src/styles/tailwind.css`

## Steps

- [ ] **Step 1: Add route container classes to route frames**

Route frame constants should include `trauma-route-surface`. For example:

```ts
const pageShell =
  "trauma-route-surface min-h-screen w-full bg-trauma-bg-surface";
```

For the reader frame:

```ts
export const readerFrame =
  "trauma-route-surface trauma-reader-surface min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

Keep existing desktop sizing and route ownership unchanged.

Do not add fixed-width wrappers around these route frames. Any inner readable
measure added later must use the `trauma-fluid-page-shell` utility from
[08d Component Responsive Implementation](08d-component-responsive-implementation.md).

- [ ] **Step 2: Add memory list container ownership**

In `MemoryBrowse`, add `trauma-memory-list` to the element that owns the memory
list/grid layout:

```tsx
<div class={isGrid() ? "trauma-memory-list memory-grid grid grid-cols-2" : "trauma-memory-list grid"}>
```

Keep the existing list/grid state logic unchanged.

- [ ] **Step 3: Define container contexts**

In `src/styles/tailwind.css`, add these component-scoped classes in
`@layer utilities`:

```css
.trauma-route-surface {
  container: trauma-route-surface / inline-size;
}

.trauma-memory-list {
  container: trauma-memory-list / inline-size;
}

.trauma-reader-surface {
  container: trauma-reader-surface / inline-size;
}
```

- [ ] **Step 4: Verify the focused source-contract test still fails only on missing responsive rules**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts
```

Expected: FAIL remains until the next task adds the `@container` rules and
fluid sizing utilities.

- [ ] **Step 5: Commit container ownership markers**

```bash
git add src/components/memories/MemoryBrowse.tsx src/components/reader/reader-styles.ts src/routes/highlights/index.tsx src/routes/[...404].tsx src/styles/tailwind.css
git commit -m "style: add responsive container boundaries"
```
