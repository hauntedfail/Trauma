import { expect, test } from "@playwright/test";

const viewports = [
  { height: 844, kind: "phone", name: "phone narrow", width: 390 },
  { height: 932, kind: "phone", name: "phone wide", width: 430 },
  { height: 1180, kind: "tablet", name: "tablet portrait", width: 820 },
  { height: 900, kind: "phone", name: "tablet split", width: 700 },
] as const;

for (const viewport of viewports) {
  test(`renders shell chrome cleanly on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/memories");

    await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Browse filters" })).toBeHidden();

    if (viewport.kind === "phone") {
      await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary sections" })).toBeHidden();
    } else {
      await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Primary sections" })).toBeVisible();
      await expect(page.getByRole("link", { name: "TRAUMA home" })).toHaveCount(1);
    }

    const overflow = await page.evaluate(() => {
      const documentElement = document.documentElement;
      return documentElement.scrollWidth - documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("keeps phone primary actions reachable from the bottom tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
  await primaryTabs.getByRole("link", { name: "Highlights" }).click();
  await expect(page).toHaveURL(/\/highlights$/);
  await expect(page.getByRole("heading", { name: "Highlights", exact: true })).toBeVisible();

  await primaryTabs.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toHaveCount(0);

  await primaryTabs.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL" })).toBeVisible();
});

test("keeps tablet navigation icon-only and browse content fluid", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/memories");

  await expect(page.getByRole("navigation", { name: "Primary sections" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open memory Reader Mode Notes" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toBeHidden();

  const routeSurface = page.locator(".trauma-route-surface").first();
  const box = await routeSurface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(700);
});
