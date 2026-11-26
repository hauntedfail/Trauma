import { expect, test, type Locator, type Page } from "@playwright/test";

import { materializeE2eFixture, resetE2eFixture } from "./bun-fixture";

test.beforeEach(async () => {
  await resetE2eFixture("read_only");
});

test("redirects the home route to the canonical memories browse route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

for (const variant of [
  { brightness: "sun", width: 390, accent: "rgb(122, 27, 37)" },
  { brightness: "night", width: 1280, accent: "rgb(200, 108, 126)" },
]) {
  test(`shows the Shelf actions at ${variant.width}px in ${variant.brightness} mode`, async ({ page }) => {
    await createBrowseDeleteFixture();
    await page.addInitScript((brightness) => localStorage.setItem("trauma:brightness", brightness), variant.brightness);
    await page.setViewportSize({ width: variant.width, height: 840 });
    await page.goto("/memories?lane=shelf");
    const row = page.locator("article", { hasText: "Reader Mode Notes" }).first();
    const today = row.getByRole("button", { name: /to Today/ });
    const library = row.getByRole("button", { name: /to Library/ });
    const archive = row.getByRole("button", { name: /Archive/ });
    const quiet = await library.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(quiet).not.toBe(variant.accent);
    await expect(today).toHaveCSS("background-color", quiet);
    await expect(archive).toHaveCSS("background-color", quiet);
    for (const action of [today, library, archive]) {
      await expect(action).toBeInViewport({ ratio: 1 });
    }
  });
}

test("aligns the desktop brand mark with left rail tab icons", async ({ page }) => {
  await page.goto("/memories");

  const brandBox = await page
    .getByRole("link", { name: "TRAUMA home" })
    .locator("img")
    .boundingBox();
  const todayIconBox = await page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Today" })
    .locator("span")
    .first()
    .boundingBox();

  expect(brandBox).not.toBeNull();
  expect(todayIconBox).not.toBeNull();

  const brandCenter = brandBox!.x + brandBox!.width / 2;
  const todayIconCenter = todayIconBox!.x + todayIconBox!.width / 2;
  expect(Math.abs(brandCenter - todayIconCenter)).toBeLessThanOrEqual(1);
});

test("uses filled active nav icons without active tab background", async ({ page }) => {
  await page.goto("/memories");

  const todayLink = page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Today" });
  const normalState = await todayLink.evaluate((link) => {
    const firstFilledShape = link.querySelector("svg [fill]");

    return {
      backgroundColor: getComputedStyle(link).backgroundColor,
      fill: firstFilledShape?.getAttribute("fill") ?? "",
    };
  });

  expect(normalState.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(normalState.fill).toBe("currentColor");
});

test("draws the Library icon as one open book with a legible fold at native size", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const libraryIcon =
      viewport.width === 390
        ? page.locator("[data-phone-tab='library'] svg")
        : page
            .getByRole("navigation", { name: "Primary sections" })
            .getByRole("link", { name: "Library" })
            .locator("svg");

    await page.goto("/memories?lane=shelf");
    const outline = await scanIconMiddleRow(libraryIcon);
    expect(outline.inkRuns).toHaveLength(3);
    expect(Math.min(...outline.gaps)).toBeGreaterThanOrEqual(4);

    await page.goto("/memories?lane=library");
    const filled = await scanIconMiddleRow(libraryIcon);
    expect(filled.inkRuns).toHaveLength(2);
    expect(Math.min(...filled.inkRuns)).toBeGreaterThanOrEqual(6);
    expect(filled.gaps[0]).toBeGreaterThanOrEqual(1);
  }
});

async function scanIconMiddleRow(icon: Locator) {
  await expect(icon).toHaveCount(1);
  return icon.evaluate(async (svg) => {
    const size = Math.round(svg.getBoundingClientRect().width);
    const markup = new XMLSerializer()
      .serializeToString(svg)
      .replaceAll("currentColor", "#000")
      .replaceAll("var(--bg-base)", "#fff");
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas is unavailable");
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const row = context.getImageData(0, Math.floor(size / 2), size, 1).data;
    const inkRuns: number[] = [];
    const gaps: number[] = [];
    let run = 0;
    let gap = 0;
    for (let x = 0; x < size; x += 1) {
      const isInk = row[x * 4]! < 128;
      if (isInk) {
        if (gap > 0 && inkRuns.length > 0) {
          gaps.push(gap);
        }
        gap = 0;
        run += 1;
      } else {
        if (run > 0) {
          inkRuns.push(run);
        }
        run = 0;
        gap += 1;
      }
    }
    if (run > 0) {
      inkRuns.push(run);
    }
    return { gaps, inkRuns, size };
  });
}

