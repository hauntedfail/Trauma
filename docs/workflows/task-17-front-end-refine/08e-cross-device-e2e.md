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
