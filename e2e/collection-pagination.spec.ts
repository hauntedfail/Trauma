import { expect, test, type Page } from "@playwright/test";

import { runBunFixtureScript } from "./bun-fixture";

const PAGINATION_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f177";
const PAGE_SIZE = 30;
const ARCHIVE_SIZE = 37;
const FLASHBACK_PAGE_QUERY_ID =
  "src_components_flashbacks_flashbacks-loader_ts--getFlashbackBrowsePage_query";
const MOMENT_PAGE_QUERY_ID =
  "src_components_moments_moments-loader_ts--getMomentBrowsePage_query";

test.describe.configure({ mode: "serial" });

test("paginates large Flashback and Moment archives through URL history", async ({
  page,
}) => {
  seedLargeCollectionArchive();

  await page.goto("/flashbacks");
  await expectCollectionPage(page, PAGE_SIZE, "Flashback selection 37");
  await expect(page.getByText("Flashback selection 07", { exact: false })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Flashback pages" })
    .getByRole("link", { name: "Next" })
    .click();
  await expect(page).toHaveURL(/\/flashbacks\?cursor=/);
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Flashback selection 07");
  await expect(page.getByText("Flashback selection 37", { exact: false })).toHaveCount(0);

  await page.reload();
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Flashback selection 07");
  await page.goBack();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expectCollectionPage(page, PAGE_SIZE, "Flashback selection 37");

  await page.goto("/moments");
  await expectCollectionPage(page, PAGE_SIZE, "Moment Section 37");
  await expect(page.getByText("Moment Section 07", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Moment pages" })
    .getByRole("link", { name: "Next" })
    .click();
  await expect(page).toHaveURL(/\/moments\?cursor=/);
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Moment Section 07");
  await expect(page.getByText("Moment Section 37", { exact: true })).toHaveCount(0);

  await page.reload();
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Moment Section 07");
  await page.goBack();
  await expect(page).toHaveURL(/\/moments$/);
  await expectCollectionPage(page, PAGE_SIZE, "Moment Section 37");
});

test("keeps Reader All Flashbacks on one bounded rail-local page", async ({ page }) => {
  seedLargeCollectionArchive();
  await page.setViewportSize({ width: 1440, height: 760 });

  await page.goto(`/memories/${PAGINATION_MEMORY_ID}`);
  await waitForReaderReady(page);
  const flashbackSection = page
    .getByRole("heading", { name: "Flashbacks", exact: true })
    .locator("xpath=..");
  await flashbackSection.getByRole("button", { name: "All", exact: true }).click();

  const listBody = flashbackSection.locator("div.overflow-y-auto").first();
  const pageControls = flashbackSection.getByRole("navigation", {
    name: "All Flashback pages",
  });
  await expect(listBody.getByRole("link")).toHaveCount(PAGE_SIZE);
  await expect(listBody.getByText("Flashback selection 37", { exact: false })).toBeVisible();
  await expect(listBody.getByText("Flashback selection 07", { exact: false })).toHaveCount(0);
  await expect(pageControls.getByRole("button", { name: "Previous" })).toBeDisabled();

  const scrollStyle = await listBody.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      overscrollBehaviorY: style.overscrollBehaviorY,
    };
  });
  expect(scrollStyle.maxHeight).not.toBe("none");
  expect(scrollStyle.overflowY).toBe("auto");
  expect(scrollStyle.overscrollBehaviorY).toBe("contain");

  await pageControls.getByRole("button", { name: "Next" }).click();
  await expect(listBody.getByRole("link")).toHaveCount(ARCHIVE_SIZE - PAGE_SIZE);
  await expect(listBody.getByText("Flashback selection 07", { exact: false })).toBeVisible();
  await expect(listBody.getByText("Flashback selection 37", { exact: false })).toHaveCount(0);

  await flashbackSection.getByRole("button", { name: "Current", exact: true }).click();
  await flashbackSection.getByRole("button", { name: "All", exact: true }).click();
  await expect(listBody.getByRole("link")).toHaveCount(ARCHIVE_SIZE - PAGE_SIZE);

  await pageControls.getByRole("button", { name: "Previous" }).click();
  await expect(listBody.getByRole("link")).toHaveCount(PAGE_SIZE);
  await pageControls.getByRole("button", { name: "Next" }).click();
  await expect(listBody.getByRole("link")).toHaveCount(ARCHIVE_SIZE - PAGE_SIZE);
  await pageControls.getByRole("button", { name: "First" }).click();
  await expect(listBody.getByRole("link")).toHaveCount(PAGE_SIZE);
});

