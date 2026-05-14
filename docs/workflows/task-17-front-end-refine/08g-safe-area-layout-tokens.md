# Task 17.8g: Safe-Area Layout Tokens

## Intent

Integrate mobile safe-area insets into TRAUMA's layout token system so notches,
rounded corners, and bottom home indicators do not clip viewport-edge UI.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
and execute this after [08c Container Ownership](08c-container-ownership.md).

## Files

- Modify: `src/styles/tailwind.css`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `tests/components/mobile-responsive-contract.test.ts`

## Steps

- [ ] **Step 1: Confirm the safe-area contract exists**

The contract test from
[08b Responsive Contract Tests](08b-responsive-contract-tests.md) must include:

```ts
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
```

Run:

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts
```

Expected before implementation: FAIL because the safe-area tokens and utilities
do not exist.

- [ ] **Step 2: Add safe-area layout tokens and utilities**

In `src/styles/tailwind.css`, add:

```css
:root {
  --trauma-layout-safe-area-top: env(safe-area-inset-top, 0px);
  --trauma-layout-safe-area-right: env(safe-area-inset-right, 0px);
  --trauma-layout-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --trauma-layout-safe-area-left: env(safe-area-inset-left, 0px);
}

.trauma-safe-area-shell {
  padding-block-start: var(--trauma-layout-safe-area-top);
  padding-inline-end: var(--trauma-layout-safe-area-right);
  padding-block-end: var(--trauma-layout-safe-area-bottom);
  padding-inline-start: var(--trauma-layout-safe-area-left);
}

.trauma-safe-area-inline {
  padding-inline-end: var(--trauma-layout-safe-area-right);
  padding-inline-start: var(--trauma-layout-safe-area-left);
}

.trauma-safe-area-bottom {
  padding-block-end: var(--trauma-layout-safe-area-bottom);
}
```

Keep raw `env(safe-area-inset-*)` calls in this file only.

- [ ] **Step 3: Apply safe-area utilities to viewport-edge surfaces**

In `src/components/shell/AppShell.tsx`, apply:

- `trauma-safe-area-shell` to the top-level mobile shell wrapper or drawer
  container that can touch every viewport edge.
- `trauma-safe-area-inline` to mobile top bars or drawer interiors that need
  left/right protection without changing block spacing.
- `trauma-safe-area-bottom` to bottom action bars or fixed composer surfaces.

Do not apply safe-area utilities to desktop-only pane interiors, list rows,
memory cards, right-rail cards, or reader article content unless that element is
positioned against a viewport edge.

- [ ] **Step 4: Audit safe-area token usage**

Run:

```bash
rg -n "safe-area|env\\(safe-area-inset" src/styles src/components src/routes
```

Expected review outcome:

- Raw `env(safe-area-inset-*)` calls exist only in `src/styles/tailwind.css`
  token definitions.
- Components and routes use `trauma-safe-area-shell`,
  `trauma-safe-area-inline`, or `trauma-safe-area-bottom`.
- Safe-area utilities appear only on viewport-edge surfaces: mobile shell
  wrappers, drawers, fixed/sticky bars, or full-height overlays.

- [ ] **Step 5: Run focused tests**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit safe-area layout tokens**

```bash
git add src/styles/tailwind.css src/components/shell/AppShell.tsx tests/components/mobile-responsive-contract.test.ts
git commit -m "style: add mobile safe-area layout tokens"
```
