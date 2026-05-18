import { expect, test, type Page } from "@playwright/test";

import { runBunFixtureScript } from "./bun-fixture";

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

test("uses filled active nav icons without active tab background", async ({ page }) => {
  await page.goto("/memories");

  const memoriesLink = page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Memories" });
  const normalState = await memoriesLink.evaluate((link) => {
    const label = link.querySelector(".trauma-active-nav-label");
    const firstFilledShape = link.querySelector("svg [fill]");

    return {
      backgroundColor: getComputedStyle(link).backgroundColor,
      fill: firstFilledShape?.getAttribute("fill") ?? "",
      fontWeight: Number.parseInt(
        label === null ? "0" : getComputedStyle(label).fontWeight,
        10,
      ),
    };
  });

  expect(normalState.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(normalState.fill).toBe("currentColor");
  expect(normalState.fontWeight).toBeGreaterThanOrEqual(700);
});

test("keeps paper active nav underline while removing active tab background", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "sun");
    localStorage.setItem("trauma:surface", "paper");
  });
  await page.goto("/memories");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "paper-warm-light",
  );

  const memoriesLink = page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Memories" });
  const paperState = await memoriesLink.evaluate((link) => {
    const label = link.querySelector(".trauma-active-nav-label");
    const linkUnderline = getComputedStyle(link, "::after");

    return {
      animationName: linkUnderline.animationName,
      backgroundColor: getComputedStyle(link).backgroundColor,
      labelUnderlineContent:
        label === null ? "none" : getComputedStyle(label, "::after").content,
      underlineBottom: linkUnderline.bottom,
      underlineContent: linkUnderline.content,
      underlineLeft: linkUnderline.left,
      underlineRight: linkUnderline.right,
    };
  });

  expect(paperState.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(paperState.labelUnderlineContent).toBe("none");
  expect(paperState.underlineContent).toBe('""');
  expect(paperState.underlineLeft).toBe("62px");
  expect(paperState.underlineRight).toBe("18px");
  expect(paperState.underlineBottom).toBe("5px");
  expect(paperState.animationName).toBe("trauma-handwrite-underline");
});

test("keeps paper active nav underline on the desktop rail item for pip tabs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("trauma:brightness", "night");
    localStorage.setItem("trauma:surface", "paper");
  });
  await page.goto("/flashbacks");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "paper-black-dark",
  );

  const flashbacksLink = page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Flashbacks" });
  const underlineState = await flashbacksLink.evaluate((link) => {
    const label = link.querySelector(".trauma-active-nav-label");
    const linkUnderline = getComputedStyle(link, "::after");

    return {
      labelUnderlineContent:
        label === null ? "none" : getComputedStyle(label, "::after").content,
      underlineBottom: linkUnderline.bottom,
      underlineContent: linkUnderline.content,
      underlineLeft: linkUnderline.left,
      underlineRight: linkUnderline.right,
    };
  });

  expect(underlineState.labelUnderlineContent).toBe("none");
  expect(underlineState.underlineContent).toBe('""');
  expect(underlineState.underlineLeft).toBe("62px");
  expect(underlineState.underlineRight).toBe("18px");
  expect(underlineState.underlineBottom).toBe("5px");
});

