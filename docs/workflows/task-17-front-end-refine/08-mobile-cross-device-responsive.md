# Task 17.8: Mobile And Cross-Device Responsive Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this workflow task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Refactor TRAUMA's mobile and cross-device responsive behaviour so reusable UI
surfaces adapt to their own container width instead of relying primarily on
device-width breakpoints.

Desktop is out of scope. Do not redesign or resize the existing desktop shell,
desktop rail, desktop main column, or desktop right rail.

## Architecture

Use a container-query-first strategy for route and component responsiveness.
Viewport breakpoints may remain only for true shell-level structure such as
desktop/tablet/mobile navigation presence. Component density, typography,
spacing, row/card shape, and control grouping should respond to the width of
the component's containing pane.

Use continuous sizing with `clamp()`, `min()`, and `max()` for spacing,
font-size, radius, control size, and component min-size when a value should
scale gradually. Use discrete `@container` branches only when layout topology
changes, such as switching a memory card from two columns to one column.

## Tech Stack

- SolidStart component boundaries already used by Task 17.
- Tailwind v4 utilities from `src/styles/tailwind.css`.
- CSS Container Queries with `container-type: inline-size`.
- Container query units: `cqi`, `cqb`, `cqmin`, and `cqmax`.
- CSS math functions: `clamp()`, `min()`, and `max()`.
- CSS Flexbox only for local one-dimensional layout with wrapping.
- Vitest source-contract tests for responsive policy.
- Playwright E2E for mobile and cross-device layout behaviour.

## Source References

- MDN CSS container queries:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_container_queries`
- MDN `container-type`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/container-type`
- web.dev CSS container queries:
  `https://web.dev/learn/css/container-queries/`
- web.dev CSS sizing units:
  `https://web.dev/learn/css/sizing/`
- MDN `clamp()`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/clamp`
- MDN CSS logical properties and values:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values`
- MDN basic concepts of flexbox:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox`
- MDN `flex-wrap`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/flex-wrap`
- `docs/references/design-system/layout-and-shell.md`
- `docs/references/design-system/components-and-surfaces.md`
- `docs/references/design-system/interaction-and-accessibility.md`
- `docs/references/design-system/verification.md`
- `docs/workflows/task-17-front-end-refine/03-shell-navigation-and-theme.md`
- `docs/workflows/task-17-front-end-refine/04-memory-browse-and-highlight-surfaces.md`
- `docs/workflows/task-17-front-end-refine/05-reader-surface.md`

## Worker Contract

- Work on `refine/frontend-sample` or a branch based on it.
- Do not alter desktop layout tokens unless a test proves the value also
  controls mobile-only behaviour. If a shared token must change, add a test that
  proves desktop shell dimensions are unchanged.
- Do not add iPad-specific, phone-model-specific, or device-width-specific
  branches as the primary responsive mechanism.
- Do not use fixed viewport breakpoints for component internals when a
  container query can express the same adaptation.
- Do not use viewport units as the primary unit for component-internal
  typography or spacing. Prefer container query units when the component's
  containing pane is the relevant constraint.
- Do not introduce fixed-width route/page shells. Route content should be
  constrained fluid with logical sizing and spacing properties.
- Do not use flexbox as a page, shell, route, or card-grid layout system. Flex
  is for local one-dimensional clusters that may wrap.
- Do not reintroduce `src/styles/app.css`.
- Do not change server, importer, backup, extension, database, or markdown
  reader behaviour.
- Preserve accessibility: keyboard focus, readable text, non-overlapping
  controls, and reachable navigation/drawer actions across narrow containers.

## Design Rules

### Container-First Responsiveness

Use `container-type: inline-size` on route-level and component-level wrappers
that own responsive child layout. Prefer named containers when the rule needs a
specific ancestor:

```css
.trauma-memory-surface {
  container: trauma-memory-surface / inline-size;
}

@container trauma-memory-surface (width < 36rem) {
  .trauma-memory-card {
    grid-template-columns: 1fr;
  }
}
```

Use unnamed containers only for local, unambiguous component rules. Do not make
`body`, the whole app shell, or every element a query container.

### Viewport Breakpoint Limits

Viewport breakpoints are still acceptable for global shell topology:

- Desktop shell: left rail + main pane + right rail.
- Tablet shell: compact left rail + main pane + drawer filters.
- Mobile shell: top bar + drawers.

Inside route surfaces and reusable components, replace hard `max-[720px]` or
`max-[1040px]` assumptions with container queries where the rule is about the
available component width rather than the whole viewport.

