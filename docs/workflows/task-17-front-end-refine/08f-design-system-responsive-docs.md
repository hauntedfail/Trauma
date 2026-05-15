# Task 17.8f: Design System Responsive Docs

## Intent

Make the responsive strategy durable so future UI work does not return to
device-specific breakpoint sprawl.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this after the implementation and E2E files are in
place.

## Files

- Modify: `docs/references/design-system/layout-and-shell.md`
- Modify: `docs/references/design-system/components-and-surfaces.md`
- Modify: `docs/references/design-system/interaction-and-accessibility.md`
- Modify: `docs/references/design-system/verification.md`

## Steps

- [ ] **Step 1: Document the responsive rule**

Add a section to `layout-and-shell.md`:

```md
## Mobile And Cross-Device Responsiveness

Desktop shell dimensions are stable and should not be redesigned as part of
mobile responsive work.

The responsive direction is content-driven and component-driven intrinsic
responsive design, not viewport breakpoint-driven design.

Use viewport breakpoints only for global shell topology. Component internals
should respond to their container width with container queries. Prefer
`clamp()`, `min()`, and `max()` for fluid spacing, font-size, radius, and
control sizing.

Use CSS Grid for two-dimensional shell, route, card-grid, and reader structure.
Use Flexbox only for local one-dimensional clusters that can wrap.

Tablet shell keeps the existing left pane but renders it as an icon-only rail:
brand mark and tab icons share one aligned icon slot, labels are hidden, no
responsive header is rendered, and the desktop right rail, filter button, and
filter drawer are not available. Phone shell renders actionable left-pane tabs
as a native-app-style bottom tab bar with safe-area bottom padding. It does not
render a side rail, navigation drawer, filter drawer, TRAUMA brand text, or
filter controls. Theme and add-memory popovers must layer above the main pane
or bottom bar and remain visually intact.

Route/page shells should be constrained fluid rather than fixed-width:
combine `max-inline-size`, `inline-size`, `margin-inline`, and
`padding-inline` so layout follows writing direction instead of physical
left/right assumptions.

Component typography and spacing should use container query units when the
container is the relevant constraint: `cqi` for inline sizing, `cqb` for
block-axis spacing, `cqmin` for balanced scale, and `cqmax` only for
non-critical proportional effects. Combine these units with `clamp()`.

Mobile full-height surfaces should not use `100vh`. Use `svh` for stable route
and shell surface height, `dvh` for dynamic overlays that must track visible
viewport changes, and `lvh` only for non-critical immersive surfaces.

Safe-area handling belongs in layout tokens and utilities. Define
`env(safe-area-inset-*)` once in `src/styles/tailwind.css` as
`--trauma-layout-safe-area-*`, then apply `trauma-safe-area-*` utilities to
mobile shell wrappers, fixed/sticky bars, bottom tab bars, and full-height
overlays that touch viewport edges.

Image responsiveness is HTML-level behaviour, not only CSS overflow control.
Use `srcset` and `sizes` when trustworthy width variants exist, and use
`<picture>` / `<source>` for format alternatives or art direction. Do not create
fake `srcset` entries from duplicate URLs. Reader content may preserve
responsive image markup only after sanitizing every URL candidate.

Media queries are reserved for capability and preference detection: hover,
pointer, reduced motion, forced colors, contrast, color scheme, and orientation.
Do not use media queries or `matchMedia()` as phone, iPad, tablet, or arbitrary
viewport-width detection for component layout.

Flexbox is limited to local one-dimensional layout such as navigation rows, tag
lists, toolbars, and button groups. Use `flex-wrap: wrap` for local overflow,
and use grid/block/container-query layout for page, route, card-grid, and
reader structure.
```

- [ ] **Step 2: Document component container ownership**

In `components-and-surfaces.md`, list the responsive containers:

```md
Responsive container ownership:

- `trauma-route-surface`: route-level width context.
- `trauma-memory-list`: memory list/grid context.
- `trauma-reader-surface`: reader content context.
```

- [ ] **Step 3: Document accessibility constraints**

In `interaction-and-accessibility.md`, add:

```md
Responsive changes must preserve reachable controls, visible focus states,
touch target size, readable text, and non-overlapping content at narrow and
split-view widths.
```

- [ ] **Step 4: Run documentation checks**

```bash
git diff --check
rg -n 'T''BD|implement ''later|fill in ''details' docs/references/design-system docs/workflows/task-17-front-end-refine/08-mobile-cross-device-responsive.md docs/workflows/task-17-front-end-refine/08a-responsive-strategy-and-rules.md docs/workflows/task-17-front-end-refine/08b-responsive-contract-tests.md docs/workflows/task-17-front-end-refine/08c-container-ownership.md docs/workflows/task-17-front-end-refine/08d-component-responsive-implementation.md docs/workflows/task-17-front-end-refine/08e-cross-device-e2e.md docs/workflows/task-17-front-end-refine/08f-design-system-responsive-docs.md docs/workflows/task-17-front-end-refine/08g-safe-area-layout-tokens.md docs/workflows/task-17-front-end-refine/08h-responsive-image-markup.md docs/workflows/task-17-front-end-refine/08i-capability-preference-media-queries.md docs/workflows/task-17-front-end-refine/08j-cross-device-shell-chrome-cleanup.md
```

Expected: no placeholders.

- [ ] **Step 5: Commit design-system guidance**

```bash
git add docs/references/design-system/layout-and-shell.md docs/references/design-system/components-and-surfaces.md docs/references/design-system/interaction-and-accessibility.md docs/references/design-system/verification.md
git commit -m "docs: define responsive design strategy"
```

## Final Verification

Run:

```bash
mise exec -- bun run typecheck
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
mise exec -- bun run test:e2e -- e2e/cross-device-responsive.spec.ts
mise exec -- bun run build
```

Final handoff must include the checklist in
[08 Mobile And Cross-Device Responsive Refactor](08-mobile-cross-device-responsive.md).
