import { expect, test, type Page } from "@playwright/test";

import { runBunFixtureScript } from "./bun-fixture";

const PAGINATION_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f177";
const PAGE_SIZE = 30;
const ARCHIVE_SIZE = 37;

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