test("keeps paper active nav underline under the icon while removing active tab background", async ({
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

  const todayLink = page
    .getByRole("navigation", { name: "Primary sections" })
    .getByRole("link", { name: "Today" });
  const paperState = await todayLink.evaluate((link) => {
    const linkUnderline = getComputedStyle(link, "::after");

    return {
      animationName: linkUnderline.animationName,
      backgroundColor: getComputedStyle(link).backgroundColor,
      underlineBottom: linkUnderline.bottom,
      underlineContent: linkUnderline.content,
      underlineLeft: linkUnderline.left,
      underlineRight: linkUnderline.right,
    };
  });

  expect(paperState.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(paperState.underlineContent).toBe('""');
  expect(paperState.underlineLeft).toBe("6px");
  expect(paperState.underlineRight).toBe("6px");
  expect(paperState.underlineBottom).toBe("2px");
  expect(paperState.animationName).toBe("trauma-handwrite-underline");
});

test("keeps paper active nav underline under the icon on dark paper theme", async ({
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
    const linkUnderline = getComputedStyle(link, "::after");

    return {
      underlineBottom: linkUnderline.bottom,
      underlineContent: linkUnderline.content,
      underlineLeft: linkUnderline.left,
      underlineRight: linkUnderline.right,
    };
  });

  expect(underlineState.underlineContent).toBe('""');
  expect(underlineState.underlineLeft).toBe("6px");
  expect(underlineState.underlineRight).toBe("6px");
  expect(underlineState.underlineBottom).toBe("2px");
});

test("updates URL query state from Library search and Filters popover without debt counters (AC 2)", async ({
  page,
}) => {
  const debtPattern = /\d+\s+(unread|items|memories|left|waiting)/i;

  // Check Today, Shelf, and Library for zero debt counters and zero All/Unread/Read tabs
  for (const route of ["/memories", "/memories?lane=shelf", "/memories?lane=library"]) {
    await page.goto(route);
    await expect(page.getByRole("tablist", { name: "Memory read status" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Unread" })).toHaveCount(0);
    const bodyText = await page.locator("main").innerText();
    expect(bodyText).not.toMatch(debtPattern);
    // Taxonomy counts must not appear outside the Filters popover
    await expect(page.locator("[data-taxonomy-count]")).toHaveCount(0);
  }

  // Library search + Filters popover
  await page.goto("/memories?lane=library");
  await page.getByRole("searchbox", { name: "Search memories" }).fill("browse");
  await expect(page).toHaveURL(/lane=library/);
  await expect(page).toHaveURL(/q=browse/);
  await expect(page.getByText("Browse Shell Sketch")).toBeVisible();

  // Compatibility: read / unread search terms still work in Library
  await page.getByRole("searchbox", { name: "Search memories" }).fill("browse read");
  await expect(page.getByText("Browse Shell Sketch")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search memories" }).fill("browse unread");
  await expect(page.getByText("No matching memories")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search memories" }).fill("");

  // Open single Filters popover: categories, tags with counts inside popover only, Flashback, in:archive, sort
  await page.getByRole("button", { name: "Filters" }).click();
  const popover = page.getByRole("dialog", { name: "Library filters" });
  await expect(popover).toBeVisible();
  await expect(popover.locator("[data-taxonomy-count]").first()).toBeVisible();

  await popover.getByRole("button", { name: "Last opened" }).click();
  await expect(page).toHaveURL(/sort=last_opened/);

  await popover.getByRole("button", { name: "in:archive" }).click();
  await expect(page).toHaveURL(/in%3Aarchive/);

  await popover.getByRole("button", { name: "Clear all" }).click();
  await expect(popover).toHaveCount(0);
  await expect(page).not.toHaveURL(/sort=last_opened/);
  await expect(page).not.toHaveURL(/in%3Aarchive/);
});

test("loads additional Shelf pages via cursor pagination with no total count", async ({ page }) => {
  await page.goto("/memories?lane=shelf");

  await expect(page.getByRole("list", { name: "Shelf memories" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(30);
  await expect(
    page.getByRole("link", { name: "Open memory Pagination Fixture 31" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Load more" }).click();

  await expect(
    page.getByRole("link", { name: "Open memory Pagination Fixture 31" }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(33);
  const memoryTitles = await page
    .locator("article h2")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
  expect(new Set(memoryTitles).size).toBe(memoryTitles.length);

  await page.goto("/memories?lane=shelf&q=Pagination+Fixture+31");

  await expect(
    page.getByRole("link", { name: "Open memory Pagination Fixture 31" }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);
});

test("uses a native full-row memory link for whitespace, keyboard, and new-tab navigation", async ({
  context,
  page,
}) => {
  await page.goto("/memories");

  const row = page.locator("article", { hasText: "Local Hosting Checklist" }).first();
  const rowLink = row.getByRole("link", {
    name: "Open memory Local Hosting Checklist",
  });
  const linkGeometry = await rowLink.evaluate((link) => {
    const linkRect = link.getBoundingClientRect();
    const rowRect = link.closest("article")?.getBoundingClientRect() ?? new DOMRect();
    return {
      heightDelta: Math.abs(linkRect.height - rowRect.height),
      leftDelta: Math.abs(linkRect.left - rowRect.left),
      topDelta: Math.abs(linkRect.top - rowRect.top),
      widthDelta: Math.abs(linkRect.width - rowRect.width),
    };
  });

  expect(linkGeometry.heightDelta).toBeLessThanOrEqual(1);
  expect(linkGeometry).toMatchObject({
    leftDelta: 0,
    topDelta: 0,
    widthDelta: 0,
  });

  const newTabPromise = context.waitForEvent("page");
  await rowLink.click({ button: "middle" });
  const newTab = await newTabPromise;
  await newTab.waitForLoadState("domcontentloaded");
  await expect(newTab).toHaveURL(/\/memories\/memory-ops$/);
  await newTab.close();

  await rowLink.focus();
  await rowLink.press("Enter");
  await expect(page).toHaveURL(/\/memories\/memory-ops$/);
  await page.goBack();

  const restoredRow = page.locator("article", { hasText: "Local Hosting Checklist" }).first();
  await restoredRow.click({ position: { x: 8, y: 8 } });
  await expect(page).toHaveURL(/\/memories\/memory-ops$/);
});

test("keeps the memories search focus indicator on the rounded search surface", async ({
  page,
}) => {
  await page.goto("/memories?lane=library");

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
  const filtersRadius = await page
    .locator("[data-library-filters-trigger='true']")
    .evaluate((trigger) => getComputedStyle(trigger).borderTopLeftRadius);
  expect(focusState.surfaceBorderRadius).toBe(filtersRadius);
});

test("renders flat rows within 720px browse column with 20px favicon, length bucket, and resumption cue only when present", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories");

  const columnWidth = await page
    .locator(".trauma-browse-column")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(columnWidth).toBeLessThanOrEqual(720);

  const readerRow = page.locator("article", { hasText: "Reader Mode Notes" }).first();
  const faviconBox = await readerRow.locator("[data-memory-favicon='true']").boundingBox();
  expect(faviconBox).not.toBeNull();
  expect(Math.round(faviconBox!.width)).toBe(20);
  expect(Math.round(faviconBox!.height)).toBe(20);

  await expect(readerRow.locator("[data-memory-secondary-line='true']")).toHaveText(
    "example.com · medium · continue at 3/7",
  );
  // No description paragraph, no taxonomy chips in Today
  await expect(readerRow).not.toContainText("SolidStart route data and shell architecture notes");
  await expect(readerRow.locator("[data-memory-taxonomy-chips='true']")).toHaveCount(0);

  const opsRow = page.locator("article", { hasText: "Local Hosting Checklist" }).first();
  await expect(opsRow.locator("[data-memory-secondary-line='true']")).toHaveText(
    "example.com · short",
  );

  // Taxonomy chips appear ONLY in Library
  await page.goto("/memories?lane=library");
  const libraryRow = page.locator("article", { hasText: "Browse Shell Sketch" }).first();
  await expect(libraryRow.locator("[data-memory-secondary-line='true']")).toHaveText(
    "example.com · long",
  );
  await expect(libraryRow.locator("[data-memory-taxonomy-chips='true']")).toBeVisible();
  await expect(libraryRow).toContainText("Product");
});

test("keeps browse read-status toggles from opening the memory row", async ({
  page,
}) => {
  let readStatusRequestCount = 0;
  await page.route("**/api/memories/read-status", async (route) => {
    readStatusRequestCount += 1;
    const body = route.request().postDataJSON() as {
      memoryId?: string;
      read?: boolean;
    };

    expect(body).toMatchObject({
      memoryId: "memory-design",
      read: false,
    });
    await route.fulfill({
      body: JSON.stringify({ memoryId: body.memoryId, read: body.read }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/memories?lane=library");

  const row = page.locator("article", {
    has: page.getByRole("link", { name: "Open memory Browse Shell Sketch" }),
  });
  const readToggle = row.getByRole("button", { name: "Mark memory unread" });
  const readStatusResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/memories/read-status") &&
      response.request().method() === "POST",
  );

  await readToggle.click();

  expect((await readStatusResponse).status()).toBe(200);
  expect(readStatusRequestCount).toBe(1);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);
  await expect(page.locator("#reader-state-title")).toHaveCount(0);
});

test("deletes a memory from the browse list through the public DELETE route", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();
  await page.goto("/memories?lane=shelf&q=reader+mode");

  const deletedMemoryLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  await expect(deletedMemoryLink).toBeVisible();

  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}`) &&
      response.request().method() === "DELETE",
  );
  const actions = page.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(async () => {
    if (await actions.getAttribute("aria-expanded") !== "true") {
      await actions.click();
    }
    await expect(actions).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5_000 });
  const deleteItem = page.getByRole("menuitem", { name: "Delete memory" });
  await expect(deleteItem).toBeFocused();
  await deleteItem.press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  await expect(confirmation).toContainText(
    'Delete memory "Reader Mode Notes"? This action cannot be undone.',
  );
  const cancel = confirmation.getByRole("button", { name: "Cancel" });
  const confirm = confirmation.getByRole("button", { name: "Delete memory" });
  await expect(cancel).toBeFocused();
  await cancel.press("Tab");
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");

  expect((await deleteResponse).status()).toBe(204);
  await expect(deletedMemoryLink).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Memory page results" }))
    .toBeFocused();
  await expect(page.getByText("Failed to delete memory.")).toHaveCount(0);
});

test("moves keyboard focus to the next memory after deleting a row", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();
  await page.goto("/memories?lane=shelf");

  const nextMemoryLink = page.getByRole("link", {
    name: "Open memory Archive Import Runbook",
  });
  await expect(nextMemoryLink).toBeVisible();
  const actions = page.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(async () => {
    if (await actions.getAttribute("aria-expanded") !== "true") {
      await actions.click();
    }
    await expect(actions).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Delete memory" }).press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");

  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}`) &&
      response.request().method() === "DELETE",
  );
  await confirmation.getByRole("button", { name: "Delete memory" }).press("Enter");

  expect((await deleteResponse).status()).toBe(204);
  await expect(nextMemoryLink).toBeFocused();
});

test("restores confirm focus when an async memory deletion fails", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();
  let releaseDelete: (() => void) | undefined;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let markDeleteStarted: (() => void) | undefined;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  await page.route(`**/api/memories/${memoryId}`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    markDeleteStarted?.();
    await deleteGate;
    await route.fulfill({
      body: JSON.stringify({ error: "fixture delete failure" }),
      contentType: "application/json",
      status: 500,
    });
  });
  await page.goto("/memories?lane=shelf&q=reader+mode");

  const actions = page.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(async () => {
    if (await actions.getAttribute("aria-expanded") !== "true") {
      await actions.click();
    }
    await expect(actions).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Delete memory" }).press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  const confirm = confirmation.getByRole("button", { name: "Delete memory" });
  await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");
  await deleteStarted;

  await expect(confirm).toBeDisabled();
  await expect(confirmation.locator("[aria-busy='true']")).toBeFocused();
  releaseDelete?.();

  await expect(
    page
      .getByRole("menu", { name: "Memory actions for Reader Mode Notes" })
      .getByRole("alert"),
  ).toHaveText("Failed to delete memory.");
  await expect(confirmation).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeFocused();
});

test("keeps user focus when an async confirmation fails after dismissal", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();
  let releaseDelete: (() => void) | undefined;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let markDeleteStarted: (() => void) | undefined;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  await page.route(`**/api/memories/${memoryId}`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    markDeleteStarted?.();
    await deleteGate;
    await route.fulfill({
      body: JSON.stringify({ error: "fixture delete failure" }),
      contentType: "application/json",
      status: 500,
    });
  });
  await page.goto("/memories?lane=shelf&q=reader+mode");

  const actions = page.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(async () => {
    if (await actions.getAttribute("aria-expanded") !== "true") {
      await actions.click();
    }
    await expect(actions).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Delete memory" }).press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  const confirm = confirmation.getByRole("button", { name: "Delete memory" });
  await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
  await confirm.press("Enter");
  await deleteStarted;
  await expect(confirmation.locator("[aria-busy='true']")).toBeFocused();

  const outsideTarget = page.getByRole("button", { name: "Theme" });
  await outsideTarget.click();
  await expect(confirmation).toHaveCount(0);
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}`) &&
      response.request().method() === "DELETE",
  );
  releaseDelete?.();

  expect((await deleteResponse).status()).toBe(500);
  await expect(
    page
      .locator("article", { hasText: "Reader Mode Notes" })
      .getByRole("alert"),
  ).toHaveText("Failed to delete memory.");
  await expect(confirmation).toHaveCount(0);
});

test("does not restore row focus after a pending confirmation is dismissed", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();
  let releaseDelete: (() => void) | undefined;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let markDeleteStarted: (() => void) | undefined;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  await page.route(`**/api/memories/${memoryId}`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    markDeleteStarted?.();
    await deleteGate;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/memories?lane=shelf&q=reader+mode");

  const actions = page.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(async () => {
    if (await actions.getAttribute("aria-expanded") !== "true") {
      await actions.click();
    }
    await expect(actions).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Delete memory" }).press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
  await confirmation.getByRole("button", { name: "Delete memory" }).press("Enter");
  await deleteStarted;
  await expect(confirmation.locator("[aria-busy='true']")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}`) &&
      response.request().method() === "DELETE",
  );
  releaseDelete?.();

  expect((await deleteResponse).status()).toBe(204);
  await expect(page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Memory page results" }))
    .not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
});

test("skips a connected next memory link in a deferred hydration state", async ({
  page,
}) => {
  const memoryPageQueryId =
    "src_components_memories_browse-loader_ts--getBrowseMemoryPage_query";
  await page.goto("/memories?lane=shelf");

  let releaseRevalidation: (() => void) | undefined;
  const revalidationGate = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  await page.route(
    (url) =>
      url.pathname === "/_server/" &&
      url.searchParams.get("id") === memoryPageQueryId,
    async (route) => {
      await revalidationGate;
      await route.continue();
    },
  );
  await page.route("**/api/memories/memory-pagination-01", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.continue();
  });

  try {
    const previousLink = page.getByRole("link", {
      name: "Open memory Archive Import Runbook",
    });
    const hydratingNextLink = page
      .locator("article[data-collection-row='memory-pagination-02']")
      .locator("[data-collection-primary-link]");
    await hydratingNextLink.evaluate((link) => {
      // Match MemoryBrowse while selected-flashback hydration is deferred.
      link.setAttribute("aria-disabled", "true");
      link.removeAttribute("href");
    });
    await expect(hydratingNextLink).toHaveAttribute("aria-disabled", "true");
    await expect(hydratingNextLink).not.toHaveAttribute("href", /.+/);

    const actions = page.getByRole("button", {
      name: "Memory actions for Pagination Fixture 1",
      exact: true,
    });
    await expect(async () => {
      if (await actions.getAttribute("aria-expanded") !== "true") {
        await actions.click();
      }
      await expect(actions).toHaveAttribute("aria-expanded", "true", {
        timeout: 500,
      });
    }).toPass({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: "Delete memory" }).press("Enter");
    const confirmation = page.getByRole("dialog", {
      name: "Delete memory Pagination Fixture 1 confirmation",
    });
    await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/memories/memory-pagination-01") &&
        response.request().method() === "DELETE",
    );
    await confirmation.getByRole("button", { name: "Delete memory" }).press("Enter");

    expect((await deleteResponse).status()).toBe(204);
    await expect(previousLink).toBeFocused();
  } finally {
    releaseRevalidation?.();
  }
});

test("removes right rail completely at 1280x800 and keeps slim 56px left rail (AC 1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories");

  await expect(page.getByRole("complementary", { name: "Browse filters" })).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(
      'aside[aria-label="Primary navigation"]',
    );
    const main = document.querySelector<HTMLElement>("main");
    if (rail === null || main === null) {
      throw new Error("Missing rail or main element");
    }

    const railRect = rail.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const rightSideWideElements: string[] = [];

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element === main || main.contains(element) || element.contains(main)) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width > 80 && rect.height > 0 && rect.left >= mainRect.right - 1) {
        rightSideWideElements.push(
          `${element.tagName.toLowerCase()}.${element.className} (${Math.round(rect.width)}px)`,
        );
      }
    }

    return {
      railWidth: Math.round(railRect.width),
      rightSideWideElements,
    };
  });

  expect(geometry.railWidth).toBe(56);
  expect(geometry.rightSideWideElements).toEqual([]);
});

test("opens command palette via Ctrl/Cmd+K from every route, restores focus on Esc, and supports search, navigation, URL capture validation, and focus plugin toggles (AC 8)", async ({
  page,
}) => {
  await createBrowseDeleteFixture();
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const route of [
    "/memories",
    "/memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901",
    "/flashbacks",
    "/moments",
    "/settings",
  ]) {
    await page.goto(route);
    await expect(
      page.locator('.trauma-shell-frame[data-shell-hydrated="true"]'),
    ).toBeVisible();
    const homeLink = page.getByRole("link", { name: "TRAUMA home" });
    await homeLink.focus();
    await expect(homeLink).toBeFocused();

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await expect(
      palette.getByRole("combobox", { name: "Search memories or run a command" }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(homeLink).toBeFocused();
  }

  // Test search, plugin toggle, URL validation error, and route navigation on /memories.
  await page.goto("/memories");
  await expect(
    page.locator('.trauma-shell-frame[data-shell-hydrated="true"]'),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const combobox = palette.getByRole("combobox", {
    name: "Search memories or run a command",
  });

  // 1. Search memories via existing browse search backend
  await combobox.fill("Reader Mode");
  await expect(
    palette.getByRole("option", { name: /Reader Mode Notes/ }),
  ).toBeVisible();

  // 2. Toggle a focus plugin via FocusPluginContext
  await combobox.fill("Reading Ruler");
  const rulerOption = palette.getByRole("option", {
    name: /Toggle Digital Reading Ruler/i,
  });
  await expect(rulerOption).toBeVisible();
  await expect(rulerOption).toContainText("Off");
  await rulerOption.click();
  await expect(rulerOption).toContainText("On");

  // 3. Capture URL validation (empty & invalid stay open with role=alert)
  await combobox.fill("Add URL");
  await palette.getByRole("option", { name: /Add URL/ }).click();
  const urlInput = palette.getByRole("textbox", { name: "URL to capture" });
  await expect(urlInput).toBeFocused();
  await palette.getByRole("button", { name: "Save to Shelf" }).click();
  await expect(palette.getByRole("alert")).toContainText("Enter a URL before saving.");
  await expect(palette).toBeVisible();

  await urlInput.fill("not-a-valid-url");
  await palette.getByRole("button", { name: "Save to Shelf" }).click();
  await expect(palette.getByRole("alert")).toContainText(
    "Enter a valid http:// or https:// URL.",
  );
  await expect(palette).toBeVisible();

  // 4. Back to search and navigate to Shelf lane
  await palette.getByRole("button", { name: "Back" }).click();
  await combobox.fill("Go to Shelf");
  await palette.getByRole("option", { name: /Go to Shelf/ }).click();
  await expect(palette).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories\?lane=shelf$/);
});

test("auto-hides left rail on reader downward scroll and reveals on upward scroll, left-edge pointer, Esc, and focus", async ({
  page,
}) => {
  await createBrowseDeleteFixture();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901");
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );

  // Ensure document has enough scroll height to exercise downward scroll cleanly.
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
  });

  const rail = page.locator('aside[aria-label="Primary navigation"]');
  await expect(rail).toHaveAttribute("data-rail-hidden", "false");

  // Downward scroll hides the left rail
  await page.evaluate(() => {
    window.scrollTo(0, 120);
    window.dispatchEvent(new Event("scroll"));
  });
  await expect(rail).toHaveAttribute("data-rail-hidden", "true");

  // Left-edge pointer approach reveals it
  await page.mouse.move(8, 200);
  await expect(rail).toHaveAttribute("data-rail-hidden", "false");

  // Scroll down further to hide again, then reveal with Escape
  await page.evaluate(() => {
    window.scrollTo(0, 320);
    window.dispatchEvent(new Event("scroll"));
  });
  await expect(rail).toHaveAttribute("data-rail-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(rail).toHaveAttribute("data-rail-hidden", "false");

  // Scroll down further to hide again, then reveal on keyboard focus entering rail
  await page.evaluate(() => {
    window.scrollTo(0, 520);
    window.dispatchEvent(new Event("scroll"));
  });
  await expect(rail).toHaveAttribute("data-rail-hidden", "true");
  await rail.getByRole("link", { name: "TRAUMA home" }).focus();
  await expect(rail).toHaveAttribute("data-rail-hidden", "false");
});

test("closes inline row taxonomy controls on outside clicks", async ({ page }) => {
  await page.goto("/memories?lane=library");

  const row = page.locator("article", { hasText: "Browse Shell Sketch" }).first();
  await row.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("dialog", { name: "Add tag" })).toBeVisible();

  await row.getByRole("link", { name: "Open memory Browse Shell Sketch" }).click();

  await expect(page.getByRole("dialog", { name: "Add tag" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);
  await expect(page.locator("#reader-state-title")).toHaveCount(0);
});

test("uses bottom primary tabs without drawer chrome on phone viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open filters" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toHaveCount(0);

  const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
  await expect(primaryTabs).toBeVisible();
  await expect(primaryTabs.locator("[data-phone-tab]")).toHaveCount(4);

  await primaryTabs.getByRole("button", { name: "More" }).click();
  const moreSheet = page.getByRole("dialog", { name: "More navigation" });
  await expect(moreSheet).toBeVisible();
  await moreSheet.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);
});

