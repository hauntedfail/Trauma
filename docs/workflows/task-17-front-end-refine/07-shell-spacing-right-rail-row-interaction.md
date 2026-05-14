# Task 17.7: Shell Spacing, Right Rail, And Row Interaction Correction

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this workflow task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Correct the first front-end refine pass so TRAUMA matches the refined sample's
desktop shell more closely: pure black normal night mode, no visual gutter
between the left rail and main pane, X-style right rail islands, and
whole-row memory navigation without an explicit `Open` button.

## Architecture

This is a UI-only correction pass. Keep SolidStart route/data ownership exactly
where it is today and express the refined surfaces with Tailwind utilities and
small component-local class constants. The right rail should become a shell
composition concern in `AppShell`; memory row navigation should stay inside the
browse surface.

## Tech Stack

- SolidStart routes and `@solidjs/router` navigation.
- Tailwind v4 token utilities from `src/styles/tailwind.css`.
- Vitest source-contract tests for class and token invariants.
- Playwright E2E tests for route navigation and keyboard reachability.

---

## Worker Contract

- Work on a `refine/*` branch. If a front-end refine branch already exists,
  branch from that target instead of `main` so this correction reviews against
  the in-progress UI work.
- Do not modify server persistence, importer, backup, browser extension,
  migration, or SQLite code.
- Do not reintroduce `src/styles/app.css`.
- Do not create broad global component selectors such as `.right-panel`,
  `.memory-row`, or `.reader-page`.
- Do not make this a pixel-perfect clone of X. Use the sample and screenshot as
  layout direction, while keeping TRAUMA copy, routes, data, and accessibility.
- If `refined_sample/screenshots/image.png` is missing, stop and request the
  screenshot rather than guessing the right rail composition.

## Visual Intent

The target desktop shell has three touching columns on one theme background.
Normal night uses a pure black page; other themes use their own base token. The
left rail and main pane are separated by borders, not by a visible background
gutter. The main pane fills its assigned grid column; it must not remain a
centered `mx-auto` route card inside the shell.

The right rail differs from the left rail. It is a base-colour column that
contains separate rounded islands, not a search panel. Each island has a thin
border, large-radius corners, internal padding, and transparent or lightly
tinted controls. The space between islands reads as the same page background,
not as a contrasting panel. Browse search remains route-owned inside the main
pane.

Memory rows behave like timeline items. The row itself opens the memory. There
is no standalone `Open` button competing with the row body. Keyboard users must
be able to focus the row link and activate it with Enter.

## Source References

- `refined_sample/app.jsx`: shell, right rail rhythm, and row interaction
  direction.
- `refined_sample/styles.css`: source spacing and radius vocabulary to translate
  into Tailwind.
- `refined_sample/colors_and_type.css`: black theme and token values.
- `refined_sample/screenshots/image.png`: right rail screenshot reference.
- `docs/workflows/task-17-front-end-refine/03-shell-navigation-and-theme.md`
- `docs/workflows/task-17-front-end-refine/04-memory-browse-and-highlight-surfaces.md`
- `docs/workflows/task-17-front-end-refine/06-visual-verification-and-handoff.md`

## File Ownership

Primary files:

- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/routes/highlights/index.tsx`
- `src/components/reader/reader-styles.ts`
- `src/routes/[...404].tsx`
- `tests/scripts/frontend-refine-tokens.test.ts`
- `tests/components/app-shell.test.ts`
- `e2e/browse-shell.spec.ts`

Do not edit files outside this list unless a failing test proves the correction
needs a boundary adjustment. If that happens, document the extra file in the PR
body with the reason.

## Task 1: Lock Pure Black Night Mode

**Intent:** The normal night theme is the app's default refined look. Its base
background must be exactly `#000000`; near-black values create the unwanted
gutter effect when columns do not fully cover the viewport.

**Files:**

- Modify: `src/styles/tailwind.css`
- Create or modify: `tests/scripts/frontend-refine-tokens.test.ts`

- [ ] **Step 1: Add the failing token contract test**

If `tests/scripts/frontend-refine-tokens.test.ts` does not exist, create it with
this complete content:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");

