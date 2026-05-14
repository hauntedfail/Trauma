# Task 17.8e: Cross-Device E2E

## Intent

Verify user-visible behaviour across narrow and mid-width layouts without
making the implementation device-model-specific.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this after the responsive implementation in
[08d Component Responsive Implementation](08d-component-responsive-implementation.md)
passes focused component tests.

## Files

- Create: `e2e/cross-device-responsive.spec.ts`
- Modify: `docs/references/design-system/verification.md`

## Steps

- [ ] **Step 1: Add Playwright coverage**

Create `e2e/cross-device-responsive.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const cases = [
  { name: "phone narrow", shell: "mobile", width: 390, height: 844 },
  { name: "phone wide", shell: "mobile", width: 430, height: 932 },
  { name: "tablet portrait", shell: "tablet", width: 820, height: 1180 },
  { name: "tablet split", shell: "mobile", width: 700, height: 900 },
] as const;

for (const viewport of cases) {
  test(`keeps primary flows usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/memories");

    if (viewport.shell === "mobile") {
      await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    } else {
      await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "TRAUMA home" })).toBeVisible();
    }

    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Browse filters" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add memory" })).toBeVisible();

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
