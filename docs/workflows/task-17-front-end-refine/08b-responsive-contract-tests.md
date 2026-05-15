# Task 17.8b: Responsive Contract Tests

## Intent

Lock the strategic shift before changing UI code: components should gain
container-query affordances, and desktop dimensions must stay unchanged.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting.

## Files

- Create: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `tests/components/app-shell.test.ts`

## Steps

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
const markdownRendererSource = readFileSync(
  "src/server/reader/markdown-renderer.ts",
  "utf8",
);
const traumaMarkSource = readFileSync(
  "src/components/brand/TraumaMark.tsx",
  "utf8",
);
const highlightsRouteSource = readFileSync(
  "src/routes/highlights/index.tsx",
  "utf8",
);
const notFoundRouteSource = readFileSync("src/routes/[...404].tsx", "utf8");

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

  it("uses mobile viewport units instead of 100vh for mobile full-height surfaces", () => {
    expect(tailwindCss).toContain(".trauma-mobile-stable-viewport");
    expect(tailwindCss).toContain("min-block-size: 100svh");
    expect(tailwindCss).toContain(".trauma-mobile-dynamic-viewport");
    expect(tailwindCss).toContain("block-size: 100dvh");
    expect(tailwindCss).toContain(".trauma-mobile-large-viewport");
    expect(tailwindCss).toContain("block-size: 100lvh");

    for (const source of [
      memoryBrowseSource,
      readerStylesSource,
      highlightsRouteSource,
      notFoundRouteSource,
    ]) {
      expect(source).not.toContain("100vh");
    }
  });

  it("centralizes safe-area insets as layout tokens and utilities", () => {
    expect(tailwindCss).toContain(
      "--trauma-layout-safe-area-top: env(safe-area-inset-top, 0px)",
    );
    expect(tailwindCss).toContain(
      "--trauma-layout-safe-area-right: env(safe-area-inset-right, 0px)",
    );
    expect(tailwindCss).toContain(
      "--trauma-layout-safe-area-bottom: env(safe-area-inset-bottom, 0px)",
    );
    expect(tailwindCss).toContain(
      "--trauma-layout-safe-area-left: env(safe-area-inset-left, 0px)",
    );
    expect(tailwindCss).toContain(".trauma-safe-area-shell");
    expect(tailwindCss).toContain(".trauma-safe-area-inline");
    expect(tailwindCss).toContain(".trauma-safe-area-bottom");
    expect(appShellSource).toContain("trauma-safe-area-");

    for (const source of [
      appShellSource,
      memoryBrowseSource,
      readerStylesSource,
      highlightsRouteSource,
      notFoundRouteSource,
    ]) {
      expect(source).not.toContain("env(safe-area-inset-");
    }
  });

  it("uses logical properties for constrained fluid page shells", () => {
    expect(tailwindCss).toContain(".trauma-fluid-page-shell");
    expect(tailwindCss).toContain("max-inline-size");
    expect(tailwindCss).toContain("margin-inline: auto");
    expect(tailwindCss).toContain("padding-inline: clamp(");
    expect(tailwindCss).not.toContain("width: 840px");
  });

  it("uses CSS Grid for structural layout", () => {
    expect(appShellSource).toContain("grid");
    expect(tailwindCss).toContain(".trauma-memory-grid");
    expect(tailwindCss).toContain("grid-template-columns");
    expect(tailwindCss).not.toContain(".trauma-route-surface {\n  display: flex");
    expect(tailwindCss).not.toContain(".trauma-reader-surface {\n  display: flex");
  });

  it("keeps tablet and mobile shell chrome clean and non-duplicated", () => {
    expect(appShellSource).toContain("BrandHomeLink");
    expect(appShellSource).toContain("PhoneTabBar");
    expect(appShellSource).toContain("phoneTabItems");
    expect(appShellSource).toContain('aria-label="Primary tabs"');
    expect(appShellSource).toContain("bottom-0");
    expect(appShellSource).toContain("trauma-safe-area-bottom");
    expect(appShellSource).toContain("showLabel={true}");
    expect(appShellSource).toContain("showLabel={false}");
    expect(appShellSource).toContain("railIconSlot");
    expect(appShellSource).toContain("railPopoverPanel");
    expect(appShellSource).toContain("max-[1040px]:hidden");
    expect(appShellSource).toContain("max-[720px]:grid");
    expect(appShellSource).not.toContain("isFiltersOpen");
    expect(appShellSource).not.toContain("setIsFiltersOpen");
    expect(appShellSource).not.toContain("isNavigationOpen");
    expect(appShellSource).not.toContain("setIsNavigationOpen");
    expect(appShellSource).not.toContain('aria-label="Open navigation"');
    expect(appShellSource).not.toContain('aria-label="Open filters"');
    expect(appShellSource).not.toContain('<Drawer ariaLabel="Filters"');
    expect(appShellSource).not.toContain('<Drawer ariaLabel="Navigation"');
    expect(appShellSource).not.toContain("FilterNavButton");
  });

  it("does not rely on CSS-only responsive image sizing", () => {
    expect(readerStylesSource).toContain("prose-img:max-w-full");
    expect(markdownRendererSource).toContain("srcset");
    expect(markdownRendererSource).toContain("sizes");
    expect(markdownRendererSource).toContain("picture");
    expect(markdownRendererSource).toContain("source");
    expect(markdownRendererSource).toContain("decoding");
    expect(traumaMarkSource).toContain("<picture");
    expect(traumaMarkSource).toContain("<source");
  });

  it("uses media queries for capabilities and preferences only", () => {
    expect(tailwindCss).toContain("@media (hover: hover) and (pointer: fine)");
    expect(tailwindCss).toContain("@media (pointer: coarse)");
    expect(tailwindCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tailwindCss).toContain("@media (forced-colors: active)");
    expect(tailwindCss).toContain("@media (prefers-contrast: more)");
    expect(tailwindCss).toContain("@media (orientation: landscape)");
    expect(tailwindCss).not.toMatch(/@media\s*\([^)]*(min-width|max-width|device-width|device-height)/i);
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
