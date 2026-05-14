import { expect, test, type Page } from "@playwright/test";

test("redirects the home route to the canonical memories browse route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByRole("heading", { name: "Memories", exact: true })).toBeVisible();
});

test("aligns the desktop brand mark with left rail tab icons", async ({ page }) => {
  await page.goto("/memories");

  const brandBox = await page
    .getByRole("link", { name: "TRAUMA home" })
    .locator("img")
    .boundingBox();
  const memoriesIconBox = await page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Memories" })
    .locator("span")
    .first()
    .boundingBox();

  expect(brandBox).not.toBeNull();
  expect(memoriesIconBox).not.toBeNull();

  const brandCenter = brandBox!.x + brandBox!.width / 2;
  const memoriesIconCenter = memoriesIconBox!.x + memoriesIconBox!.width / 2;
  expect(Math.abs(brandCenter - memoriesIconCenter)).toBeLessThanOrEqual(1);
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

  const sectionRadius = await filters
    .locator("section")
    .first()
    .evaluate((section) => getComputedStyle(section).borderTopLeftRadius);
  expect(sectionRadius).toBe("20px");
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

test("layers left rail popovers above the main pane", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/memories");

  const themeButton = page.getByRole("button", { name: "Theme" });
  await expect(themeButton).toHaveCount(1);
  await themeButton.click();
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toBeVisible();
  await expectRailDialogAboveMain(page, "Theme settings");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toHaveCount(0);

  const addMemoryButton = page.getByRole("button", { name: "Add memory" });
  await expect(addMemoryButton).toHaveCount(1);
  await expect(addMemoryButton).toHaveAttribute("aria-pressed", "false");
  await addMemoryButton.click();
  await expect(addMemoryButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  const addMemoryRadius = await addMemoryButton.evaluate(
    (button) => getComputedStyle(button).borderTopLeftRadius,
  );
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "Save memory" })
        .evaluate((button) => getComputedStyle(button).borderTopLeftRadius),
    )
    .toBe(addMemoryRadius);
  await expectRailDialogAboveMain(page, "Add memory");
  await page.keyboard.press("Escape");
  await expect(addMemoryButton).toHaveAttribute("aria-pressed", "false");
});

