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
  for (const tabName of [
    "Memories",
    "Flashbacks",
    "Categories",
    "Tags",
    "Backup",
    "Add memory",
    "Theme",
    "Settings",
  ]) {
    await expect(primaryTabs.getByText(tabName, { exact: true })).toBeAttached();
  }

  const scrollState = await primaryTabs.evaluate((nav) => {
    const scroller = nav.querySelector("[data-phone-tab-scroll]");

    if (scroller === null) {
      return null;
    }

    const style = getComputedStyle(scroller);

    return {
      clientWidth: scroller.clientWidth,
      overflowX: style.overflowX,
      scrollWidth: scroller.scrollWidth,
    };
  });

  expect(scrollState).not.toBeNull();
  expect(["auto", "scroll"]).toContain(scrollState!.overflowX);
  expect(scrollState!.scrollWidth).toBeGreaterThan(scrollState!.clientWidth);

  await primaryTabs.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expect(page.getByRole("heading", { name: "Flashbacks", exact: true })).toBeVisible();

  await primaryTabs.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toHaveCount(0);

  await primaryTabs.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL" })).toBeVisible();
});

test("keeps phone tabs large and free of paper underline decoration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");
  await page.evaluate(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "paper");
    document.documentElement.dataset.theme = "paper-warm-light";
  });
  await page.reload();

  const memoriesTab = page
    .getByRole("navigation", { name: "Primary tabs" })
    .getByRole("link", { name: "Memories" });
  const iconBox = await memoriesTab.locator("span").first().boundingBox();
  const underlineContent = await memoriesTab.evaluate((tab) =>
    getComputedStyle(tab, "::after").content,
  );

  expect(iconBox).not.toBeNull();
  expect(iconBox!.width).toBeGreaterThanOrEqual(34);
  expect(iconBox!.height).toBeGreaterThanOrEqual(34);
  expect(underlineContent).toBe("none");
});

test("keeps phone tab labels visually hidden while preserving names", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
  await expect(primaryTabs.getByRole("link", { name: "Memories" })).toBeVisible();
  await expect(primaryTabs.getByRole("button", { name: "Theme" })).toBeVisible();

  const labels = primaryTabs.locator("[data-phone-tab-label]");
  await expect(labels).toHaveCount(9);

  const labelBoxes = await labels.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return {
        height: rect.height,
        overflow: style.overflow,
        position: style.position,
        width: rect.width,
      };
    }),
  );

  for (const box of labelBoxes) {
    expect(box.position).toBe("absolute");
    expect(box.overflow).toBe("hidden");
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
  }
});

test("keeps tablet paper add-memory icon centered in the compact rail", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "paper");
  });
  await page.goto("/memories");

  const addMemory = page
    .locator('aside[aria-label="Primary navigation"]')
    .getByRole("button", { name: "Add memory" });
  const delta = await addMemory.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const iconRect = button.querySelector("svg")?.getBoundingClientRect();

    if (iconRect === undefined) {
      return Number.POSITIVE_INFINITY;
    }

    const buttonCenter = buttonRect.left + buttonRect.width / 2;
    const iconCenter = iconRect.left + iconRect.width / 2;

    return Math.abs(buttonCenter - iconCenter);
  });

  expect(delta).toBeLessThanOrEqual(1);
});

test("keeps non-desktop theme box readable", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "normal");
  });
  await page.goto("/memories");

  await page.getByRole("button", { name: "Theme" }).click();
  const themeDialog = page.getByRole("dialog", { name: "Theme settings" });
  await expect(themeDialog).toBeVisible();
  const sunButton = themeDialog.getByRole("button", { name: "Sun" });
  const paperButton = themeDialog.getByRole("button", { name: "Paper" });

  await expect(sunButton).toBeVisible();
  await expect(paperButton).toBeVisible();

  const sunBox = await sunButton.boundingBox();
  const paperBox = await paperButton.boundingBox();

  expect(sunBox).not.toBeNull();
  expect(paperBox).not.toBeNull();
  expect(sunBox!.width).toBeGreaterThan(80);
  expect(paperBox!.width).toBeGreaterThan(80);
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