describe("frontend refine token contract", () => {
  it("sets normal night mode root background to pure black", () => {
    expect(tailwindCss).toMatch(
      /:root,\s*:root\[data-theme="black-dark"\]\s*{[^}]*--bg-base:\s*#000000;/s,
    );
  });
});
```

If the file already exists, add only the `sets normal night mode root background
to pure black` test and keep existing assertions.

- [ ] **Step 2: Run the focused test and confirm it fails before code changes**

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts
```

Expected before implementation: FAIL because the normal night token is missing
or uses a near-black value such as `#0a0a0a`.

- [ ] **Step 3: Set the black-dark base token**

In `src/styles/tailwind.css`, make the default/black-dark selector use pure
black:

```css
:root,
:root[data-theme="black-dark"] {
  color-scheme: dark;
  --bg-base: #000000;
}
```

Keep the rest of the existing black-dark tokens intact. Do not change
`paper-black-dark`; paper mode may keep a softer surface if Task 17.1 defined
one.

- [ ] **Step 4: Verify the token contract passes**

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the token correction**

```bash
git add src/styles/tailwind.css tests/scripts/frontend-refine-tokens.test.ts
git commit -m "style: set refined night background to black"
```

## Task 2: Remove The Desktop Shell Gutter

**Intent:** The shell columns should touch like the reference. Borders define
column separation. Route panes must fill the main column instead of becoming
centered cards with their own outer margins.

**Files:**

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/routes/highlights/index.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify: `src/routes/[...404].tsx`
- Create or modify: `tests/components/app-shell.test.ts`

- [ ] **Step 1: Add shell spacing source-contract tests**

Create `tests/components/app-shell.test.ts` with this complete content if the
file does not exist. If it already exists, add these tests without removing
existing coverage.

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShell = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const memoryBrowse = readFileSync("src/components/memories/MemoryBrowse.tsx", "utf8");
const highlightsRoute = readFileSync("src/routes/highlights/index.tsx", "utf8");
const readerStyles = readFileSync("src/components/reader/reader-styles.ts", "utf8");
const notFoundRoute = readFileSync("src/routes/[...404].tsx", "utf8");

describe("refined shell layout contract", () => {
  it("uses flush desktop shell columns without a gutter", () => {
    expect(appShell).toContain("justify-center bg-trauma-bg-base");
    expect(appShell).toContain("min-[1041px]:grid-cols-[248px_minmax(0,840px)_360px]");
    expect(appShell).toContain("border-r border-trauma-border");
    expect(appShell).not.toContain("grid-cols-[minmax(188px,248px)_minmax(0,1fr)_minmax(248px,328px)]");
  });

  it("lets route panes fill the shell main column", () => {
    for (const [name, source] of [
      ["MemoryBrowse", memoryBrowse],
      ["Highlights", highlightsRoute],
      ["Reader", readerStyles],
      ["NotFound", notFoundRoute],
    ] as const) {
      expect(source, `${name} should not center itself inside the shell`).not.toContain("mx-auto");
      expect(source, `${name} should not clamp to the old 840px route card`).not.toContain(
        "w-[min(100%,840px)]",
      );
      expect(source, `${name} should not keep the old reader max-width frame`).not.toContain(
        "max-w-[920px]",
      );
    }
  });
});
```

- [ ] **Step 2: Run the shell spacing tests and confirm they fail**

```bash
bun run test tests/components/app-shell.test.ts
```

Expected before implementation: FAIL because at least one source still contains
old centered-pane classes or the old desktop shell grid.

- [ ] **Step 3: Update the shell grid and column borders**

In `src/components/shell/AppShell.tsx`, replace only the class strings for the
root grid and desktop column surfaces in this step. Keep the existing
`MobileTopBar`, `FilterPanel`, drawer, and composer children in place.

Root grid class:

```tsx
<div class="grid min-h-screen justify-center bg-trauma-bg-base text-trauma-text-primary min-[1041px]:grid-cols-[248px_minmax(0,840px)_360px] max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[1040px]:grid-rows-[auto_1fr] max-[720px]:block">
```

Left rail class:

```tsx
<aside
  class={`${sideSurface} border-r border-trauma-border px-6 py-5 max-[1040px]:row-span-2 max-[1040px]:px-2.5 max-[1040px]:py-4`}
  aria-label="Primary navigation"