test("keeps phone browse header clean without All/Unread/Read tabs or debt counters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memories");

  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Memory read status" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "View mode" })).toHaveCount(0);
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
  await expect(page.getByRole("complementary", { name: "Browse filters" })).toHaveCount(0);
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
  const navLabels = await primarySections.locator("a").evaluateAll((nodes) =>
    nodes
      .map((node) => node.textContent?.trim().replace(/\s+/g, " "))
      .filter((text): text is string => text !== undefined && text.length > 0),
  );
  expect(navLabels).toEqual([
    "Today",
    "Shelf",
    "Library",
    "Flashbacks",
    "Moments",
    "Settings",
  ]);

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
      railBackgroundColor: "rgba(0, 0, 0, 0)",
      railBackgroundImage: "none",
      railBorderRightWidth: "1px",
      routeBackgroundColor: "rgba(0, 0, 0, 0)",
      routeBackgroundImage: "none",
    });

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
      railBackgroundColor: "rgba(0, 0, 0, 0)",
      railBackgroundImage: "none",
      railBorderRightWidth: "1px",
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

test("preserves URL search and grid view query params on reload", async ({ page }) => {
  await page.goto("/memories?lane=library&q=browse&view=grid");
  await expect(page.locator(".trauma-memory-list")).toHaveClass(/memory-grid/);
  await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveValue(
    "browse",
  );
  await expect(page).toHaveURL(/q=browse/);
  await expect(page).toHaveURL(/view=grid/);
});

