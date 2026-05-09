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
  await expect(page.getByRole("main").locator("mark", { hasText: /highlight-aware/ })).toBeVisible();

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page).toHaveURL(/category=research/);

  await page.getByRole("button", { name: "solidstart" }).click();
  await expect(page).toHaveURL(/tag=solidstart/);

  await page.getByRole("button", { name: /highlight-aware results/i }).click();
  await expect(page).toHaveURL(/\/memories\?highlight=h-foundation$/);
  await expect(page).not.toHaveURL(/category=research/);
  await expect(page).not.toHaveURL(/tag=solidstart/);

  const viewModeGroup = page.getByRole("group", { name: "View mode" });
  await expect(viewModeGroup).toBeVisible();
  const toggleBoxBefore = await viewModeGroup.boundingBox();
  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.locator(".memory-grid")).toBeVisible();
  await expect(viewModeGroup).toBeVisible();
  const toggleBoxAfter = await viewModeGroup.boundingBox();

  expect(toggleBoxBefore).not.toBeNull();
  expect(toggleBoxAfter).not.toBeNull();
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
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Highlights" }).click();
  await expect(page).toHaveURL(/\/highlights$/);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);

  await page.goto("/memories");
  await page.getByRole("button", { name: "Open filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Research" }),
  ).toBeVisible();
});

test("keeps filter controls reachable on tablet widths", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/memories");

  await expect(page.getByRole("button", { name: "Open filters" })).toBeVisible();
  await page.getByRole("button", { name: "Open filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
});

test("lets active filters be cleared without resetting the rest of the query", async ({ page }) => {
  await page.goto("/memories?q=reader&view=grid");

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page).toHaveURL(/category=research/);

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page).not.toHaveURL(/category=research/);
  await expect(page).toHaveURL(/q=reader/);
  await expect(page).toHaveURL(/view=grid/);
});

test("does not navigate shell and result links to the catch-all route", async ({ page }) => {
  await page.goto("/memories");

  await page.getByRole("link", { name: "Highlights" }).click();
  await expect(page).toHaveURL(/\/highlights$/);
  await expect(page.getByRole("heading", { name: "Highlights", exact: true })).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);

  await page.goto("/memories");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);

  await page.goto("/highlights");
  await page.getByRole("link", { name: "Reader Mode Notes" }).click();
  await expect(page).toHaveURL(/\/memories\/memory-foundation#h-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

test("keeps the add-memory composer reachable from shell routes", async ({ page }) => {
  await page.goto("/highlights");

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL" })).toBeVisible();
  await page.getByRole("dialog", { name: "Add memory" }).getByRole("button", { name: "Close" }).click();

  await page.goto("/memories/memory-foundation");
  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL" })).toBeVisible();
});