### Continuous Sizing

Use CSS math for values that should scale smoothly:

```css
.trauma-fluid-route-padding {
  padding-inline: clamp(1rem, 4cqi, 2rem);
}

.trauma-fluid-title {
  font-size: clamp(1.875rem, 1.2rem + 2cqi, 3rem);
}
```

Rules:

- Keep minimum sizes large enough for touch targets and text readability.
- Keep maximum sizes aligned with the refined desktop design.
- Do not scale every font with viewport width. Use container-relative sizing
  only where the component width is the correct constraint.
- Prefer `cqi` in container-query contexts and ordinary rem-based values
  outside them.

### Container Query Units

Use container query units for component-local typography and spacing when the
component should scale with its containing pane instead of the viewport:

```css
.trauma-fluid-component-title {
  font-size: clamp(1.5rem, 1rem + 4cqi, 2.5rem);
}

.trauma-fluid-component-gap {
  gap: clamp(0.5rem, 2cqmin, 1rem);
}

.trauma-fluid-component-block-space {
  margin-block: clamp(0.75rem, 3cqb, 1.5rem);
}
```

Unit guidance:

- Use `cqi` for inline-axis sizing such as readable typography, inline padding,
  and horizontal gaps.
- Use `cqb` for block-axis spacing only inside containers where block-size is a
  meaningful, stable constraint.
- Use `cqmin` for balanced spacing or radius that should respond to the smaller
  container dimension.
- Use `cqmax` sparingly for decorative or proportional effects that must follow
  the larger container dimension; do not use it for core readability.
- Always combine container query units with `clamp()` so narrow containers do
  not create unreadably small text or touch targets, and wide containers do not
  exceed the refined desktop design.
- Do not use `vw`, `vh`, `vmin`, or `vmax` for component internals when a named
  query container exists.

### Constrained Fluid Page Shells

Do not build route/page shells with fixed width wrappers. Use constrained fluid
layout:

```css
.trauma-fluid-page-shell {
  inline-size: min(100%, var(--trauma-page-shell-max, 52rem));
  max-inline-size: var(--trauma-page-shell-max, 52rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4cqi, 2rem);
}
```

Rules:

- Use `max-inline-size`, `inline-size`, `margin-inline`, `padding-inline`, and
  other logical properties where the concept is inline/block rather than
  physical left/right/top/bottom.
- Do not use fixed `width`, left/right-only margin shims, or viewport-width
  page wrappers for route content.
- The desktop shell grid remains unchanged. This rule applies to route/page
  content shells and reusable surfaces inside the assigned shell column.
- If a component needs a max readable measure, express it as a constrained
  fluid wrapper rather than a fixed-width card.

### Flexbox Scope

Use flexbox only for local one-dimensional layouts:

- Navigation item rows.
- Tag/chip lists.
- Toolbars.
- Button groups.
- Short icon+label clusters.

When a local row may overflow, use wrapping rather than device-specific
breakpoints:

```css
.trauma-local-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: clamp(0.5rem, 1.5cqi, 1rem);
}
```

Rules:

- Do not use flexbox for the app shell, route shell, page shell, memory grid, or
  reader layout structure. Use CSS grid, block flow, or container-query-driven
  layout for those surfaces.
- Prefer `flex-wrap: wrap` for tag lists, toolbar actions, and button groups
  that need to break onto another line inside a narrow container.
- Keep flex children from forcing overflow by using `min-inline-size: 0` on
  text-bearing child elements where truncation or wrapping is expected.
- Do not use flexbox to emulate two-dimensional alignment. If both rows and
  columns matter, use grid.

## File Ownership

Primary files:

- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/components/reader/reader-styles.ts`
- `src/components/reader/MemoryReader.tsx`
- `src/routes/highlights/index.tsx`
- `src/routes/[...404].tsx`
- `tests/components/app-shell.test.ts`
- `tests/components/mobile-responsive-contract.test.ts`
- `e2e/cross-device-responsive.spec.ts`
- `docs/references/design-system/layout-and-shell.md`
- `docs/references/design-system/components-and-surfaces.md`
- `docs/references/design-system/interaction-and-accessibility.md`
- `docs/references/design-system/verification.md`

Do not edit files outside this list unless a failing test proves the
responsive boundary lives elsewhere. Document any extra file in the PR body.

## Task 1: Add Responsive Policy Contract Tests

**Intent:** Lock the strategic shift before changing UI code: components should
gain container-query affordances, and desktop dimensions must stay unchanged.

**Files:**

- Create: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `tests/components/app-shell.test.ts`

- [ ] **Step 1: Create a source-contract test for container-first responsive CSS**

Create `tests/components/mobile-responsive-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");
const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const readerStylesSource = readFileSync(
  "src/components/reader/reader-styles.ts",
  "utf8",
);
const highlightsRouteSource = readFileSync(
  "src/routes/highlights/index.tsx",
  "utf8",
);