>
```

Main column class:

```tsx
<main class="min-w-0 border-r border-trauma-border max-[1040px]:col-start-2 max-[720px]:border-r-0">
```

Right rail class:

```tsx
<aside
  class="sticky top-0 h-screen overflow-y-auto bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden"
  aria-label="Browse filters"
>
```

If `sideSurface` includes `bg-trauma-bg-surface`, use it only for the left rail.
The right rail must use the explicit black-base class above.

- [ ] **Step 4: Make route panes fill the main column**

Replace route frame constants so they no longer center themselves inside the
shell.

In `src/components/memories/MemoryBrowse.tsx`:

```ts
const pageFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

In `src/routes/highlights/index.tsx`:

```ts
const pageFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

In `src/components/reader/reader-styles.ts`:

```ts
export const readerFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

In `src/routes/[...404].tsx`, use the same full-width frame direction:

```tsx
<section
  class="min-h-screen w-full bg-trauma-bg-surface px-8 py-12 max-[720px]:min-h-[calc(100vh-58px)] max-[720px]:px-5"
  aria-labelledby="not-found-title"
>
```

- [ ] **Step 5: Verify shell spacing tests pass**

```bash
bun run test tests/components/app-shell.test.ts
```

Expected: PASS.

## Task 3: Rebuild The Right Rail As Rounded Islands

**Intent:** The right rail should not reuse the left rail surface. It should be
a base-colour column with separate rounded island sections for categories,
tags, recent highlights, and optional route-specific content such as the reader
TOC.

**Files:**

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `tests/components/app-shell.test.ts`
- E2E coverage remains in `e2e/browse-shell.spec.ts`

- [ ] **Step 1: Add right rail source-contract tests**

Append these tests to `tests/components/app-shell.test.ts`:

```ts
describe("refined right rail contract", () => {
  it("renders the right rail as rounded islands without search", () => {
    expect(appShell).toContain("function RightPanelSection");
    expect(appShell).toContain("rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5");
    expect(appShell).toContain("Recent highlights");
    expect(appShell).not.toContain("aria-label=\"Search archive\"");
  });

  it("keeps right rail controls on the base rail surface", () => {
    expect(appShell).toContain("hover:bg-trauma-bg-tint");
    expect(appShell).not.toContain("filter-section");
    expect(appShell).not.toContain("bg-white text-left text-[#263126]");
  });
});
```

- [ ] **Step 2: Run the right rail tests and confirm they fail**

```bash
bun run test tests/components/app-shell.test.ts
```

Expected before implementation: FAIL because the right rail still uses the old
`filter-section` structure or white button treatment.

- [ ] **Step 3: Keep search route-owned**

Do not add a right-rail search field or search icon. Memory search remains in
the browse route header and continues to update the route query state from the
main pane. `FilterPanel` should only receive category, tag, highlight, and
route-specific right-rail content inputs.

- [ ] **Step 4: Replace the right rail structure**

Inside `FilterPanel`, use this top-level structure:

