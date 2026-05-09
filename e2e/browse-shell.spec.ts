import { expect, test } from "@playwright/test";

test("redirects the home route to the canonical memories browse route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
});

test("updates URL query state from search, filters, highlight shortcuts, and view controls", async ({
  page,
}) => {
  await page.goto("/memories");

  await page.getByRole("searchbox", { name: "Search memories" }).fill("reader mode");
  await expect(page).toHaveURL(/q=reader\+mode/);
  await expect(page.getByText("Reader Mode Notes")).toBeVisible();
  await expect(page.getByRole("main").locator("mark", { hasText: "highlight-aware results" })).toBeVisible();

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page).toHaveURL(/category=research/);

  await page.getByRole("button", { name: "solidstart" }).click();
  await expect(page).toHaveURL(/tag=solidstart/);

  await page.getByRole("button", { name: /highlight-aware results/i }).click();
  await expect(page).toHaveURL(/highlight=h-foundation/);

  const toggleBoxBefore = await page.getByRole("group", { name: "View mode" }).boundingBox();
  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.locator(".memory-grid")).toBeVisible();
  const toggleBoxAfter = await page.getByRole("group", { name: "View mode" }).boundingBox();

  expect(toggleBoxBefore?.width).toBe(toggleBoxAfter?.width);
  expect(toggleBoxBefore?.height).toBe(toggleBoxAfter?.height);
});

test("renders category, tag, and highlight shortcut sections in the right panel", async ({ page }) => {
  await page.goto("/memories");

  const filters = page.getByRole("complementary", { name: "Browse filters" });
  await expect(filters.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(filters.getByRole("heading", { name: "Tags" })).toBeVisible();
  await expect(filters.getByRole("heading", { name: "Recent highlights" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Research" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "solidstart" })).toBeVisible();
  await expect(filters.getByRole("button", { name: /highlight-aware results/i })).toBeVisible();
});

test("uses drawer controls for navigation and filters on narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open filters" })).toBeVisible();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Memories" })).toBeVisible();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Research" }),
  ).toBeVisible();
});
