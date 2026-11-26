import { expect, test } from "@playwright/test";

import {
  materializeE2eFixture,
  mutateE2eFixtureState,
} from "./bun-fixture";

const longMomentFixtureUrl =
  "https://example.com/articles/a-very-long-reader-source-path-without-breakable-segments";

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

    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Browse filters" })).toHaveCount(0);

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

test("keeps long Moment rows within the phone viewport", async ({ page }) => {
  await materializeE2eFixture("reader_base");
  await mutateE2eFixtureState("moment_delete_focus_rows");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/moments");

  await expect(
    page.getByRole("heading", { name: "Moments", exact: true }),
  ).toBeVisible();
  const longMomentRow = page.locator(
    '[data-collection-row="moment-focus-older"]',
  );
  await expect(longMomentRow).toBeVisible();
  await expect(longMomentRow.getByText(longMomentFixtureUrl, { exact: true }))
    .toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );

  expect(overflow).toBeLessThanOrEqual(1);
});

test("renders exactly 4 phone bottom tabs (Today, Shelf, Library, More) with no disabled tabs (AC 9)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
  await expect(primaryTabs).toBeVisible();

  const tabItems = primaryTabs.locator("[data-phone-tab]");
  await expect(tabItems).toHaveCount(4);

  const tabLabels = await primaryTabs
    .locator("[data-phone-tab-label]")
    .allTextContents();
  expect(tabLabels.map((text) => text.trim())).toEqual([
    "Today",
    "Shelf",
    "Library",
    "More",
  ]);

  await expect(primaryTabs.locator("[disabled], [aria-disabled='true']")).toHaveCount(0);
  for (const removedLabel of ["Categories", "Tags", "Backup"]) {
    await expect(primaryTabs.getByText(removedLabel, { exact: true })).toHaveCount(0);
  }

  await primaryTabs.getByRole("link", { name: "Shelf" }).click();
  await expect(page).toHaveURL(/\/memories\?lane=shelf$/);

  await primaryTabs.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/memories\?lane=library$/);

  await primaryTabs.getByRole("button", { name: "More" }).click();
  const moreSheet = page.getByRole("dialog", { name: "More navigation" });
  await expect(moreSheet).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Flashbacks" })).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Moments" })).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Settings" })).toBeVisible();

  await moreSheet.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expect(page.getByRole("heading", { name: "Flashbacks", exact: true })).toBeVisible();
});

test("keeps paper phone tabs without desktop rail underlines", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "paper");
  });
  await page.goto("/memories");

  const todayTab = page
    .getByRole("navigation", { name: "Primary tabs" })
    .getByRole("link", { name: "Today" });
  const underlineContent = await todayTab.evaluate((tab) =>
    getComputedStyle(tab, "::after").content,
  );
  expect(underlineContent).toBe("none");
});

test("keeps tablet paper add-memory icon centered in the slim 56px rail", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "paper");
  });
  await page.goto("/memories");

  const rail = page.locator('aside[aria-label="Primary navigation"]');
  const railBox = await rail.boundingBox();
  expect(railBox).not.toBeNull();
  expect(Math.round(railBox!.width)).toBe(56);

  const commandPalette = rail.getByRole("button", { name: "Command palette" });
  const delta = await commandPalette.evaluate((button) => {
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

test("keeps tablet navigation 56px icon-only and browse content fluid", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/memories?lane=library");

  await expect(page.getByRole("navigation", { name: "Primary sections" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open memory Browse Shell Sketch" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toHaveCount(0);

  const routeSurface = page.locator(".trauma-route-surface").first();
  const box = await routeSurface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(700);
});