test("updates URL query state from search, taxonomy filters, and view controls", async ({
  page,
}) => {
  await page.goto("/memories");

  await page.getByRole("searchbox", { name: "Search memories" }).fill("reader mode");
  await expect(page).toHaveURL(/q=reader\+mode/);
  await expect(page.getByText("Reader Mode Notes")).toBeVisible();
  await expect(page.getByRole("main").locator("mark", { hasText: /flashback-aware/ })).toBeVisible();

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveValue(
    "reader mode category=Research",
  );
  await expect(page).toHaveURL(/q=reader\+mode\+category%3DResearch/);

  await page.getByRole("button", { name: "solidstart" }).click();
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveValue(
    "reader mode category=Research tag=solidstart",
  );
  await expect(page).toHaveURL(/q=reader\+mode\+category%3DResearch\+tag%3Dsolidstart/);

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

test("keeps the memories search focus indicator on the rounded search surface", async ({
  page,
}) => {
  await page.goto("/memories");

  const searchBox = page.getByRole("searchbox", { name: "Search memories" });
  await searchBox.click();
  const focusState = await searchBox.evaluate((input) => {
    const surface = input.closest("label");
    const inputStyle = getComputedStyle(input);
    const surfaceStyle = surface === null ? undefined : getComputedStyle(surface);

    return {
      inputBoxShadow: inputStyle.boxShadow,
      surfaceBorderRadius: surfaceStyle?.borderTopLeftRadius ?? "0px",
      surfaceBoxShadow: surfaceStyle?.boxShadow ?? "none",
    };
  });

  expect(focusState.inputBoxShadow).not.toContain("184, 87, 106");
  expect(focusState.surfaceBoxShadow).toContain("inset");
  expect(Number.parseFloat(focusState.surfaceBorderRadius)).toBeGreaterThanOrEqual(20);
});

test("deletes a memory from the browse list through the public DELETE route", async ({
  page,
}) => {
  createBrowseDeleteFixture();
  await page.goto("/memories");

  const deletedMemoryLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  await expect(deletedMemoryLink).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete memory "Reader Mode Notes"?');
    void dialog.accept();
  });
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/memories/memory-foundation") &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Memory actions for Reader Mode Notes" })
    .click();
  await page.getByRole("menuitem", { name: "Delete memory" }).click();

  expect((await deleteResponse).status()).toBe(204);
  await expect(deletedMemoryLink).toHaveCount(0);
  await expect(page.getByText("Failed to delete memory.")).toHaveCount(0);
});

test("renders category, tag, and flashback shortcut sections in the right panel", async ({ page }) => {
  await page.goto("/memories");

  const filters = page.getByRole("complementary", { name: "Browse filters" });
  await expect(filters.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(filters.getByRole("heading", { name: "Tags" })).toBeVisible();
  await expect(filters.getByRole("heading", { name: "Flashback" })).toBeVisible();
  await expect(filters.getByRole("heading", { name: "Recent flashbacks" })).toHaveCount(0);
  await expect(filters.getByRole("button", { name: "Research" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "solidstart" })).toBeVisible();
  const flashbackLink = filters.getByRole("link", {
    name: /flashback-aware results/i,
  });
  await expect(flashbackLink).toBeVisible();
  await expect(flashbackLink).toHaveAttribute(
    "href",
    /\/memories\/memory-foundation#h-foundation$/,
  );

  const sectionRadius = await filters
    .locator("section")
    .first()
    .evaluate((section) => getComputedStyle(section).borderTopLeftRadius);
  expect(sectionRadius).toBe("20px");
});

test("uses bottom primary tabs without drawer chrome on phone viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toBeHidden();

  const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
  await expect(primaryTabs).toBeVisible();
  await primaryTabs.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);

  await page.goto("/memories");
  const phoneAddMemory = primaryTabs.getByRole("button", { name: "Add memory" });
  await expect(phoneAddMemory).toHaveAttribute("aria-expanded", "false");
  await phoneAddMemory.click();
  await expect(phoneAddMemory).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
});

