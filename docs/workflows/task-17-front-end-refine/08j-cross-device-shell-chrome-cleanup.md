# Task 17.8j: Cross-Device Shell Chrome Cleanup

## Intent

Preserve the existing desktop design and primary design system while making the
shell render cleanly on tablet, phone, split-view, and other cross-device
layouts.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this after
[08d Component Responsive Implementation](08d-component-responsive-implementation.md).

## Files

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `tests/components/app-shell.test.ts`
- Modify: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `e2e/cross-device-responsive.spec.ts`
- Modify: `docs/references/design-system/layout-and-shell.md`
- Modify: `docs/references/design-system/components-and-surfaces.md`

## Rules

- Do not redesign desktop. Desktop keeps left rail, main pane, and right rail.
- Tablet keeps the left pane but renders it as an icon-only rail.
- Tablet header follows desktop shell behaviour: no mobile top header, no
  duplicated brand group, and no filter button.
- Phone uses a minimal logo-only navigation trigger. It must not render TRAUMA
  brand text in the header.
- Tablet and phone do not display a right rail, filter button, or filter drawer.
- Delete the filter drawer path instead of hiding a broken menu.
- Align the brand mark, route icons, disabled icons, theme icon, add-memory
  icon, archive icon, and kebab icon to a shared rail icon slot.
- Theme popover must render cleanly from the icon rail and layer above the main
  pane. The add-memory composer popup is the reference for working layering.

## Steps

- [ ] **Step 1: Add shell chrome source-contract tests**

In `tests/components/app-shell.test.ts`, add:

```ts
it("keeps tablet shell icon-only without duplicate header brand chrome", () => {
  expect(appShellSource).toContain("BrandHomeLink");
  expect(appShellSource).toContain("showLabel={true}");
  expect(appShellSource).toContain("showLabel={false}");
  expect(appShellSource).toContain("railIconSlot");
  expect(appShellSource).toContain("max-[1040px]:hidden");
  expect(appShellSource).toContain("max-[720px]:grid");
  expect(appShellSource).not.toContain("max-[1040px]:grid max-[720px]");
  expect(appShellSource).not.toContain('aria-label="Open filters"');
});

it("removes the mobile/tablet filter drawer path", () => {
  expect(appShellSource).not.toContain("isFiltersOpen");
  expect(appShellSource).not.toContain("setIsFiltersOpen");
  expect(appShellSource).not.toContain("openFilters");
  expect(appShellSource).not.toContain("FilterNavButton");
  expect(appShellSource).not.toContain("filterNavItems");
  expect(appShellSource).not.toContain('<Drawer ariaLabel="Filters"');
  expect(appShellSource).toContain("RightRailFilters");
});

it("anchors theme popover from the rail above route panes", () => {
  expect(appShellSource).toContain("railPopoverRoot");
  expect(appShellSource).toContain("railPopoverPanel");
  expect(appShellSource).toContain("max-[1040px]:left-full");
  expect(appShellSource).toContain("max-[1040px]:top-0");
  expect(appShellSource).toContain("z-50");
  expect(appShellSource).toContain("animate-trauma-pop-bounce");
});
```

The responsive contract test in
`tests/components/mobile-responsive-contract.test.ts` should include the shorter
shell-chrome invariant from
[08b Responsive Contract Tests](08b-responsive-contract-tests.md).

- [ ] **Step 2: Refactor brand rendering into one reusable helper**

In `src/components/shell/AppShell.tsx`, add:

```tsx
const railIconSlot = "grid size-10 place-items-center";

function BrandHomeLink(props: {
  class?: string;
  markSize?: number;
  onNavigate?: () => void;
  showLabel: boolean;
}) {
  return (
    <A
      aria-label="TRAUMA home"
      class={`inline-grid h-[52px] w-max grid-cols-[40px_minmax(0,1fr)] items-center gap-[18px] rounded-full px-2.5 text-[22px] font-extrabold max-[1040px]:mx-auto max-[1040px]:size-[52px] max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:px-0 ${props.class ?? ""}`}
      href="/memories"
      onClick={props.onNavigate}
    >
      <span class={railIconSlot}>
        <TraumaMark size={props.markSize ?? 30} />
      </span>
      <Show when={props.showLabel}>
        <span class="max-[1040px]:hidden">TRAUMA</span>
      </Show>
    </A>
  );
}
```

Use it in `NavigationContent`:

```tsx
<BrandHomeLink onNavigate={props.onNavigate} showLabel={true} />
```

Use logo-only rendering in the phone top bar:

```tsx
<button
  aria-label="Open navigation"
  class={`${iconButton} trauma-safe-area-inline`}
  type="button"
  onClick={props.onOpenNavigation}
>
  <span class={railIconSlot}>
    <TraumaMark size={30} />
  </span>
</button>
```

