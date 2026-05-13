# Task 17.7: Shell Spacing, Right Rail, And Row Interaction Corrections

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Keep this
> work on `refine/frontend-sample` and commit each major correction separately.

## Goal

Correct the first refine pass so the normal night theme, shell spacing, right
rail, and memory-row interaction match the refined sample direction more
closely.

## Architecture

This is a front-end-only follow-up to PR #19. The work must stay inside the
existing SolidStart/Tailwind component boundaries: token changes stay in
`src/styles/tailwind.css`, shell/right-rail changes stay in
`src/components/shell/AppShell.tsx`, and memory-row interaction changes stay in
`src/components/memories/MemoryBrowse.tsx`. Do not touch server persistence,
importer, backup, DB, browser extension, markdown rendering, or route ownership.

## Visual References

- Primary shell and memory-row reference:
  `refined_sample/screenshots/wide.png`
- Right-hand side rail reference:
  `refined_sample/screenshots/image.png`

Use `image.png` only for right-rail layout because it is an X screenshot, not a
TRAUMA sample. The goal is to borrow the right-column structure: a black column,
a rounded search pill, and separate rounded island sections.

## Files

- Modify: `src/styles/tailwind.css`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/routes/highlights/index.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify if still using the old centered pane: `src/routes/[...404].tsx`
- Modify: `tests/scripts/frontend-refine-tokens.test.ts`
- Modify: `tests/components/app-shell.test.ts`
- Modify: `e2e/browse-shell.spec.ts`

## Non-Goals

- Do not redesign the left navigation icons or labels.
- Do not add live routes for `/category`, `/tags`, `/backup`, or `/settings`.
- Do not replace the existing `AddMemoryForm`.
- Do not change highlight selection/toggle behaviour.
- Do not restore `src/styles/app.css`.

## Commit Plan

Use two commits:

1. `style: align refined shell spacing`
   - normal night background black
   - flush shell/main/right column layout
   - right rail island design
2. `feat: make memory rows clickable`
   - row-wide navigation
   - remove the `Open` button
   - update E2E route assertions

---

## Task 1: Set Normal Night Background To Pure Black

**Intent:** Normal night mode should use true black for the root/background
layer. This is the layer visible outside fixed columns and behind right-rail
island gaps.

**Files:**

- Modify: `src/styles/tailwind.css`
- Modify: `tests/scripts/frontend-refine-tokens.test.ts`

- [ ] **Step 1: Add a failing token test**

Add this test to `tests/scripts/frontend-refine-tokens.test.ts`:

```ts
it("sets normal night mode root background to pure black", () => {
  expect(tailwindCss).toMatch(
    /:root,\s*:root\[data-theme="black-dark"\]\s*{[^}]*--bg-base:\s*#000000;/s,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts
```

Expected: FAIL because `black-dark` currently sets `--bg-base: #0a0a0a`.

- [ ] **Step 3: Update the token**

In `src/styles/tailwind.css`, change only the normal night root background:

```css
:root,
:root[data-theme="black-dark"] {
  color-scheme: dark;
  --bg-base: #000000;
```

Keep `--bg-surface`, `--bg-elev`, and `--bg-sunken` as separate dark layers
unless visual verification later proves they need adjustment.

- [ ] **Step 4: Verify the token test passes**

Run:

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts
```

Expected: PASS.

---

## Task 2: Remove The Visual Gutter Between Sidebar And Main Pane

**Intent:** The refined sample does not show a separate lower layer between
left rail and main pane. The columns are adjacent; separation is handled by
borders, not by visible spacing. The current implementation visually narrows
the main pane because route frames are centered inside a wider grid cell.

**Files:**

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `src/routes/highlights/index.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Modify if needed: `src/routes/[...404].tsx`
- Modify: `tests/components/app-shell.test.ts`

- [ ] **Step 1: Add shell spacing contract checks**

Add this test to `tests/components/app-shell.test.ts`:

```ts
it("keeps desktop shell columns flush instead of centering panes inside gutters", () => {
  expect(appShellSource).toContain("grid-cols-[248px_minmax(0,840px)_360px]");
  expect(appShellSource).toContain("justify-center");
  expect(appShellSource).toContain("border-r border-trauma-border");
});
```

This locks the intended desktop shell shape: fixed left rail, fixed maximum
center pane, fixed right rail, and no `gap-*` between columns.

- [ ] **Step 2: Add route-frame gutter guards**