test("retries failed first Flashback and Moment pages without resetting the URL", async ({
  page,
}) => {
  seedLargeCollectionArchive();

  for (const surface of [
    {
      failureTitle: "Failed to load flashbacks",
      navLabel: "Flashbacks",
      pathname: "/flashbacks",
      queryId: FLASHBACK_PAGE_QUERY_ID,
      regionName: "Flashback page results",
      retryName: "Retry flashbacks",
      retryingName: "Retrying flashbacks...",
    },
    {
      failureTitle: "Failed to load Moments",
      navLabel: "Moments",
      pathname: "/moments",
      queryId: MOMENT_PAGE_QUERY_ID,
      regionName: "Moment page results",
      retryName: "Retry Moments",
      retryingName: "Retrying Moments...",
    },
  ] as const) {
    await page.goto("/memories");
    const interception = await interceptCollectionPageRetry(page, surface.queryId);
    try {
      await page
        .getByRole("navigation", { name: "Primary sections" })
        .getByRole("link", { name: surface.navLabel })
        .click();

      const region = page.getByRole("region", { name: surface.regionName });
      const alert = region.getByRole("alert");
      await expect(alert.getByRole("heading", { name: surface.failureTitle }))
        .toBeVisible();
      expect(new URL(page.url()).pathname).toBe(surface.pathname);
      expect(new URL(page.url()).search).toBe("");

      const retry = alert.getByRole("button");
      await expect(retry).toHaveAccessibleName(surface.retryName);
      await retry.click();
      await expect.poll(interception.attempts).toBe(2);
      await expect(retry).toBeDisabled();
      await expect(retry).toHaveAccessibleName(surface.retryingName);
      await retry.evaluate((button: HTMLButtonElement) => button.click());

      interception.release();
      await expect(region.locator("[data-collection-row]")).toHaveCount(PAGE_SIZE);
      expect(interception.attempts()).toBe(2);
      expect(new URL(page.url()).pathname).toBe(surface.pathname);
      expect(new URL(page.url()).search).toBe("");
      await expect(region).toBeFocused();
    } finally {
      interception.release();
      await interception.remove();
    }
  }
});

test("retries a failed Reader All page without changing its rail-local cursor", async ({
  page,
}) => {
  seedLargeCollectionArchive();
  const interception = await interceptCollectionPageRetry(
    page,
    FLASHBACK_PAGE_QUERY_ID,
  );
  try {
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.goto(`/memories/${PAGINATION_MEMORY_ID}`);
    await waitForReaderReady(page);
    const flashbackSection = page
      .getByRole("heading", { name: "Flashbacks", exact: true })
      .locator("xpath=..");
    await flashbackSection.getByRole("button", { name: "All", exact: true }).click();

    const region = flashbackSection.getByRole("region", {
      name: "All flashbacks page",
    });
    const alert = region.getByRole("alert");
    await expect(alert).toContainText("Failed to load flashbacks.");
    const retry = alert.getByRole("button");
    await expect(retry).toHaveAccessibleName("Retry all flashbacks");

    await retry.click();
    await expect.poll(interception.attempts).toBe(2);
    await expect(retry).toBeDisabled();
    await expect(retry).toHaveAccessibleName("Retrying all flashbacks...");
    await retry.evaluate((button: HTMLButtonElement) => button.click());

    interception.release();
    await expect(region.getByRole("link")).toHaveCount(PAGE_SIZE);
    expect(interception.attempts()).toBe(2);
    expect(new URL(page.url()).pathname).toBe(`/memories/${PAGINATION_MEMORY_ID}`);
    await expect(region).toBeFocused();
  } finally {
    interception.release();
    await interception.remove();
  }
});

async function expectCollectionPage(
  page: Page,
  rowCount: number,
  visibleText: string,
): Promise<void> {
  await expect(page.locator("[data-collection-row]")).toHaveCount(rowCount);
  await expect(page.getByText(visibleText, { exact: false }).first()).toBeVisible();
}

