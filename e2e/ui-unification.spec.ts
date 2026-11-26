import { expect, test } from "@playwright/test";

import {
  materializeE2eFixture,
  mutateE2eFixtureState,
  resetE2eFixture,
} from "./bun-fixture";

const UNIFIED_ROUTES = [
  { heading: "Today", path: "/memories" },
  { heading: "Shelf", path: "/memories?lane=shelf" },
  { heading: "Library", path: "/memories?lane=library" },
  { heading: "Flashbacks", path: "/flashbacks" },
  { heading: "Moments", path: "/moments" },
  { heading: "Settings", path: "/settings" },
] as const;

test.beforeEach(async () => {
  await resetE2eFixture("read_only");
});

test("keeps header chrome, title typography, and route column aligned across all top-level views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  const metrics: Array<{
    columnLeft: number;
    columnWidth: number;
    headerHeight: number;
    headerPosition: string;
    path: string;
    titleFontSize: string;
    titleFontWeight: string;
  }> = [];

  for (const route of UNIFIED_ROUTES) {
    await page.goto(route.path);
    const header = page.locator("header.trauma-route-header").first();
    const title = page.getByRole("heading", { level: 1, name: route.heading, exact: true });
    const column = page.locator(".trauma-route-column").last();

    await expect(header).toBeVisible();
    await expect(title).toBeVisible();
    await expect(column).toBeVisible();

    const measured = await page.evaluate(() => {
      const headerEl = document.querySelector("header.trauma-route-header");
      const titleEl = headerEl?.querySelector("h1");
      const columns = document.querySelectorAll(".trauma-route-column");
      const contentColumn = columns[columns.length - 1];
      if (!headerEl || !titleEl || !contentColumn) {
        throw new Error("Missing unified route primitives");
      }
      const headerRect = headerEl.getBoundingClientRect();
      const colRect = contentColumn.getBoundingClientRect();
      const headerStyle = getComputedStyle(headerEl);
      const titleStyle = getComputedStyle(titleEl);
      return {
        columnLeft: Math.round(colRect.left),
        columnWidth: Math.round(colRect.width),
        headerHeight: Math.round(headerRect.height),
        headerPosition: headerStyle.position,
        titleFontSize: titleStyle.fontSize,
        titleFontWeight: titleStyle.fontWeight,
      };
    });

    metrics.push({ path: route.path, ...measured });
  }

  const baseline = metrics[0]!;
  expect(baseline.headerPosition).toBe("sticky");
  expect(baseline.columnWidth).toBeLessThanOrEqual(720);

  for (const current of metrics.slice(1)) {
    expect(current.headerPosition, current.path).toBe(baseline.headerPosition);
    expect(Math.abs(current.headerHeight - baseline.headerHeight), current.path).toBeLessThanOrEqual(2);
    expect(current.titleFontSize, current.path).toBe(baseline.titleFontSize);
    expect(current.titleFontWeight, current.path).toBe(baseline.titleFontWeight);
    expect(Math.abs(current.columnLeft - baseline.columnLeft), current.path).toBeLessThanOrEqual(1);
    expect(Math.abs(current.columnWidth - baseline.columnWidth), current.path).toBeLessThanOrEqual(1);
  }
});

test("uses the same surface card radius across Memories, Flashbacks, Moments, and Settings without Settings-only gradient", async ({
  page,
}) => {
  await materializeE2eFixture("reader_base");
  await mutateE2eFixtureState("moment_delete_focus_rows");
  await page.setViewportSize({ width: 1280, height: 800 });

  const cardRoutes = [
    { path: "/memories", selector: "article.trauma-surface-card" },
    { path: "/flashbacks", selector: "article.trauma-surface-card" },
    { path: "/moments", selector: "article.trauma-surface-card" },
    { path: "/settings", selector: ".trauma-surface-card" },
  ] as const;

  const radii: Array<{ path: string; radius: string }> = [];

  for (const route of cardRoutes) {
    await page.goto(route.path);
    const card = page.locator(route.selector).first();
    await expect(card).toBeVisible();
    const radius = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    radii.push({ path: route.path, radius });
  }

  const expectedRadius = radii[0]!.radius;
  expect(expectedRadius).toBe("16px");
  for (const entry of radii.slice(1)) {
    expect(entry.radius, entry.path).toBe(expectedRadius);
  }

  // Settings must not apply a route-local radial gradient background.
  const settingsBgImage = await page
    .locator(".trauma-settings-content")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(settingsBgImage).toBe("none");
});