Extend `tests/components/app-shell.test.ts` with file reads for route surfaces:

```ts
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const highlightsRouteSource = readFileSync(
  "src/routes/highlights/index.tsx",
  "utf8",
);
const readerStylesSource = readFileSync(
  "src/components/reader/reader-styles.ts",
  "utf8",
);

it("keeps route panes full-width inside the shell column", () => {
  for (const source of [
    memoryBrowseSource,
    highlightsRouteSource,
    readerStylesSource,
  ]) {
    expect(source).not.toContain("mx-auto");
    expect(source).not.toContain("w-[min(100%,840px)]");
    expect(source).not.toContain("max-w-[920px]");
  }
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
bun run test tests/components/app-shell.test.ts
```

Expected: FAIL until shell grid and route frames are changed.

- [ ] **Step 4: Update `AppShell` desktop grid**

In `src/components/shell/AppShell.tsx`, replace the root shell class with a
flush desktop grid:

```tsx
<div class="grid min-h-screen justify-center bg-trauma-bg-base text-trauma-text-primary min-[1041px]:grid-cols-[248px_minmax(0,840px)_360px] max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[1040px]:grid-rows-[auto_1fr] max-[720px]:block">
```

Keep no `gap-*` class on the root grid. Use borders to separate columns.

- [ ] **Step 5: Update left rail sizing**

Change the left desktop aside to fill its grid cell without introducing a
gutter:

```tsx
<aside
  class={`${sideSurface} border-r border-trauma-border px-6 py-5 max-[1040px]:row-span-2 max-[1040px]:px-2.5 max-[1040px]:py-4`}
  aria-label="Primary navigation"
>
```

The left rail may keep internal padding. The forbidden thing is external space
between the rail and center pane.

- [ ] **Step 6: Update the main column separator**

Change the main element to own the right separator:

```tsx
<main class="min-w-0 border-r border-trauma-border max-[1040px]:col-start-2 max-[720px]:border-r-0">
```

Do not add `mx-auto`, `px-*`, or `gap-*` to `main`.

- [ ] **Step 7: Make route frames fill the main column**

In `src/components/memories/MemoryBrowse.tsx`, replace `pageFrame` with:

```ts
const pageFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

In `src/routes/highlights/index.tsx`, replace its `pageFrame` with the same
class string.

In `src/components/reader/reader-styles.ts`, replace `readerFrame` with:

```ts
export const readerFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
```

If `src/routes/[...404].tsx` still uses a centered `mx-auto` frame, replace it
with a full-width main-column frame:

```tsx
<section class="min-h-screen w-full bg-trauma-bg-surface px-8 py-12 max-[720px]:min-h-[calc(100vh-58px)] max-[720px]:px-5" aria-labelledby="not-found-title">
```

- [ ] **Step 8: Verify focused tests**

Run:

```bash
bun run test tests/components/app-shell.test.ts
```

Expected: PASS.

---

## Task 3: Rebuild The Right Rail As X-Style Islands

**Intent:** `refined_sample/screenshots/image.png` shows the right column as a
black rail with independent rounded islands. The rail background, island gaps,
and page background should be visually unified. Individual sections are
rounded/bordered; the whole right rail is not a single card.

**Files:**

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `tests/components/app-shell.test.ts`
- Verify visually against: `refined_sample/screenshots/image.png`

- [ ] **Step 1: Add right-rail structure tests**

Add these expectations to `tests/components/app-shell.test.ts`:

```ts
it("models the right rail as independent island sections", () => {
  expect(appShellSource).toContain("RightPanelSection");
  expect(appShellSource).toContain('aria-label="Search archive"');
  expect(appShellSource).toContain("rounded-[32px] border border-trauma-border");
  expect(appShellSource).toContain("bg-trauma-bg-base");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun run test tests/components/app-shell.test.ts
```

Expected: FAIL until `RightPanelSection` and the search pill exist.

- [ ] **Step 3: Update the right aside container**

Replace the desktop right aside class in `src/components/shell/AppShell.tsx`
with:

```tsx
<aside
  class="sticky top-0 h-screen overflow-y-auto bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden"
  aria-label="Browse filters"
>
```

Do not give the right aside `bg-trauma-bg-surface`. The right rail is a black
column; island cards carry their own border/radius.

- [ ] **Step 4: Pass search state to `FilterPanel`**

Extend `FilterPanel` props:

```ts
searchQuery: string;
onSearch: (value: string) => void;
```

Pass these from the desktop and drawer callers:

```tsx
searchQuery={query().q}
onSearch={(value) => goToFilter({ q: value })}
```

Use `Search archive` as the right-rail search accessible name so existing
`Search memories` tests remain unambiguous.

- [ ] **Step 5: Add the right-rail search pill**

At the top of `FilterPanel`, render:

```tsx
<label class="grid min-h-12 grid-cols-[22px_minmax(0,1fr)] items-center gap-3 rounded-full border border-trauma-border bg-trauma-bg-base px-4 text-trauma-text-muted focus-within:border-trauma-border-strong">
  <span class="grid place-items-center">
    <SearchIcon />
  </span>
  <input
    aria-label="Search archive"
    class="min-h-[42px] min-w-0 bg-transparent text-trauma-text-primary outline-none placeholder:text-trauma-text-placeholder"
    type="search"
    value={props.searchQuery}
    placeholder="Search"
    onInput={(event) => props.onSearch(event.currentTarget.value)}
  />
</label>
```

If `SearchIcon` is not already imported into `AppShell.tsx`, add it to the
existing icon import.

- [ ] **Step 6: Add `RightPanelSection`**

Add this local component below `FilterPanel`:

```tsx
function RightPanelSection(props: {
  children: JSX.Element;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={props.titleId}
      class="rounded-[32px] border border-trauma-border bg-trauma-bg-base p-5"
    >
      <h2 class="mb-4 text-[20px] font-extrabold" id={props.titleId}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}
```

- [ ] **Step 7: Wrap filter groups in islands**

Change `FilterPanel` from one flat list into:

```tsx
<div class="grid gap-4">
  <label>...</label>
  <RightPanelSection title="Categories" titleId={`${props.idPrefix}-category-filters-title`}>
    <div class="grid gap-2">...</div>
  </RightPanelSection>
  <RightPanelSection title="Tags" titleId={`${props.idPrefix}-tag-filters-title`}>
    <div class="grid gap-2">...</div>
  </RightPanelSection>
  <RightPanelSection title="Recent highlights" titleId={`${props.idPrefix}-highlight-shortcuts-title`}>
    <div class="grid gap-3">...</div>
  </RightPanelSection>
</div>
```

Inside those islands, keep filter buttons functional but reduce visual weight:

```tsx
class={`${buttonBase} w-full justify-start border-trauma-border bg-transparent text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
```

For highlight shortcut buttons, keep a two-line structure but avoid making each
highlight look like a full separate card inside the island:

```tsx
class="grid w-full gap-1 rounded-2xl px-3 py-2 text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink"
```

- [ ] **Step 8: Verify focused tests**

Run:

```bash
bun run test tests/components/app-shell.test.ts
```

Expected: PASS.

---

## Task 4: Remove The Memory Row `Open` Button And Make The Row Clickable

**Intent:** A memory row should behave like an X timeline item: clicking the row
opens the memory. The explicit `Open` button makes the row feel like a card
with a secondary action and should be removed.

**Files:**

- Modify: `src/components/memories/MemoryBrowse.tsx`
- Modify: `e2e/browse-shell.spec.ts`

- [ ] **Step 1: Add the E2E expectation for row-wide navigation**

In `e2e/browse-shell.spec.ts`, replace the current row-open action in
`does not navigate shell and result links to the catch-all route`:

```ts
await page.getByRole("link", { name: "Open" }).first().click();
```

with:

```ts
await page
  .getByRole("link", { name: "Open memory Reader Mode Notes" })
  .click();
```

Add a keyboard check in the same test:

```ts
await page.goto("/memories");
await page
  .getByRole("link", { name: "Open memory Reader Mode Notes" })
  .focus();
await page.keyboard.press("Enter");
await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
```

- [ ] **Step 2: Run E2E and verify it fails**

Run:

```bash
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: FAIL because the row itself is not currently exposed as the link.

- [ ] **Step 3: Update `MemoryBrowse` to navigate from the whole row**

In `MemoryBrowse`, add:

```ts
const openMemory = (memoryId: string) => {
  navigate(`/memories/${memoryId}`);
};
```

Pass it into `MemoryItem`:

```tsx
<MemoryItem
  memory={memory}
  onOpenMemory={openMemory}
  selectedHighlightId={query().highlight}
  view={query().view}
/>
```

Update `MemoryItem` props:

```ts
function MemoryItem(props: {
  memory: BrowseMemory;
  onOpenMemory: (memoryId: string) => void;
  selectedHighlightId: string;
  view: "list" | "grid";
}) {
```

- [ ] **Step 4: Replace nested title link and remove the `Open` button**

Inside `MemoryItem`, change the root article to:

```tsx
<article
  aria-label={`Open memory ${props.memory.title}`}
  class={`${cardBase} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent ${props.view === "grid" ? "min-h-[310px] border-r border-trauma-border max-[720px]:min-h-0 max-[720px]:border-r-0" : ""}`}
  role="link"
  tabIndex={0}
  onClick={() => props.onOpenMemory(props.memory.id)}
  onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onOpenMemory(props.memory.id);
    }
  }}
>
```

Replace the title link:

```tsx
<h2 class={cardTitle}>{props.memory.title}</h2>
```

Delete the trailing `Open` `<A>` entirely.

- [ ] **Step 5: Stop row navigation from the kebab action**

Change the kebab button to stop propagation:

```tsx
<button
  type="button"
  class="grid size-9 place-items-center rounded-full text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-text-primary"
  aria-label={`Actions for ${props.memory.title}`}
  onClick={(event) => event.stopPropagation()}
>
  <KebabIcon />
</button>
```

- [ ] **Step 6: Verify the row interaction**

Run:

```bash
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: PASS.

---

## Task 5: Focused And Full Verification

**Intent:** This is a visual correction, so unit tests are not enough. Verify
desktop/tablet/mobile and the route surfaces that were affected.

**Files:**

- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run focused static/unit tests**

Run:

```bash
bun run test tests/scripts/frontend-refine-tokens.test.ts tests/components/app-shell.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused E2E**

Run:

```bash
bun run test:e2e -- e2e/browse-shell.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
bun run verify
bun run test:e2e
```

Expected: PASS.

- [ ] **Step 4: Visual audit with screenshots**

Start the fixture dev server:

```bash
HOST=127.0.0.1 PORT=4317 TRAUMA_BROWSE_FIXTURES=1 TRAUMA_CONFIG_PATH=.trauma/e2e/trauma.config.json TRAUMA_HMR_PORT=24691 bun --bun x vinxi dev
```

Using Playwright or the in-app browser, inspect:

- `1440x1000` `/memories`
- `1440x1000` `/memories?view=grid`
- `1440x1000` `/highlights`
- `900x900` `/memories`
- `390x844` `/memories`

Required visual observations:

- Normal night page background is true black.
- Left rail and main pane touch directly; there is no visible lower-layer
  gutter between them.
- The center pane fills its shell column and is not `mx-auto` centered.
- Right rail background and island gaps are visually unified.
- Right rail sections are separate rounded islands, matching
  `refined_sample/screenshots/image.png` in structure.
- Memory rows no longer show an `Open` button.
- Clicking the row body opens the memory.
- Mobile top bar and filter drawer still fit without button text overflow.

- [ ] **Step 5: Commit and push**

If Task 1-3 were implemented together:

```bash
git add src/styles/tailwind.css src/components/shell/AppShell.tsx src/components/memories/MemoryBrowse.tsx src/routes/highlights/index.tsx src/components/reader/reader-styles.ts src/routes/[...404].tsx tests/scripts/frontend-refine-tokens.test.ts tests/components/app-shell.test.ts
git commit -m "style: align refined shell spacing"
```

Then commit row interaction:

```bash
git add src/components/memories/MemoryBrowse.tsx e2e/browse-shell.spec.ts
git commit -m "feat: make memory rows clickable"
```

Push to the existing PR branch:

```bash
git push origin refine/frontend-sample
```

If the ECC pre-push hook repeats the known nested-git false failure, rerun the
failing command outside the hook. Only use `--no-verify` when the same command
passes normally and `bun run verify` plus `bun run test:e2e` have passed.

## Acceptance Criteria

- `black-dark` normal night mode uses `#000000` as `--bg-base`.
- Desktop shell columns are adjacent and separated only by borders.
- Route frames no longer center themselves inside a wider main grid cell.
- Right rail is a black column with rounded island sections, not a single card
  and not a plain flat list.
- Memory rows open on full-row click and keyboard activation.
- No `Open` button remains in memory rows.
- Existing browse query/filter/highlight behaviours still pass E2E.
- The PR branch contains the two follow-up commits and no unrelated files.