async function waitForReaderReady(page: Page): Promise<void> {
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
}

async function interceptCollectionPageRetry(page: Page, queryId: string) {
  let requestAttempts = 0;
  let releaseRetryRequest: () => void = () => undefined;
  const retryRequestGate = new Promise<void>((resolve) => {
    releaseRetryRequest = resolve;
  });
  const matchesQuery = (url: URL): boolean =>
    url.pathname === "/_server/" && url.searchParams.get("id") === queryId;
  await page.route(matchesQuery, async (route) => {
    requestAttempts += 1;
    if (requestAttempts === 1) {
      await route.abort("failed");
      return;
    }

    await retryRequestGate;
    await route.continue();
  });

  return {
    attempts: () => requestAttempts,
    release: () => releaseRetryRequest(),
    remove: () => page.unroute(matchesQuery),
  };
}

function seedLargeCollectionArchive(): void {
  runBunFixtureScript(`
    import { mkdir, rm, writeFile } from "node:fs/promises";
    import { dirname, join } from "node:path";
    import { schema } from "./src/server/db/index.ts";
    import { initializeDatabase } from "./src/server/db/connection.ts";
    import {
      createReaderContentHash,
      writeMemoryContent,
    } from "./src/server/store/index.ts";
    import { readCanonicalReaderText } from "./src/server/store/flashback-markers.ts";

    const configPath = join(process.cwd(), ".trauma/e2e/trauma.config.json");
    const memoryId = ${JSON.stringify(PAGINATION_MEMORY_ID)};
    const archiveSize = ${ARCHIVE_SIZE};
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
    const pad = (value) => String(value).padStart(2, "0");
    const markdown = [
      "# Pagination Archive",
      ...Array.from({ length: archiveSize }, (_, index) => {
        const ordinal = index + 1;
        return [
          "## Moment Section " + pad(ordinal),
          "Flashback selection " + pad(ordinal) + " is stored here.",
        ];
      }).flat(),
    ].join("\\n\\n");

    await rm(join(process.cwd(), ".trauma/e2e"), { recursive: true, force: true });
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    const baseTime = Date.parse("2026-07-17T00:00:00.000Z");
    const canonical = readCanonicalReaderText(markdown);
    const contentHash = createReaderContentHash(markdown);
    const connection = initializeDatabase(resolvedConfig);
    try {
      await connection.db.insert(schema.memories).values({
        id: memoryId,
        url: "https://example.com/pagination-archive",
        title: "Pagination Archive",
        description: "Large collection pagination fixture",
        faviconUrl: null,
        contentPath: "memories/" + memoryId + "/CONTENT.md",
        extractionStatus: "success",
        extractionError: null,
        backupStatus: "disabled",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime),
      });
      const flashbacks = [];
      const moments = [];
      for (let index = 0; index < archiveSize; index += 1) {
        const ordinal = index + 1;
        const suffix = pad(ordinal);
        const text = "Flashback selection " + suffix;
        const startOffset = canonical.indexOf(text);
        const createdAt = new Date(baseTime + ordinal);
        flashbacks.push({
          id: "flashback-page-" + suffix,
          memoryId,
          text,
          prefix: "",
          suffix: " is stored here.",
          startOffset,
          endOffset: startOffset + text.length,
          contentHash,
          createdAt,
          updatedAt: createdAt,
        });
        moments.push({
          id: "moment-page-" + suffix,
          memoryId,
          sectionAnchor: "moment-section-" + suffix,
          sectionTitle: "Moment Section " + suffix,
          sectionLevel: 2,
          sectionPath: "1/" + ordinal,
          sectionStartOffset: null,
          sectionEndOffset: null,
          contentHash,
          createdAt,
          updatedAt: createdAt,
        });
      }
      await connection.db.insert(schema.flashbacks).values(flashbacks);
      await connection.db.insert(schema.moments).values(moments);
    } finally {
      connection.close();
    }

    await writeMemoryContent({
      config: resolvedConfig,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/pagination-archive",
        title: "Pagination Archive",
        capturedAt: new Date(baseTime).toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });
  `);
}
