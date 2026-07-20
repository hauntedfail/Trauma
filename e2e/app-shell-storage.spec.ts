import { expect, test } from "@playwright/test";

test("hydrates and changes theme when local storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("Storage access is blocked", "SecurityError");
    };
    Object.defineProperty(Storage.prototype, "getItem", { value: blocked });
    Object.defineProperty(Storage.prototype, "setItem", { value: blocked });
  });

  await page.goto("/memories");
  await expect(
    page.getByRole("heading", { name: "Memories", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Theme" }).click();
  const themeDialog = page.getByRole("dialog", { name: "Theme settings" });
  await themeDialog
    .getByRole("group", { name: "Brightness" })
    .getByRole("button", { name: "Sun" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "warm-light");
});