test("does not navigate shell and result links to the catch-all route", async ({ page }) => {
  await createBrowseDeleteFixture();
  await page.goto("/memories?lane=shelf");

  await page.getByRole("link", { name: "Flashbacks" }).click();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expect(page.getByRole("heading", { name: "Flashbacks", exact: true })).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);

  await page.goto("/memories?lane=shelf");
  await page
    .getByRole("link", { name: "Open memory Reader Mode Notes" })
    .click();
  await expect(page).toHaveURL(/\/memories\/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901$/);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
  await expect(page.getByText("Page not found")).toHaveCount(0);

  await page.goto("/memories?lane=shelf");
  await expect(
    page.locator('.trauma-shell-frame[data-shell-hydrated="true"]'),
  ).toBeVisible();
  const readerNotesLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  await readerNotesLink.focus();
  await expect(readerNotesLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/memories\/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901$/);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );

  await page.goto("/flashbacks");
  await page.getByRole("link", { name: "Reader Mode Notes" }).click();
  await expect(page).toHaveURL(/\/memories\/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901#h-foundation$/);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

test("preserves native Enter activation on a focused browse result link", async ({
  page,
}) => {
  await page.goto("/memories");

  const readerLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  const opsLink = page.getByRole("link", {
    name: "Open memory Local Hosting Checklist",
  });
  const readerRow = readerLink.locator("xpath=ancestor::article");

  await expect(readerLink).toBeVisible();
  await expect(opsLink).toBeVisible();
  await expect(
    page.locator('.trauma-shell-frame[data-shell-hydrated="true"]'),
  ).toBeVisible();

  await page.keyboard.press("j");
  await expect(readerRow).toHaveAttribute("data-keyboard-selected", "false");

  await opsLink.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/memories\/memory-ops$/);
  await expect(page.locator("#reader-state-title")).toBeVisible();
});