test("persists shell theme controls in the browser", async ({ page }) => {
  await page.goto("/memories");

  const primarySections = page.getByRole("navigation", { name: "Primary sections" });
  const navLabels = await primarySections.locator("a, button").evaluateAll((nodes) =>
    nodes
      .map((node) => node.textContent?.trim().replace(/\s+/g, " "))
      .filter((text): text is string => text !== undefined && text.length > 0),
  );
  expect(navLabels.indexOf("Backup")).toBeLessThan(navLabels.indexOf("Theme"));
  expect(navLabels.indexOf("Theme")).toBeLessThan(navLabels.indexOf("Settings"));

  await expect(page.getByRole("group", { name: "Brightness" })).toHaveCount(0);
  await page.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toBeVisible();
  await page
    .getByRole("group", { name: "Brightness" })
    .getByRole("button", { name: "Sun" })
    .click();
  const surfaceGroup = page.getByRole("group", { name: "Surface" });
  await expect(surfaceGroup.getByRole("button", { name: "Light" })).toBeVisible();
  await expect(surfaceGroup.getByRole("button", { name: "Midnight" })).toHaveCount(0);
  await expect(surfaceGroup.getByRole("button", { name: "Normal" })).toHaveCount(0);
  await expect(surfaceGroup.getByRole("button", { name: "Paper" })).toBeVisible();
  await expect(surfaceGroup.getByRole("button", { name: "Hermès" })).toHaveCount(0);
  await page
    .getByRole("group", { name: "Surface" })
    .getByRole("button", { name: "Paper" })
    .click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("paper-warm-light");
  await expect
    .poll(() => readLeftRailMaterial(page))
    .toMatchObject({
      backgroundColor: "rgb(236, 226, 204)",
      afterUsesFixedAttachment: true,
      beforeUsesFixedAttachment: true,
      beforeContent: '""',
      afterContent: '""',
    });

  const gridButton = page.getByRole("button", { name: "Grid" });
  await gridButton.click();
  await expect(gridButton).toHaveAttribute("aria-pressed", "true");
  const readWaxStyle = () =>
    gridButton.evaluate((button) => {
      const label = button.querySelector(".trauma-paper-wax-label");
      const style = getComputedStyle(button);
      const edge = getComputedStyle(button, "::before");
      const stamp = getComputedStyle(button, "::after");
      const labelStyle =
        label instanceof HTMLElement ? getComputedStyle(label) : undefined;

      return {
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        textShadow: style.textShadow,
        ringBorderColor: edge.borderColor,
        ringBorderStyle: edge.borderStyle,
        ringBorderWidth: edge.borderWidth,
        ringBackgroundColor: edge.backgroundColor,
        ringClipPath: edge.clipPath,
        ringContent: edge.content,
        ringInset: edge.inset,
        ringOpacity: edge.opacity,
        labelColor: labelStyle?.color,
        labelPosition: labelStyle?.position,
        labelZIndex: labelStyle?.zIndex,
        stampBorderWidth: stamp.borderWidth,
        stampClipPath: stamp.clipPath,
        stampOutlineStyle: stamp.outlineStyle,
        stampContent: stamp.content,
        stampInset: stamp.inset,
        stampOpacity: stamp.opacity,
      };
    });
  await expect
    .poll(() => gridButton.evaluate((button) => getComputedStyle(button, "::before").opacity))
    .toBe("0.92");
  const waxStyle = await readWaxStyle();
  expect(waxStyle.backgroundImage).toBe("none");
  expect(waxStyle.boxShadow).toBe("none");
  expect(waxStyle.textShadow).toBe("none");
  expect(waxStyle.ringContent).not.toBe("none");
  expect(waxStyle.ringClipPath).toBe("none");
  expect(waxStyle.ringInset).toBe("3px");
  expect(waxStyle.ringBorderWidth).toBe("0px");
  expect(waxStyle.ringBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(waxStyle.ringBackgroundColor).not.toBe("transparent");
  expect(waxStyle.labelColor).toBe("rgb(250, 242, 220)");
  expect(waxStyle.labelPosition).toBe("relative");
  expect(waxStyle.labelZIndex).toBe("1");
  expect(waxStyle.stampContent).not.toBe("none");
  expect(waxStyle.stampClipPath).toBe("none");
  expect(waxStyle.stampBorderWidth).toBe("0px");
  expect(waxStyle.stampOutlineStyle).toBe("none");
  expect(waxStyle.stampInset).toBe("6px 7px");
  await expect
    .poll(() => gridButton.evaluate((button) => getComputedStyle(button, "::after").opacity))
    .toBe("1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Theme settings" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Brightness" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("group", { name: "Brightness" })).toHaveCount(0);
  await page.getByRole("button", { name: "Theme" }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("paper-warm-light");
  await expect(
    page.getByRole("group", { name: "Brightness" }).getByRole("button", { name: "Sun" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Surface" }).getByRole("button", { name: "Paper" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("group", { name: "Brightness" })
    .getByRole("button", { name: "Night" })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("paper-black-dark");
  await expect(surfaceGroup.getByRole("button", { name: "Midnight" })).toBeVisible();
  await expect(surfaceGroup.getByRole("button", { name: "Light" })).toHaveCount(0);
  await expect(surfaceGroup.getByRole("button", { name: "Normal" })).toHaveCount(0);
  await expect
    .poll(() => readLeftRailMaterial(page))
    .toMatchObject({
      backgroundColor: "rgb(33, 19, 7)",
      afterUsesFixedAttachment: true,
      beforeUsesFixedAttachment: true,
      beforeContent: '""',
      afterContent: '""',
    });
  await expect(surfaceGroup.getByRole("button", { name: "Hermès" })).toHaveAttribute("aria-pressed", "true");
  await expect(surfaceGroup.getByRole("button", { name: "Paper" })).toHaveCount(0);

  await page
    .getByRole("group", { name: "Brightness" })
    .getByRole("button", { name: "Sun" })
    .click();
  await expect(surfaceGroup.getByRole("button", { name: "Light" })).toBeVisible();
  await expect(surfaceGroup.getByRole("button", { name: "Midnight" })).toHaveCount(0);
  await expect(surfaceGroup.getByRole("button", { name: "Paper" })).toHaveAttribute("aria-pressed", "true");
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
  await page
    .getByRole("link", { name: "Open memory Reader Mode Notes" })
    .click();
  await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);

  await page.goto("/memories");
  await page
    .getByRole("link", { name: "Open memory Reader Mode Notes" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/memories\/memory-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();

  await page.goto("/highlights");
  await page.getByRole("link", { name: "Reader Mode Notes" }).click();
  await expect(page).toHaveURL(/\/memories\/memory-foundation#h-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

test("keeps the add-memory composer reachable from shell routes", async ({ page }) => {
  await page.goto("/highlights");

  const highlightsAddButton = page.getByRole("button", { name: "Add memory" });
  await expect(highlightsAddButton).toHaveAttribute("aria-expanded", "false");
  await expect(highlightsAddButton).toHaveAttribute("aria-pressed", "false");
  await highlightsAddButton.click();
  await expect(highlightsAddButton).toHaveAttribute("aria-expanded", "true");
  await expect(highlightsAddButton).toHaveAttribute("aria-pressed", "true");
  const highlightsComposer = page.getByRole("dialog", { name: "Add memory" });
  await expect(highlightsComposer).toBeVisible();
  await expect(highlightsComposer.getByRole("textbox", { name: "URL" })).toBeVisible();
  await expect(highlightsComposer.getByRole("button", { name: "Close" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(highlightsComposer).toHaveCount(0);
  await expect(highlightsAddButton).toHaveAttribute("aria-expanded", "false");

  await page.goto("/memories/memory-foundation");
  const readerAddButton = page.getByRole("button", { name: "Add memory" });
  await expect(readerAddButton).toHaveAttribute("aria-expanded", "false");
  await expect(readerAddButton).toHaveAttribute("aria-pressed", "false");
  await readerAddButton.click();
  await expect(readerAddButton).toHaveAttribute("aria-expanded", "true");
  await expect(readerAddButton).toHaveAttribute("aria-pressed", "true");
  const readerComposer = page.getByRole("dialog", { name: "Add memory" });
  await expect(readerComposer).toBeVisible();
  await expect(readerComposer.getByRole("textbox", { name: "URL" })).toBeVisible();
});

async function expectRailDialogAboveMain(page: Page, dialogName: string) {
  const layer = await page.evaluate((name) => {
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find((element) => element.getAttribute("aria-label") === name);
    const main = document.querySelector<HTMLElement>("main");
    const primaryRail = document.querySelector<HTMLElement>(
      'aside[aria-label="Primary navigation"]',
    );

    if (dialog === undefined || main === null || primaryRail === null) {
      return { missing: true };
    }

    const dialogRect = dialog.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const probeX = Math.max(
      mainRect.left + 8,
      Math.min(dialogRect.right - 8, mainRect.left + 32),
    );
    const probeY = Math.min(dialogRect.bottom - 8, dialogRect.top + 24);
    const topElement = document.elementFromPoint(probeX, probeY);
    const railStyle = getComputedStyle(primaryRail);

    return {
      dialogExtendsIntoMain: dialogRect.right > mainRect.left + 8,
      missing: false,
      primaryOverflowX: railStyle.overflowX,
      primaryOverflowY: railStyle.overflowY,
      primaryZIndex: railStyle.zIndex,
      topElementInsideDialog:
        topElement instanceof Element && dialog.contains(topElement),
    };
  }, dialogName);

  expect(layer).toEqual({
    dialogExtendsIntoMain: true,
    missing: false,
    primaryOverflowX: "visible",
    primaryOverflowY: "visible",
    primaryZIndex: "40",
    topElementInsideDialog: true,
  });
}

async function readLeftRailMaterial(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(
      'aside[aria-label="Primary navigation"]',
    );
    if (rail === null) {
      throw new Error("Primary navigation rail is missing");
    }

    const style = getComputedStyle(rail);
    const before = getComputedStyle(rail, "::before");
    const after = getComputedStyle(rail, "::after");
    const isEveryAttachmentFixed = (value: string) =>
      value
        .split(",")
        .map((attachment) => attachment.trim())
        .every((attachment) => attachment === "fixed");

    return {
      afterContent: after.content,
      afterUsesFixedAttachment: isEveryAttachmentFixed(after.backgroundAttachment),
      backgroundColor: style.backgroundColor,
      beforeUsesFixedAttachment: isEveryAttachmentFixed(before.backgroundAttachment),
      beforeContent: before.content,
    };
  });
}