describe("mobile and cross-device responsive contract", () => {
  it("keeps desktop shell dimensions unchanged", () => {
    expect(appShellSource).toContain(
      "min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px]",
    );
  });

  it("defines route and component containers for responsive internals", () => {
    expect(tailwindCss).toContain("container: trauma-route-surface / inline-size");
    expect(tailwindCss).toContain("container: trauma-memory-list / inline-size");
    expect(tailwindCss).toContain("container: trauma-reader-surface / inline-size");
    expect(tailwindCss).toContain("@container trauma-route-surface");
    expect(tailwindCss).toContain("@container trauma-memory-list");
    expect(tailwindCss).toContain("@container trauma-reader-surface");
  });

  it("uses continuous sizing for route padding and reader headings", () => {
    expect(tailwindCss).toMatch(/clamp\([^)]*cqi[^)]*\)/);
    expect(tailwindCss).toContain("cqmin");
    expect(tailwindCss).toContain("cqb");
    expect(tailwindCss).toContain(".trauma-fluid-route-padding");
    expect(tailwindCss).toContain(".trauma-fluid-reader-title");
  });

  it("prefers container query units over viewport units for component internals", () => {
    expect(tailwindCss).toContain(".trauma-fluid-component-title");
    expect(tailwindCss).toContain(".trauma-fluid-component-gap");
    expect(tailwindCss).toContain(".trauma-fluid-component-block-space");
    expect(tailwindCss).toContain("4cqi");
    expect(tailwindCss).toContain("2cqmin");
    expect(tailwindCss).toContain("3cqb");
  });

  it("uses logical properties for constrained fluid page shells", () => {
    expect(tailwindCss).toContain(".trauma-fluid-page-shell");
    expect(tailwindCss).toContain("max-inline-size");
    expect(tailwindCss).toContain("margin-inline: auto");
    expect(tailwindCss).toContain("padding-inline: clamp(");
    expect(tailwindCss).not.toContain("width: 840px");
  });

  it("limits flex utilities to local one-dimensional wrapping clusters", () => {
    expect(tailwindCss).toContain(".trauma-local-wrap");
    expect(tailwindCss).toContain("display: flex");
    expect(tailwindCss).toContain("flex-wrap: wrap");
    expect(tailwindCss).toContain("min-inline-size: 0");
    expect(tailwindCss).not.toContain(".trauma-route-surface {\n  display: flex");
    expect(tailwindCss).not.toContain(".trauma-fluid-page-shell {\n  display: flex");
  });

  it("marks route surfaces with responsive container classes", () => {
    expect(memoryBrowseSource).toContain("trauma-route-surface");
    expect(memoryBrowseSource).toContain("trauma-memory-list");
    expect(readerStylesSource).toContain("trauma-route-surface");
    expect(readerStylesSource).toContain("trauma-reader-surface");
    expect(highlightsRouteSource).toContain("trauma-route-surface");
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts
```

Expected before implementation: FAIL because the container classes and
container-query CSS do not exist.

- [ ] **Step 3: Add desktop preservation assertions to the existing shell test**

In `tests/components/app-shell.test.ts`, add an assertion to the desktop shell
contract test that keeps the desktop grid columns unchanged:

```ts
expect(appShellSource).toContain(
  "min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px]",
);
```

- [ ] **Step 4: Commit the failing responsive contract**

```bash
git add tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
git commit -m "test: define cross-device responsive contract"
```

## Task 2: Add Container Ownership Classes

**Intent:** Add explicit container boundaries without changing layout yet.

**Files:**

- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify: `src/routes/highlights/index.tsx`
- Modify: `src/routes/[...404].tsx`
- Modify: `src/styles/tailwind.css`

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
measure added later must use the `trauma-fluid-page-shell` utility from Task 3.

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

## Task 3: Replace Component-Internal Width Breakpoints

**Intent:** Convert component-internal mobile adaptations from viewport/device
breakpoints to container queries. Do not change desktop shell topology.

**Files:**

- Modify: `src/styles/tailwind.css`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/routes/highlights/index.tsx`

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

- [ ] **Step 7: Audit viewport-unit usage in component internals**

Run:

```bash
rg -n "vw|vh|vmin|vmax|svw|svh|dvw|dvh|lvw|lvh" src/components src/routes src/styles/tailwind.css
```

Expected review outcome:

- Viewport units may remain for true viewport-level shell behaviour.
- Component-internal typography, spacing, radius, and local sizing should use
  `cqi`, `cqb`, `cqmin`, or `cqmax` with `clamp()` when the containing pane is
  the relevant constraint.
- Any remaining viewport unit in component code must be listed in the PR body
  with why container query units are not the right fit.

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

## Task 4: Add Cross-Device E2E Coverage

**Intent:** Verify user-visible behaviour across narrow and mid-width layouts
without making the implementation device-model-specific.

**Files:**

- Create: `e2e/cross-device-responsive.spec.ts`
- Modify: `docs/references/design-system/verification.md`

- [ ] **Step 1: Add Playwright coverage**

Create `e2e/cross-device-responsive.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const cases = [
  { name: "phone narrow", width: 390, height: 844 },
  { name: "phone wide", width: 430, height: 932 },
  { name: "tablet portrait", width: 820, height: 1180 },
  { name: "tablet split", width: 700, height: 900 },
] as const;

for (const viewport of cases) {
  test(`keeps primary flows usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/memories");

    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open filters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add memory" })).toBeVisible();

    await page.getByRole("button", { name: "Open filters" }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/memories/memory-foundation");
    await expect(page.getByRole("article", { name: "Memory" })).toBeVisible();
    await expect(page.getByText("Memory")).toBeVisible();
  });
}
```

If the existing accessible names differ after implementation, update the test to
the actual stable labels rather than using positional selectors.

- [ ] **Step 2: Run the new E2E test**

```bash
mise exec -- bun run test:e2e -- e2e/cross-device-responsive.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Update verification docs**

