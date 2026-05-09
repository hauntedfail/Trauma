import { expect, test } from "@playwright/test";

test("renders the memories shell", async ({ page }) => {
  await page.goto("/memories");

  await expect(page.getByRole("link", { name: "Trauma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
  await expect(page.getByText("No memories yet")).toBeVisible();
});