```tsx
return (
  <div class="grid gap-4">
    <RightPanelSection title="Categories" titleId={`${props.idPrefix}-category-filters-title`}>
      <div class="grid gap-2">
        <For each={props.categories}>
          {(category) => (
            <button
              class={`${buttonBase} w-full justify-start border-trauma-border bg-transparent text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
              type="button"
              aria-pressed={props.activeCategory === category.id}
              onClick={() => props.onSelectCategory(category)}
            >
              {category.name}
            </button>
          )}
        </For>
      </div>
    </RightPanelSection>

    <RightPanelSection title="Tags" titleId={`${props.idPrefix}-tag-filters-title`}>
      <div class="grid gap-2">
        <For each={props.tags}>
          {(tag) => (
            <button
              class={`${buttonBase} w-full justify-start border-trauma-border bg-transparent text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
              type="button"
              aria-pressed={props.activeTag === tag.id}
              onClick={() => props.onSelectTag(tag)}
            >
              {tag.name}
            </button>
          )}
        </For>
      </div>
    </RightPanelSection>

    <RightPanelSection title="Recent highlights" titleId={`${props.idPrefix}-highlight-shortcuts-title`}>
      <div class="grid gap-2">
        <For each={props.highlights}>
          {(highlight) => (
            <button
              class="grid w-full gap-1 rounded-2xl px-3 py-2 text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink"
              type="button"
              aria-pressed={props.activeHighlight === highlight.id}
              onClick={() => props.onSelectHighlight(highlight)}
            >
              <span class="wrap-anywhere">{highlight.text}</span>
              <small class="text-xs font-semibold text-trauma-text-muted">{highlight.prefix}</small>
            </button>
          )}
        </For>
      </div>
    </RightPanelSection>
  </div>
);
```

Add this helper below `FilterPanel`:

```tsx
function RightPanelSection(props: {
  children: JSX.Element;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={props.titleId}
      class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5"
    >
      <h2 class="mb-4 text-[20px] font-extrabold" id={props.titleId}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}
```

- [ ] **Step 5: Verify right rail tests and existing E2E filters**

```bash
bun run test tests/components/app-shell.test.ts
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: both commands PASS. The E2E test
`renders category, tag, and highlight shortcut sections in the right panel`
must still find the three headings and filter controls.

- [ ] **Step 6: Commit the shell and right rail correction**

```bash
git add src/components/shell/AppShell.tsx src/components/memories/MemoryBrowse.tsx src/routes/highlights/index.tsx src/components/reader/reader-styles.ts src/routes/[...404].tsx tests/components/app-shell.test.ts
git commit -m "style: align refined shell and right rail"
```

## Task 4: Make Memory Rows The Navigation Target

**Intent:** The browse row should be the clickable affordance. Removing the
small `Open` button makes list scanning cleaner and matches the timeline
interaction model. Use a real link for semantics instead of an `article` with a
click handler whenever the row has no nested interactive controls.

**Files:**

- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `e2e/browse-shell.spec.ts`

- [ ] **Step 1: Update E2E navigation assertions first**

In `e2e/browse-shell.spec.ts`, replace the old `Open` button/link click inside
`does not navigate shell and result links to the catch-all route`:

```ts
await page.goto("/memories");
await page.getByRole("link", { name: "Open memory Reader Mode Notes" }).click();
await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
await expect(page.locator("#reader-state-title")).toBeVisible();
await expect(page.getByText("Page not found")).toHaveCount(0);
```

Add a keyboard activation check in the same test after the mouse click block:

```ts
await page.goto("/memories");
await page.getByRole("link", { name: "Open memory Reader Mode Notes" }).focus();
await page.keyboard.press("Enter");
await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
await expect(page.locator("#reader-state-title")).toBeVisible();
```

- [ ] **Step 2: Run the focused E2E test and confirm it fails**

```bash
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected before implementation: FAIL because the memory row is not exposed as a
link named `Open memory Reader Mode Notes`.

- [ ] **Step 3: Replace the row `Open` button with a whole-row link**

In `src/components/memories/MemoryBrowse.tsx`, import `A` from
`@solidjs/router` if the file does not already import it:

```ts
import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
```

In `MemoryItem`, replace the root `<article>` with a root `<A>`:

```tsx
return (
  <A
    aria-label={`Open memory ${props.memory.title}`}
    class={`${cardBase} cursor-pointer no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent ${
      props.view === "grid"
        ? "min-h-[310px] border-r border-trauma-border max-[720px]:min-h-0 max-[720px]:border-r-0"
        : ""
    }`}
    href={`/memories/${props.memory.id}`}
  >
    <header class="flex items-start justify-between gap-4 max-[720px]:grid">
      <div>
        <p class={subduedText}>{props.memory.capturedAt}</p>
        <h2 class={cardTitle}>{props.memory.title}</h2>
      </div>
    </header>
    <p class={`${subduedText} wrap-anywhere`}>{props.memory.url}</p>
    <p class="mb-0 leading-relaxed">{props.memory.description}</p>
    <div class="flex flex-wrap gap-2" aria-label={`${props.memory.title} filters`}>
      <For each={props.memory.categories}>
        {(category) => (
          <span class="rounded-full border border-trauma-border bg-trauma-bg-tint px-2.5 py-1 text-xs font-bold text-trauma-text-primary">
            {category.name}
          </span>
        )}
      </For>
      <For each={props.memory.tags}>
        {(tag) => (
          <span class="rounded-full border border-trauma-border bg-trauma-bg-tint px-2.5 py-1 text-xs font-bold text-trauma-text-primary">
            #{tag.name}
          </span>
        )}
      </For>
    </div>
    <Show when={displayHighlight()}>
      {(highlight) => (
        <blockquote class={highlightQuote}>
          <span>{highlight().prefix}</span>
          <mark class={highlightMark}>{highlight().text}</mark>
          <span>{highlight().suffix}</span>
        </blockquote>
      )}
    </Show>
  </A>
);
```

Remove the trailing `Open` anchor or button from the row. Do not put another
interactive control inside the row link. If future actions are needed, place
them outside this root link in a wrapper component.

- [ ] **Step 4: Verify row navigation**

```bash
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: PASS. The test should prove shell links, row click navigation,
keyboard row navigation, and highlight source links all avoid the catch-all
route.

- [ ] **Step 5: Commit the row interaction correction**

```bash
git add src/components/memories/MemoryBrowse.tsx e2e/browse-shell.spec.ts
git commit -m "feat: make memory rows open memories"
```

## Task 5: Full Verification And Visual QA

**Intent:** This correction is visual and interaction-heavy. Unit/source tests
catch drift, but final acceptance requires a real browser pass.

**Files:**

- Modify: PR body only, unless verification exposes a concrete defect.

- [ ] **Step 1: Run focused verification**

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts tests/components/app-shell.test.ts
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: both commands PASS.

- [ ] **Step 2: Run full project verification**

```bash
bun run verify
bun run test:e2e
```

Expected: both commands PASS. If local Playwright fails for a host-specific
browser runtime issue, capture the exact error and use CI as the browser
authority only after `bun run verify` passes locally.

- [ ] **Step 3: Start the fixture app for visual inspection**

Use fixture mode so the browse, highlight, and reader routes have deterministic
content:

```bash
HOST=127.0.0.1 PORT=4317 TRAUMA_BROWSE_FIXTURES=1 TRAUMA_CONFIG_PATH=.trauma/e2e/trauma.config.json TRAUMA_HMR_PORT=24691 bun --bun x vinxi dev
```

Keep this process running only for the visual pass. Stop it before final
handoff.

- [ ] **Step 4: Inspect required routes and viewports**

Check these route/viewport pairs with the in-app browser or Playwright
screenshots:

- `1440x1000` `/memories`
- `1440x1000` `/memories?view=grid`
- `1440x1000` `/highlights`
- `900x900` `/memories`
- `390x844` `/memories`

Required visual observations:

- `black-dark` normal night mode uses a true black page background.
- Left rail and main pane touch; no contrasting gutter is visible between them.
- Main route panes fill the center shell column rather than appearing as
  centered route cards.
- Right rail background uses the same base token and contains separate rounded
  category, tag, and highlight islands, plus reader TOC only on concrete memory
  routes.
- Island spacing and surrounding rail background are visually unified.
- Memory rows do not display an `Open` button.
- Clicking the row body opens the memory.
- Mobile layout has no horizontal overflow and no text overlap.

- [ ] **Step 5: Push without rewriting remote history**

```bash
git status --short
git push origin HEAD
```

If a local hook has an environment-specific failure after the required
verification commands passed, report the exact hook failure before using
`--no-verify`. Never force-push or rewrite the remote ref.

## Acceptance Criteria

- Normal night mode base background is exactly `#000000`.
- Desktop shell uses flush columns with borders, not background gutters.
- `MemoryBrowse`, `/highlights`, reader, and not-found route panes do not use
  `mx-auto`, `w-[min(100%,840px)]`, or `max-w-[920px]` as shell frames.
- Right rail contains rounded island sections for categories, tags, and recent
  highlights, with no right-rail search field.
- Existing category, tag, highlight, search, and view query behaviours still
  work.
- Memory rows have no explicit `Open` button and are reachable as row-level
  links.
- Focus and Enter activation work for the memory row link.
- Focused tests, full verification, and visual QA evidence are recorded in the
  PR body.

## PR Handoff Notes

The PR body should include:

- Branch name and base branch.
- Confirmation that this was a UI-only correction.
- Sample references used, including `refined_sample/screenshots/image.png`.
- Verification commands and outcomes.
- Visual QA routes and viewport sizes checked.
- Any hook or local browser limitations, with exact error output.