Do not render a separate `<A>` brand group or TRAUMA text inside the responsive
top bar.

- [ ] **Step 3: Align tablet rail icon slots**

Update shared nav/button constants so tablet icon-only rail items use the same
slot size and visual center:

```ts
const railIconSlot = "grid size-10 place-items-center";
const compactRailItem =
  "max-[1040px]:mx-auto max-[1040px]:size-[52px] max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:gap-0 max-[1040px]:px-0";
const navItemBase =
  `group grid min-h-12 w-max max-w-full grid-cols-[40px_minmax(0,1fr)] items-center gap-[18px] rounded-full px-2.5 py-2.5 pr-[18px] text-[19px] font-medium leading-[1.22] text-trauma-text-primary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary ${compactRailItem}`;
```

Use `<span class={railIconSlot}>` for route links, disabled buttons,
`ThemeNavButton`, `AddMemoryComposerButton`, the local archive icon, and the
brand helper. Text labels should use `max-[1040px]:hidden`, not visual offsets
or mismatched spacing hacks.

- [ ] **Step 4: Remove the filter drawer and redundant filter controls**

In `src/components/shell/AppShell.tsx`, delete:

- `const [isFiltersOpen, setIsFiltersOpen] = createSignal(false);`
- `openFilters`
- all `setIsFiltersOpen(...)` calls
- `filterNavItems`
- `FilterNavButton`
- `<Drawer ariaLabel="Filters" ...>`
- `MobileTopBar` `onOpenFilters` prop
- the `Open filters` button

Keep desktop filter content by renaming `FilterPanel` to `RightRailFilters`:

```tsx
<RightRailFilters
  activeCategory={query().category}
  activeHighlight={query().highlight}
  activeTag={query().tag}
  categories={categories()}
  highlights={highlights()}
  idPrefix="desktop"
  onSelectCategory={(category) => toggleFilter("category", category.id)}
  onSelectHighlight={(highlight) => goToHighlight(highlight.id)}
  onSelectTag={(tag) => toggleFilter("tag", tag.id)}
  tags={tags()}
/>
```

`goToFilter` and `goToHighlight` should only navigate. They should not close a
deleted filter drawer.

- [ ] **Step 5: Restrict responsive top bar to phone layout**

`MobileTopBar` should render only for phone/narrow layout:

```tsx
<header class="sticky top-0 z-10 hidden min-h-[58px] grid-cols-[64px_minmax(0,1fr)] items-center border-b border-trauma-border bg-trauma-bg-surface/95 px-3 py-2 backdrop-blur max-[720px]:grid">
  ...
</header>
```

Tablet layout must not render the top bar. Tablet uses the visible icon-only
left pane and main pane. Do not place a brand group or filter button in the
tablet header.

- [ ] **Step 6: Repair theme popover positioning**

Add shared popover placement constants:

```ts
const railPopoverRoot = "relative w-max max-w-full max-[1040px]:mx-auto";
const railPopoverPanel =
  "absolute left-0 top-full z-50 mt-1 w-[252px] max-w-[calc(100vw-2rem)] animate-trauma-pop-bounce max-[1040px]:left-full max-[1040px]:top-0 max-[1040px]:ml-2 max-[1040px]:mt-0";
```

Use them in `ThemeNavButton`:

```tsx
<div ref={rootRef} class={railPopoverRoot}>
  ...
  <Show when={isThemeOpen()}>
    <div
      aria-label="Theme settings"
      class={railPopoverPanel}
      id={props.popoverId}
      role="dialog"
    >
      <ThemeBlock ... />
    </div>
  </Show>
</div>
```

Do not change add-memory composer behaviour unless a shared constant is needed
to keep both popovers layered above route panes.

- [ ] **Step 7: Update cross-device E2E expectations**

Update `e2e/cross-device-responsive.spec.ts` as shown in
[08e Cross-Device E2E](08e-cross-device-e2e.md):

- Phone view has `Open navigation`.
- Tablet view has no `Open navigation` top-bar button and uses the visible
  `TRAUMA home` rail link.
- Neither phone nor tablet has `Open filters` or a `Filters` dialog.
- Neither phone nor tablet displays the `Browse filters` complementary region.
- Add memory remains reachable.

- [ ] **Step 8: Run focused tests**

```bash
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/mobile-responsive-contract.test.ts
mise exec -- bun run test:e2e -- e2e/cross-device-responsive.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit shell chrome cleanup**

```bash
git add src/components/shell/AppShell.tsx tests/components/app-shell.test.ts tests/components/mobile-responsive-contract.test.ts e2e/cross-device-responsive.spec.ts
git commit -m "refactor: clean cross-device shell chrome"
```
