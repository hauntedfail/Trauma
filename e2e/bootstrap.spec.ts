import { expect, test } from "@playwright/test";

test("renders the memories shell", async ({ page }) => {
  await page.goto("/memories");

  await expect(page.getByRole("link", { name: "TRAUMA home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open memory Reader Mode Notes" })).toBeVisible();

  await page.goto("/memories?lane=library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open memory Browse Shell Sketch" })).toBeVisible();
});