In `docs/references/design-system/verification.md`, add the new E2E command
under design-system verification:

```bash
mise exec -- bun run test:e2e -- e2e/cross-device-responsive.spec.ts
```

- [ ] **Step 4: Commit E2E coverage**

```bash
git add e2e/cross-device-responsive.spec.ts docs/references/design-system/verification.md
git commit -m "test: cover cross-device responsive flows"
```

## Task 5: Update Design-System Guidance

**Intent:** Make the responsive strategy durable so future UI work does not
return to device-specific breakpoint sprawl.

**Files:**

- Modify: `docs/references/design-system/layout-and-shell.md`
- Modify: `docs/references/design-system/components-and-surfaces.md`
- Modify: `docs/references/design-system/interaction-and-accessibility.md`
- Modify: `docs/references/design-system/verification.md`

- [ ] **Step 1: Document the responsive rule**

Add a section to `layout-and-shell.md`:

```md
## Mobile And Cross-Device Responsiveness

Desktop shell dimensions are stable and should not be redesigned as part of
mobile responsive work.

Use viewport breakpoints only for global shell topology. Component internals
should respond to their container width with container queries. Prefer
`clamp()`, `min()`, and `max()` for fluid spacing, font-size, radius, and
control sizing.

Route/page shells should be constrained fluid rather than fixed-width:
combine `max-inline-size`, `inline-size`, `margin-inline`, and
`padding-inline` so layout follows writing direction instead of physical
left/right assumptions.

Component typography and spacing should use container query units when the
container is the relevant constraint: `cqi` for inline sizing, `cqb` for
block-axis spacing, `cqmin` for balanced scale, and `cqmax` only for
non-critical proportional effects. Combine these units with `clamp()`.

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
rg -n 'T''BD|implement ''later|fill in ''details' docs/references/design-system docs/workflows/task-17-front-end-refine/08-mobile-cross-device-responsive.md
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

For final handoff, include:

- Confirmation that desktop shell dimensions were not changed.
- Container-query classes and ownership added.
- Container query units used for component-local typography/spacing, with any
  remaining viewport-unit component usage justified.
- Constrained fluid page-shell utility added with logical properties.
- Flexbox audit outcome, including which flex uses were kept because they are
  local one-dimensional layouts.
- Remaining viewport breakpoint usage and why each usage is shell-topology
  rather than component-internal device targeting.
- Mobile/cross-device viewport evidence.
- Exact command outputs.