test("supports roving tabindex and j/k/Enter keyboard navigation on browse lanes", async ({
  page,
}) => {
  await page.goto("/memories");

  const readerLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  const opsLink = page.getByRole("link", {
    name: "Open memory Local Hosting Checklist",
  });
  const readerRow = readerLink.locator("xpath=ancestor::article");
  const opsRow = opsLink.locator("xpath=ancestor::article");

  await expect(readerLink).toBeVisible();
  await expect(opsLink).toBeVisible();
  await expect(readerLink).toHaveAttribute("tabindex", "0");
  await expect(opsLink).toHaveAttribute("tabindex", "-1");

  await readerLink.focus();
  await page.keyboard.press("j");
  await expect(opsRow).toHaveAttribute("data-keyboard-selected", "true");
  await expect(opsLink).toBeFocused();
  await expect(opsLink).toHaveAttribute("tabindex", "0");
  await expect(readerLink).toHaveAttribute("tabindex", "-1");

  await page.keyboard.press("k");
  await expect(readerRow).toHaveAttribute("data-keyboard-selected", "true");
  await expect(readerLink).toBeFocused();

  await page.goto("/memories?lane=library");
  const searchBox = page.getByRole("searchbox", { name: "Search memories" });
  await expect(searchBox).toBeEnabled();
  await page.keyboard.press("/");
  await expect(searchBox).toBeFocused();
  await page.keyboard.press("j");
  await expect(searchBox).toHaveValue("j");
  await searchBox.fill("browse");
  await page.keyboard.press("Escape");
  await expect(searchBox).not.toBeFocused();
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

  await page.goto("/memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901");
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

test("moves focus through shared dialogs and menus and returns it to the opener", async ({
  page,
}) => {
  await page.goto("/memories");

  const themeTrigger = page.getByRole("button", { name: "Theme" });
  await themeTrigger.click();

  const themeDialog = page.getByRole("dialog", { name: "Theme settings" });
  await expect(themeDialog).toBeVisible();
  await expect(themeDialog.getByRole("button", { name: "Sun" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(themeDialog).toHaveCount(0);
  await expect(themeTrigger).toBeFocused();

  const readerRow = page.locator("article", { hasText: "Reader Mode Notes" }).first();
  const menuTrigger = readerRow.getByRole("button", {
    name: "Memory actions for Reader Mode Notes",
  });
  await menuTrigger.click();

  const menu = page.getByRole("menu", {
    name: "Memory actions for Reader Mode Notes",
  });
  await expect(menu).toBeVisible();
  const deleteItem = menu.getByRole("menuitem", { name: "Delete memory" });
  const categoryItem = menu.getByRole("menuitem", { name: "Add category" });
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();

  await menuTrigger.click();
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(categoryItem).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);

  await menuTrigger.focus();
  await menuTrigger.click();
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(categoryItem).toBeFocused();
  await page.keyboard.press("Home");
  await expect(deleteItem).toBeFocused();

  await deleteItem.click();
  const confirmation = page.getByRole("dialog", {
    name: "Delete memory Reader Mode Notes confirmation",
  });
  const cancelConfirmation = confirmation.getByRole("button", {
    name: "Cancel",
  });
  await expect(cancelConfirmation).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(deleteItem).toBeFocused();

  await deleteItem.click();
  await expect(cancelConfirmation).toBeFocused();
  await cancelConfirmation.click();
  await expect(confirmation).toHaveCount(0);
  await expect(deleteItem).toBeFocused();

  await deleteItem.click();
  const outsideTarget = page.getByRole("button", { name: "Theme" });
  await outsideTarget.click();
  await expect(confirmation).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);
  await expect(menu).toHaveCount(0);
});

test("returns taxonomy creation focus after keyboard dismissal", async ({ page }) => {
  await page.goto("/memories?lane=library");

  const libraryRow = page.locator("article", { hasText: "Browse Shell Sketch" }).first();
  const addTagTrigger = libraryRow.getByRole("button", { name: "Add tag" });
  await addTagTrigger.click();

  const tagDialog = page.getByRole("dialog", { name: "Add tag" });
  await expect(tagDialog).toBeVisible();
  const newTagButton = tagDialog.getByRole("button", { name: "New tag" });
  await newTagButton.click();

  const newTagInput = libraryRow.getByRole("textbox", { name: "New tag" });
  await expect(newTagInput).toBeFocused();
  await newTagInput.press("Escape");
  await expect(newTagInput).toHaveCount(0);
  await expect(addTagTrigger).toBeFocused();
});

test("closes the add-memory composer on outside row clicks without opening memory actions", async ({
  page,
}) => {
  await createBrowseDeleteFixture();
  await page.goto("/memories?lane=library");

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();

  const row = page.locator("article", { hasText: "Browse Shell Sketch" }).first();
  await row.getByRole("link", { name: "Open memory Browse Shell Sketch" }).click();

  await expect(page.getByRole("dialog", { name: "Add memory" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();

  await row.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Add tag" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();

  await page.getByRole("link", { name: "Open memory Browse Shell Sketch" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);
  await expect(page.locator("#reader-state-title")).toHaveCount(0);
});

test("keeps a pending add-memory attempt owned across rail dismissal and phone reopen", async ({
  page,
}) => {
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.route("**/api/memories", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      body: JSON.stringify({
        memory: { id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef401" },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.goto("/memories");

  await page.getByRole("button", { name: "Add memory" }).click();
  const railComposer = page.getByRole("dialog", { name: "Add memory" });
  const railUrl = railComposer.getByRole("textbox", { name: "URL" });
  await railUrl.fill("https://example.com/pending");
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/memories") && request.method() === "POST",
  );
  await railUrl.press("Enter");
  const request = await requestPromise;
  expect(request.headers()["idempotency-key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  await page.keyboard.press("Escape");
  await expect(railComposer).toHaveCount(0);
  await page.getByRole("button", { name: "Add memory" }).click();
  const reopenedComposer = page.getByRole("dialog", { name: "Add memory" });
  const reopenedUrl = reopenedComposer.getByRole("textbox", { name: "URL" });
  await expect(reopenedUrl).toHaveValue("https://example.com/pending");
  await expect(reopenedUrl).toBeDisabled();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/memories") &&
      response.request().method() === "POST",
  );
  releaseResponse?.();
  await responsePromise;

  await expect(page).toHaveURL(/\/memories(?:\?.*)?$/);
  await expect(reopenedComposer).toBeVisible();
  await expect(reopenedUrl).toBeEnabled();
  await expect(reopenedUrl).toHaveValue("");
  expect(requestCount).toBe(1);
});

test("does not suppress the next normal click after an outside right-click dismissal", async ({
  page,
}) => {
  await createBrowseDeleteFixture();
  await page.goto("/memories?lane=shelf");

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();

  const row = page.locator("article", { hasText: "Reader Mode Notes" }).first();
  await row
    .getByRole("link", { name: "Open memory Reader Mode Notes" })
    .click({ button: "right" });
  await expect(page.getByRole("dialog", { name: "Add memory" })).toHaveCount(0);

  await page.getByRole("link", { name: "Open memory Reader Mode Notes" }).click();

  await expect(page).toHaveURL(/\/memories\/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901$/);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
});

test("does not suppress a click after an outside pointer sequence is canceled", async ({
  page,
}) => {
  await page.goto("/memories");

  const headerHeading = page.getByRole("heading", { name: "Today", exact: true });
  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();

  await headerHeading.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerId: 17,
    pointerType: "touch",
  });
  await expect(page.getByRole("dialog", { name: "Add memory" })).toHaveCount(0);
  await headerHeading.dispatchEvent("pointercancel", {
    button: 0,
    isPrimary: true,
    pointerId: 17,
    pointerType: "touch",
  });

  const probe = await installDismissableClickProbe(page);
  await probe.evaluate((button: HTMLButtonElement) => button.click());
  await expect(probe).toHaveAttribute("data-clicked", "true");
});

test("does not suppress a click after an outside pointerup produced no click", async ({
  page,
}) => {
  await page.goto("/memories");

  const headerHeading = page.getByRole("heading", { name: "Today", exact: true });
  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  await headerHeading.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerId: 23,
    pointerType: "touch",
  });
  await headerHeading.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerId: 23,
    pointerType: "touch",
  });
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  const probe = await installDismissableClickProbe(page);
  await probe.evaluate((button: HTMLButtonElement) => button.click());
  await expect(probe).toHaveAttribute("data-clicked", "true");
});

test("expires outside click suppression when a pointer sequence goes silent", async ({
  page,
}) => {
  await page.goto("/memories");

  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByRole("dialog", { name: "Add memory" })).toBeVisible();
  const headerHeading = page.getByRole("heading", { name: "Today", exact: true });
  await headerHeading.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerId: 29,
    pointerType: "touch",
  });
  await page.evaluate(() =>
    new Promise<void>((resolve) => setTimeout(resolve, 1_300))
  );

  const probe = await installDismissableClickProbe(page);
  await probe.evaluate((button: HTMLButtonElement) => button.click());
  await expect(probe).toHaveAttribute("data-clicked", "true");
});

test("triages Shelf rows with p, l, x, u keys, persists across reload, enforces Today cap, and rolls back on failure (AC 4)", async ({
  page,
}) => {
  const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
  await createBrowseDeleteFixture();

  // 1. Today (`p`) on focused Shelf row -> persists to Today and survives reload
  await page.goto("/memories?lane=shelf");
  const readerLink = page.getByRole("link", {
    name: "Open memory Reader Mode Notes",
  });
  await expect(readerLink).toBeVisible();
  await readerLink.focus();

  const pickResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("p");
  expect((await pickResponse).status()).toBe(200);
  await expect(readerLink).toHaveCount(0);
  await expect(page.locator("[data-triage-undo-toast='true']")).toBeVisible();

  await page.reload();
  await expect(readerLink).toHaveCount(0);

  await page.goto("/memories");
  await expect(readerLink).toBeVisible();

  // 2. Undo (`u`) restores row back to Shelf and survives reload
  await page.goto("/memories?lane=shelf");
  // First return it from Today so we can test `l` and `u` cleanly from Shelf
  await page.goto("/memories");
  const notNowResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page
    .locator("article", { hasText: "Reader Mode Notes" })
    .getByRole("button", { name: /Shelf/ })
    .click();
  expect((await notNowResponse).status()).toBe(200);

  await page.goto("/memories?lane=shelf");
  await expect(readerLink).toBeVisible();
  await readerLink.focus();

  const keepResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("l");
  expect((await keepResponse).status()).toBe(200);
  await expect(readerLink).toHaveCount(0);
  await expect(page.locator("[data-triage-undo-toast='true']")).toContainText(
    "Saved to Library.",
  );

  // Undo via `u` key
  const undoResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("u");
  expect((await undoResponse).status()).toBe(200);
  await expect(readerLink).toBeVisible();

  await page.reload();
  await expect(readerLink).toBeVisible();

  // 3. Archive (`x`) -> persists to archive and appears in Library with in:archive
  await readerLink.focus();
  const letGoResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("x");
  expect((await letGoResponse).status()).toBe(200);
  await expect(readerLink).toHaveCount(0);

  await page.goto("/memories?lane=library&q=in%3Aarchive");
  await expect(readerLink).toBeVisible();

  // Restore back to Shelf for failure rollback & cap tests
  const restoreResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${memoryId}/triage`) &&
      response.request().method() === "POST",
  );
  await page
    .locator("article", { hasText: "Reader Mode Notes" })
    .getByRole("button", { name: "Restore" })
    .click();
  expect((await restoreResponse).status()).toBe(200);

  // 4. Optimistic rollback on failed triage API request (HTTP 500)
  await page.goto("/memories?lane=shelf");
  await expect(readerLink).toBeVisible();
  await page.route(`**/api/memories/${memoryId}/triage`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Simulated triage failure" }),
    });
  });

  await readerLink.focus();
  await page.keyboard.press("l");
  await expect(page.locator("[data-triage-error='true']")).toContainText(
    "Simulated triage failure",
  );
  await expect(readerLink).toBeVisible();
  await page.unroute(`**/api/memories/${memoryId}/triage`);

  // 5. Today move refused when Today is at cap (HTTP 409)
  await page.route(`**/api/memories/${memoryId}/triage`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Today is full. Finish or return one first.",
        code: "today_cap_reached",
        todayCount: 3,
        todayCap: 3,
      }),
    });
  });

  await readerLink.focus();
  await page.keyboard.press("p");
  await expect(page.locator("[data-triage-error='true']")).toContainText(
    "Today is full. Finish or return one first.",
  );
  await expect(readerLink).toBeVisible();
  await expect(
    page
      .locator("article", { hasText: "Reader Mode Notes" })
      .getByRole("button", { name: /Today/ }),
  ).toBeDisabled();
  await page.unroute(`**/api/memories/${memoryId}/triage`);
});

test("shows neutral Today empty state with link to Shelf when Today has no picked items", async ({
  page,
}) => {
  await page.route("**/api/memories/*/triage", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        memoryId: "mock",
        triageState: "shelf",
        triageChangedAt: "2026-05-09T12:00:00.000Z",
        changed: true,
      }),
    });
  });

  await page.goto("/memories");
  // Move both fixture Today items back to Shelf
  while ((await page.locator("article").count()) > 0) {
    await page.locator("article").first().getByRole("button", { name: /Shelf/ }).click();
  }

  const emptyState = page.locator("[data-today-empty-state='true']");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText(
    "Nothing picked. Choose from the Shelf when you're ready.",
  );
  const shelfLink = emptyState.getByRole("link", { name: "Open Shelf" });
  await expect(shelfLink).toHaveAttribute("href", "/memories?lane=shelf");
});

test("renders destination triage labels without retired Pick, Not now, Keep, or Let go control names (AC 13)", async ({
  page,
}) => {
  const assertNoRetiredControlNames = async (surface: string) => {
    const violations = await page.evaluate(() => {
      const retiredPattern = /^(pick|not now|keep|let go)$/i;
      const controls = document.querySelectorAll<HTMLElement>(
        'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"]',
      );
      const hits: Array<{ ariaLabel: string; text: string }> = [];
      for (const control of controls) {
        const text = (control.textContent ?? "").replace(/\s+/g, " ").trim();
        const ariaLabel = (control.getAttribute("aria-label") ?? "")
          .replace(/\s+/g, " ")
          .trim();
        if (retiredPattern.test(text) || retiredPattern.test(ariaLabel)) {
          hits.push({ ariaLabel, text });
        }
      }
      return hits;
    });

    expect(
      violations,
      `Expected no retired control names on ${surface}`,
    ).toEqual([]);
  };

  await page.setViewportSize({ width: 1280, height: 800 });

  // Today lane
  await page.goto("/memories");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const todayRow = page.locator("article").first();
  await expect(todayRow).toBeVisible();
  await expect(
    todayRow.locator("button", { hasText: /^Shelf$/ }),
  ).toBeVisible();
  await expect(
    todayRow.locator("button", { hasText: /^Archive$/ }),
  ).toBeVisible();
  await assertNoRetiredControlNames("Today");

  // Shelf lane
  await page.goto("/memories?lane=shelf");
  await expect(
    page.getByRole("heading", { name: "Shelf", exact: true }),
  ).toBeVisible();
  const shelfRow = page.locator("article").first();
  await expect(shelfRow).toBeVisible();
  await expect(
    shelfRow.locator("button", { hasText: /^Today$/ }),
  ).toBeVisible();
  await expect(
    shelfRow.locator("button", { hasText: /^Library$/ }),
  ).toBeVisible();
  await expect(
    shelfRow.locator("button", { hasText: /^Archive$/ }),
  ).toBeVisible();
  await assertNoRetiredControlNames("Shelf");

  // Library lane
  await page.goto("/memories?lane=library");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await assertNoRetiredControlNames("Library");

  // Reader + end footer + overflow popover
  await materializeE2eFixture("reader_base");
  await page.goto("/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f101");
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
  const endFooter = page.locator("[data-reader-end-footer]");
  await endFooter.scrollIntoViewIfNeeded();
  await expect(
    endFooter.getByRole("button", { exact: true, name: "Library" }),
  ).toBeVisible();
  await expect(
    endFooter.getByRole("button", { exact: true, name: "Archive" }),
  ).toBeVisible();
  await expect(
    endFooter.getByRole("button", { exact: true, name: "Shelf" }),
  ).toBeVisible();
  await assertNoRetiredControlNames("Reader");

  await page.locator("[data-reader-details-trigger]").click();
  await expect(page.locator("#reader-details-popover")).toBeVisible();
  await assertNoRetiredControlNames("Reader (Details popover open)");
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
    const routePane = document.querySelector<HTMLElement>(
      ".trauma-shell-main > .bg-trauma-bg-surface",
    );

    if (
      rail === null ||
      main === null ||
      routePane === null
    ) {
      throw new Error("Paper shell material targets are missing");
    }

    const bodyBefore = getComputedStyle(document.body, "::before");
    const bodyAfter = getComputedStyle(document.body, "::after");
    const railStyle = getComputedStyle(rail);
    const mainStyle = getComputedStyle(main);
    const routePaneStyle = getComputedStyle(routePane);

    return {
      bodyAfterContent: bodyAfter.content,
      bodyAfterBackgroundImage: bodyAfter.backgroundImage,
      bodyBeforeContent: bodyBefore.content,
      bodyBeforeBackgroundImage: bodyBefore.backgroundImage,
      mainBackgroundColor: mainStyle.backgroundColor,
      mainBackgroundImage: mainStyle.backgroundImage,
      railBackgroundColor: railStyle.backgroundColor,
      railBackgroundImage: railStyle.backgroundImage,
      railBorderRightWidth: railStyle.borderRightWidth,
      routeBackgroundColor: routePaneStyle.backgroundColor,
      routeBackgroundImage: routePaneStyle.backgroundImage,
    };
  });
}

async function installDismissableClickProbe(page: Page) {
  await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.dataset.dismissableClickProbe = "true";
    probe.textContent = "Dismissable click probe";
    probe.addEventListener("click", () => {
      probe.dataset.clicked = "true";
    });
    document.body.append(probe);
  });
  return page.locator("[data-dismissable-click-probe='true']");
}

async function createBrowseDeleteFixture(): Promise<void> {
  await materializeE2eFixture("browse_delete");
}
