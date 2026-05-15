# Task 17.8d: Component Responsive Implementation

## Intent

Convert component-internal mobile adaptations from viewport/device breakpoints
to container queries. Do not change desktop shell topology.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this only after container ownership from
[08c Container Ownership](08c-container-ownership.md) exists.

## Files

- Modify: `src/styles/tailwind.css`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/routes/highlights/index.tsx`

## Steps

- [ ] **Step 1: Add fluid route spacing utilities**

Add:

```css
.trauma-fluid-page-shell {
  inline-size: min(100%, var(--trauma-page-shell-max, 52rem));
  max-inline-size: var(--trauma-page-shell-max, 52rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4cqi, 2rem);
}

.trauma-fluid-route-padding {
  padding-inline: clamp(1rem, 4cqi, 2rem);
}

.trauma-fluid-route-stack {
  gap: clamp(0.75rem, 2cqi, 1.5rem);
}

.trauma-fluid-reader-title {
  font-size: clamp(2rem, 1.1rem + 3cqi, 3rem);
  line-height: 1.08;
}

.trauma-fluid-component-title {
  font-size: clamp(1.5rem, 1rem + 4cqi, 2.5rem);
}

.trauma-fluid-component-gap {
  gap: clamp(0.5rem, 2cqmin, 1rem);
}

.trauma-fluid-component-block-space {
  margin-block: clamp(0.75rem, 3cqb, 1.5rem);
}

.trauma-mobile-stable-viewport {
  min-block-size: 100svh;
}

.trauma-mobile-dynamic-viewport {
  block-size: 100dvh;
}

.trauma-mobile-large-viewport {
  block-size: 100lvh;
}

.trauma-local-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: clamp(0.5rem, 1.5cqi, 1rem);
}

.trauma-local-wrap > * {
  min-inline-size: 0;
}
```

Keep desktop maximums aligned with current refined desktop values.

Use logical properties for route/page shell sizing and spacing. Do not replace
this with `width`, `margin-left`, `margin-right`, `padding-left`, or
`padding-right` unless a physical direction is semantically required.

Use container query units for component-local typography and spacing. Do not use
viewport units for component internals when a named query container exists.

Use `trauma-mobile-stable-viewport` for mobile route and full-height shell
surfaces instead of `100vh` or `min-h-screen` when the surface must account for
browser chrome. Use `trauma-mobile-dynamic-viewport` only for fixed overlays
that must track the current visible viewport, and `trauma-mobile-large-viewport`
only for non-critical immersive surfaces.

Use `trauma-local-wrap` only for local navigation, tag, toolbar, and button
clusters. Do not use it for shell, route, card-grid, or reader structure.

- [ ] **Step 2: Add route container rules for header stacking and padding**

Add:

```css
@container trauma-route-surface (width < 42rem) {
  .trauma-route-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .trauma-route-row {
    padding-inline: 1rem;
  }
}
```

Use these classes on browse/highlights route headers and rows instead of adding
new `max-[720px]` branches for those internals.

- [ ] **Step 3: Add memory list container rules**

Add:

```css
@container trauma-memory-list (width < 36rem) {
  .trauma-memory-grid {
    grid-template-columns: 1fr;
  }

  .trauma-memory-card {
    grid-template-columns: 40px minmax(0, 1fr);
    min-height: 0;
  }
}
```

Rename the JSX class from `memory-grid` to include `trauma-memory-grid`, and
add `trauma-memory-card` to memory card links. Keep any existing class needed by
tests until tests are updated in the same commit.

- [ ] **Step 4: Add reader container rules**

Add:

```css
@container trauma-reader-surface (width < 42rem) {
  .trauma-reader-header {
    grid-template-columns: 40px minmax(0, 1fr);
    padding-inline: 1rem;
  }

  .trauma-reader-body {
    padding-inline: 1rem;
  }
}
```

Apply `trauma-reader-header`, `trauma-reader-body`, and
`trauma-fluid-reader-title` in `MemoryReader`. Do not change markdown
sanitisation, highlight selection, or ToC behaviour.

- [ ] **Step 5: Apply constrained fluid shells only where route content needs a readable measure**

Use `trauma-fluid-page-shell` for inner page content that should be readable but
not fixed-width. Do not apply it to the desktop shell grid or to full-column
frames that must remain flush with pane borders.

Examples:

```tsx
<div class={`${readerPadding} trauma-reader-body py-7 pb-14`}>
  <div class="trauma-fluid-page-shell">
    ...
  </div>
</div>
```

If the browse timeline must continue touching the pane edge, do not wrap it in
`trauma-fluid-page-shell`; instead keep the full-width frame and use
container-query padding on rows.

- [ ] **Step 6: Audit existing flex usage and keep it local**

Run:

```bash
rg -n "flex|inline-flex" src/components src/routes
```

Expected review outcome:

- Keep flex for one-dimensional rows, icon+label groups, navigation controls,
  tag lists, toolbars, and button groups.
- Replace or avoid flex for page shells, route structure, memory grids, and
  reader structure when those layouts need two-dimensional control.
- If a kept flex row can overflow on narrow containers, add `trauma-local-wrap`
  or an equivalent local `flex-wrap` rule.

- [ ] **Step 7: Audit mobile viewport-height usage**

Run:

```bash
rg -n "100vh|min-h-screen|min-h-\\[calc\\(100vh|vh\\b" src/components src/routes src/styles/tailwind.css
rg -n "svh|dvh|lvh" src/components src/routes src/styles/tailwind.css
```

Expected review outcome:

- No mobile route, shell, or full-height surface uses `100vh`.
- `min-h-screen` may remain only where the implementation proves it does not
  affect mobile browser chrome behaviour; otherwise replace it with a
  `svh`/`dvh`/`lvh` utility.
- `svh` is the default for stable mobile route and shell height.
- `dvh` is limited to overlays or fixed panels that must track the current
  visible viewport.
- `lvh` is limited to non-critical immersive surfaces.
- Component-internal typography, spacing, radius, and local sizing should use
  `cqi`, `cqb`, `cqmin`, or `cqmax` with `clamp()` when the containing pane is
  the relevant constraint.
- Any remaining `vh` or `min-h-screen` usage must be listed in the PR body with
  why `svh`, `dvh`, or `lvh` is not the right fit.

- [ ] **Step 8: Run focused tests**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit responsive component internals**

```bash
git add src/styles/tailwind.css src/components/memories/MemoryBrowse.tsx src/components/reader/reader-styles.ts src/components/reader/MemoryReader.tsx src/routes/highlights/index.tsx tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
git commit -m "style: make route surfaces container responsive"
```