test("keeps phone browse view controls on the memories header right edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  const header = page.locator(".trauma-route-header").first();
  const title = page.getByRole("heading", { name: "Memories", exact: true });
  const viewModeGroup = page.getByRole("group", { name: "View mode" });

  const headerBox = await header.boundingBox();
  const titleBox = await title.boundingBox();
  const viewModeBox = await viewModeGroup.boundingBox();

  expect(headerBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(viewModeBox).not.toBeNull();

  expect(viewModeBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
  expect(Math.abs(viewModeBox!.y + viewModeBox!.height / 2 - (titleBox!.y + titleBox!.height / 2))).toBeLessThanOrEqual(
    12,
  );
  expect(Math.abs(headerBox!.x + headerBox!.width - (viewModeBox!.x + viewModeBox!.width))).toBeLessThanOrEqual(
    32,
  );
});

test("keeps tablet shell compact without duplicate header or filter drawers", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/memories");

  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary sections" })).toBeVisible();
  await expect(page.getByRole("link", { name: "TRAUMA home" })).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toBeHidden();
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
    .poll(() => readPaperShellMaterial(page))
    .toMatchObject({
      bodyAfterContent: '""',
      bodyBeforeContent: '""',
      mainBackgroundColor: "rgba(0, 0, 0, 0)",
      mainBackgroundImage: "none",
      mainBorderRightWidth: "1px",
      railBackgroundColor: "rgba(0, 0, 0, 0)",
      railBackgroundImage: "none",
      railBorderRightWidth: "1px",
      rightRailBackgroundColor: "rgba(0, 0, 0, 0)",
      rightRailBackgroundImage: "none",
      routeBackgroundColor: "rgba(0, 0, 0, 0)",
      routeBackgroundImage: "none",
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
    .poll(() => readPaperShellMaterial(page))
    .toMatchObject({
      bodyAfterContent: '""',
      bodyBeforeBackgroundImage: "none",
      bodyBeforeContent: '""',
      mainBackgroundColor: "rgba(0, 0, 0, 0)",
      mainBackgroundImage: "none",
      mainBorderRightWidth: "1px",
      railBackgroundColor: "rgba(0, 0, 0, 0)",
      railBackgroundImage: "none",
      railBorderRightWidth: "1px",
      rightRailBackgroundColor: "rgba(0, 0, 0, 0)",
      rightRailBackgroundImage: "none",
      routeBackgroundColor: "rgba(0, 0, 0, 0)",
      routeBackgroundImage: "none",
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
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveValue(
    "reader category=Research",
  );

  await page.getByRole("button", { name: "Research" }).click();
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveValue(
    "reader",
  );
  await expect(page).not.toHaveURL(/category%3DResearch/);
  await expect(page).toHaveURL(/q=reader/);
  await expect(page).toHaveURL(/view=grid/);
});

test("does not navigate shell and result links to the catch-all route", async ({ page }) => {
  await page.goto("/memories");

  await page.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expect(page.getByRole("heading", { name: "Flashbacks", exact: true })).toBeVisible();
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

  await page.goto("/flashbacks");
  await page.getByRole("link", { name: "Reader Mode Notes" }).click();
  await expect(page).toHaveURL(/\/memories\/memory-foundation#h-foundation$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

test("keeps the add-memory composer reachable from shell routes", async ({ page }) => {
  await page.goto("/flashbacks");

  const flashbacksAddButton = page.getByRole("button", { name: "Add memory" });
  await expect(flashbacksAddButton).toHaveAttribute("aria-expanded", "false");
  await expect(flashbacksAddButton).toHaveAttribute("aria-pressed", "false");
  await flashbacksAddButton.click();
  await expect(flashbacksAddButton).toHaveAttribute("aria-expanded", "true");
  await expect(flashbacksAddButton).toHaveAttribute("aria-pressed", "true");
  const flashbacksComposer = page.getByRole("dialog", { name: "Add memory" });
  await expect(flashbacksComposer).toBeVisible();
  await expect(flashbacksComposer.getByRole("textbox", { name: "URL" })).toBeVisible();
  await expect(flashbacksComposer.getByRole("button", { name: "Close" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(flashbacksComposer).toHaveCount(0);
  await expect(flashbacksAddButton).toHaveAttribute("aria-expanded", "false");

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

async function readPaperShellMaterial(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(
      'aside[aria-label="Primary navigation"]',
    );
    const main = document.querySelector<HTMLElement>("main");
    const rightRail = document.querySelector<HTMLElement>(
      'aside[aria-label="Browse filters"]',
    );
    const routePane = document.querySelector<HTMLElement>(
      ".trauma-shell-main > .bg-trauma-bg-surface",
    );

    if (
      rail === null ||
      main === null ||
      rightRail === null ||
      routePane === null
    ) {
      throw new Error("Paper shell material targets are missing");
    }

    const bodyBefore = getComputedStyle(document.body, "::before");
    const bodyAfter = getComputedStyle(document.body, "::after");
    const railStyle = getComputedStyle(rail);
    const mainStyle = getComputedStyle(main);
    const rightRailStyle = getComputedStyle(rightRail);
    const routePaneStyle = getComputedStyle(routePane);

    return {
      bodyAfterContent: bodyAfter.content,
      bodyAfterBackgroundImage: bodyAfter.backgroundImage,
      bodyBeforeContent: bodyBefore.content,
      bodyBeforeBackgroundImage: bodyBefore.backgroundImage,
      mainBackgroundColor: mainStyle.backgroundColor,
      mainBackgroundImage: mainStyle.backgroundImage,
      mainBorderRightWidth: mainStyle.borderRightWidth,
      railBackgroundColor: railStyle.backgroundColor,
      railBackgroundImage: railStyle.backgroundImage,
      railBorderRightWidth: railStyle.borderRightWidth,
      rightRailBackgroundColor: rightRailStyle.backgroundColor,
      rightRailBackgroundImage: rightRailStyle.backgroundImage,
      routeBackgroundColor: routePaneStyle.backgroundColor,
      routeBackgroundImage: routePaneStyle.backgroundImage,
    };
  });
}

function createBrowseDeleteFixture(): void {
  runBunFixtureScript(`
        import { mkdir, rm, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { schema } from "./src/server/db/index.ts";
        import { initializeDatabase } from "./src/server/db/connection.ts";

        const configPath = join(process.cwd(), ".trauma/e2e/trauma.config.json");
        const memoryId = "memory-foundation";
        const now = new Date("2026-05-09T00:00:00.000Z");
        const config = {
          storePath: "./project/store",
          projectPath: "./project",
          databasePath: "./runtime/trauma.sqlite",
          backup: {
            git: {
              enabled: false,
              remote: "origin",
              branch: "main",
              push: false,
              commitMessageTemplate: "backup memory {memoryId}",
            },
          },
        };
        const resolvedConfig = {
          configFilePath: configPath,
          projectPath: join(process.cwd(), ".trauma/e2e/project"),
          storePath: join(process.cwd(), ".trauma/e2e/project/store"),
          databasePath: join(process.cwd(), ".trauma/e2e/runtime/trauma.sqlite"),
          backup: config.backup,
        };

        await rm(join(process.cwd(), ".trauma/e2e"), { recursive: true, force: true });
        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

        const connection = initializeDatabase(resolvedConfig);
        try {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url: "https://example.com/reader-mode",
            title: "Reader Mode Notes",
            description: "Browse delete fixture",
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });
          await connection.db.insert(schema.flashbacks).values({
            id: "h-foundation",
            memoryId,
            text: "flashback-aware results",
            prefix: "Search query can be wired to",
            suffix: "through repository fixtures.",
            startOffset: 0,
            endOffset: "flashback-aware results".length,
            createdAt: now,
            updatedAt: now,
          });
          await connection.db.insert(schema.moments).values({
            id: "moment-foundation",
            memoryId,
            sectionAnchor: "details",
            sectionTitle: "Details",
            sectionLevel: 2,
            sectionPath: "1",
            createdAt: now,
            updatedAt: now,
          });
        } finally {
          connection.close();
        }

        const memoryDir = join(resolvedConfig.storePath, "memories", memoryId);
        await mkdir(memoryDir, { recursive: true });
        await writeFile(
          join(memoryDir, "CONTENT.md"),
          "# Reader Mode Notes\\n\\nBrowse delete fixture content.\\n",
          "utf8",
        );
      `);
}
