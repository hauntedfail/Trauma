import { expect, test, type Page } from "@playwright/test";

import { runBunFixtureScript } from "./bun-fixture";

const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";
const SECOND_READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102";
const TOC_SCROLL_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103";

test.describe.configure({ mode: "serial" });

test("renders a fixture memory in reader mode", async ({ page }) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);

  await expect(page.getByText("Memory", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Reader" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Details" })).toBeVisible();
  await expect(page.locator("#details")).toBeVisible();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(new RegExp(`/memories/${READER_MEMORY_ID}#details$`));
  await expect(page.locator("[data-reader-content]").getByText("Curated markdown body")).toBeVisible();
  await expect(page.locator("mark[data-flashback-id='flashback-fixture']")).toContainText(
    "saved flashback",
  );

  await page.evaluate((memoryId) => {
    const link = document.createElement("a");
    link.href = `/memories/${memoryId}`;
    link.textContent = "Open second reader fixture";
    document.body.append(link);
  }, SECOND_READER_MEMORY_ID);
  await page.getByRole("link", { name: "Open second reader fixture" }).click();

  await expect(page).toHaveURL(new RegExp(`/memories/${SECOND_READER_MEMORY_ID}$`));
  await expect(page.getByRole("heading", { name: "Second Fixture Reader" })).toBeVisible();
  await expect(page.getByText("Second reader body")).toBeVisible();
  await expect(page.getByText("Curated markdown body")).toHaveCount(0);
});

test("deletes a memory from reader actions and returns to browse", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await expect(page.getByRole("heading", { name: "Fixture Reader" })).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete memory "Fixture Reader"?');
    void dialog.accept();
  });
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${READER_MEMORY_ID}`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Memory actions for Fixture Reader" })
    .click();
  await page.getByRole("menuitem", { name: "Delete memory" }).click();

  expect((await deleteResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByText("Failed to delete memory.")).toHaveCount(0);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await expect(page.getByRole("heading", { name: "Memory was not found." }))
    .toBeVisible();
});

test("keeps linked reader flashback anchors readable in non-normal themes", async ({
  page,
}) => {
  createReaderFixture();

  for (const theme of [
    { brightness: "sun", name: "warm-light", surface: "normal" },
    { brightness: "sun", name: "paper-warm-light", surface: "paper" },
    { brightness: "night", name: "paper-black-dark", surface: "paper" },
  ] as const) {
    await setReaderTheme(page, theme.brightness, theme.surface);
    await page.goto(`/memories/${READER_MEMORY_ID}#flashback-fixture`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.name);

    const targetStyle = await page.locator("mark#flashback-fixture").evaluate((mark) => {
      const style = getComputedStyle(mark);
      const rootStyle = getComputedStyle(document.documentElement);

      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
        expectedBackground: rootStyle.getPropertyValue("--anchor-flashback-bg").trim(),
        expectedInk: rootStyle.getPropertyValue("--anchor-flashback-ink").trim(),
        expectedRing: rootStyle.getPropertyValue("--anchor-flashback-ring").trim(),
      };
    });

    expect(targetStyle.expectedBackground, theme.name).not.toBe("");
    expect(targetStyle.expectedInk, theme.name).not.toBe("");
    expect(targetStyle.expectedRing, theme.name).not.toBe("");
    expect(targetStyle.boxShadow, theme.name).not.toBe("none");
    expect(targetStyle.expectedBackground, theme.name).not.toBe("#ffe2a8");
    expect(targetStyle.expectedInk, theme.name).not.toBe("#3d2b12");
    expect(targetStyle.backgroundColor, theme.name).not.toBe("rgb(255, 226, 168)");
    expect(targetStyle.color, theme.name).not.toBe("rgb(61, 43, 18)");
  }
});

test("keeps sun reader links bright in normal and paper themes", async ({
  page,
}) => {
  createReaderFixture();

  for (const theme of [
    { brightness: "sun", name: "warm-light", surface: "normal" },
    { brightness: "sun", name: "paper-warm-light", surface: "paper" },
  ] as const) {
    await setReaderTheme(page, theme.brightness, theme.surface);
    await page.goto(`/memories/${READER_MEMORY_ID}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.name);

    const sourceLinkColor = await page
      .getByRole("link", { name: "https://example.com/reader" })
      .evaluate((link) => getComputedStyle(link).color);
    const proseLinkColor = await page
      .getByRole("link", { name: "Reference link" })
      .evaluate((link) => getComputedStyle(link).color);
    const linkToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--link").trim(),
    );

    expect(linkToken, theme.name).toBe("#9a334a");
    expect(sourceLinkColor, theme.name).toBe("rgb(154, 51, 74)");
    expect(proseLinkColor, theme.name).toBe("rgb(154, 51, 74)");
  }
});

test("toggles selected reader text as a persisted flashback", async ({ page }) => {
  createReaderFixture();
  const selectedText = "Curated markdown body";

  await page.goto(`/memories/${READER_MEMORY_ID}`);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flashbacks") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await page.getByRole("button", { name: "Flashback selection" }).click();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toBeVisible();
  expect((await createResponse).ok()).toBe(true);

  await page.reload();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toBeVisible();

  const removeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flashbacks") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await page.getByRole("button", { name: "Flashback selection" }).click();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  expect((await removeResponse).ok()).toBe(true);

  await page.reload();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  await expect(page.locator("[data-reader-content]").getByText(selectedText)).toBeVisible();
});

test("shows reader toc scroll blur fades only for available scroll directions", async ({
  page,
}) => {
  createReaderFixture();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/memories/${TOC_SCROLL_MEMORY_ID}`);

  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();

  const topFade = toc.locator(".trauma-toc-scroll-fade-top");
  const bottomFade = toc.locator(".trauma-toc-scroll-fade-bottom");
  await expect(topFade).toHaveCount(0);
  await expect(bottomFade).toBeVisible();

  const geometry = await toc.evaluate((nav) => {
    const bottomFadeElement = nav.querySelector(".trauma-toc-scroll-fade-bottom");
    const listElement = nav.querySelector("ol");

    if (
      !(bottomFadeElement instanceof HTMLElement) ||
      !(listElement instanceof HTMLElement)
    ) {
      throw new Error("TOC bottom fade or list element is missing");
    }

    const navRect = nav.getBoundingClientRect();
    const bottomFadeRect = bottomFadeElement.getBoundingClientRect();
    const bottomFadeStyle = getComputedStyle(bottomFadeElement);

    return {
      listClientHeight: listElement.clientHeight,
      listScrollHeight: listElement.scrollHeight,
      bottomFadeBottomGap: Number(
        (navRect.bottom - bottomFadeRect.bottom).toFixed(2),
      ),
      bottomFadeBackdropFilter: bottomFadeStyle.backdropFilter,
      bottomFadeBoxShadow: bottomFadeStyle.boxShadow,
    };
  });

  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight);
  expect(Math.abs(geometry.bottomFadeBottomGap)).toBeLessThanOrEqual(1);
  expect(geometry.bottomFadeBackdropFilter).toContain("blur(");
  expect(geometry.bottomFadeBoxShadow).toBe("none");

  await toc.locator("ol").evaluate((list) => {
    list.scrollTop = Math.floor(list.scrollHeight / 2);
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(topFade).toBeVisible();
  await expect(bottomFade).toBeVisible();

  const topFadeGeometry = await toc.evaluate((nav) => {
    const topFadeElement = nav.querySelector(".trauma-toc-scroll-fade-top");
    const listElement = nav.querySelector("ol");

    if (
      !(topFadeElement instanceof HTMLElement) ||
      !(listElement instanceof HTMLElement)
    ) {
      throw new Error("TOC top fade or list element is missing");
    }

    const topFadeRect = topFadeElement.getBoundingClientRect();
    const listRect = listElement.getBoundingClientRect();
    const topFadeStyle = getComputedStyle(topFadeElement);

    return {
      topFadeTopGap: Number((topFadeRect.top - listRect.top).toFixed(2)),
      topFadeMaskImage:
        topFadeStyle.getPropertyValue("mask-image") ||
        topFadeStyle.getPropertyValue("-webkit-mask-image"),
    };
  });

  expect(Math.abs(topFadeGeometry.topFadeTopGap)).toBeLessThanOrEqual(1);
  expect(topFadeGeometry.topFadeMaskImage).toContain("linear-gradient");

  await toc.locator("ol").evaluate((list) => {
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(topFade).toBeVisible();
  await expect(bottomFade).toHaveCount(0);
});

async function setReaderTheme(
  page: Page,
  brightness: "night" | "sun",
  surface: "normal" | "paper",
) {
  await page.goto("/memories");
  await page.evaluate(
    ({ brightness: nextBrightness, surface: nextSurface }) => {
      localStorage.setItem("trauma:brightness", nextBrightness);
      localStorage.setItem("trauma:surface", nextSurface);
    },
    { brightness, surface },
  );
}

function createReaderFixture() {
  runBunFixtureScript(`
        import { mkdir, rm, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { schema } from "./src/server/db/index.ts";
        import { initializeDatabase } from "./src/server/db/connection.ts";
        import { writeMemoryContent } from "./src/server/store/index.ts";

        const configPath = join(process.cwd(), ".trauma/e2e/trauma.config.json");
        const memoryId = "${READER_MEMORY_ID}";
        const secondMemoryId = "${SECOND_READER_MEMORY_ID}";
        const tocScrollMemoryId = "${TOC_SCROLL_MEMORY_ID}";
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
        const readerMarkdown = [
          "# Fixture Reader",
          "",
          "Curated markdown body with saved flashback.",
          "",
          "A [Reference link](https://example.com/reference) belongs to the reader content.",
          "",
          "## Details",
          "",
          "| Kind | Value |",
          "| --- | --- |",
          "| reader | smoke |",
        ].join("\\n");

        await rm(join(process.cwd(), ".trauma/e2e"), { recursive: true, force: true });
        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

        async function insertMemory(memoryId, title, url) {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url,
            title,
            description: "Reader fixture",
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
          });
        }

        const connection = initializeDatabase(resolvedConfig);
        try {
          await insertMemory(memoryId, "Fixture Reader", "https://example.com/reader");
          await insertMemory(secondMemoryId, "Second Fixture Reader", "https://example.com/second-reader");
          await insertMemory(tocScrollMemoryId, "Long Contents Fixture", "https://example.com/long-contents");
          const flashbackStartOffset = readerMarkdown.indexOf("saved flashback");
          await connection.db.insert(schema.flashbacks).values({
            id: "flashback-fixture",
            memoryId,
            text: "saved flashback",
            prefix: "Curated markdown body with ",
            suffix: ".",
            startOffset: flashbackStartOffset,
            endOffset: flashbackStartOffset + "saved flashback".length,
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
          });
        } finally {
          connection.close();
        }

        async function writeFixtureContent(memoryId, title, url, markdown) {
          await writeMemoryContent({
            config: resolvedConfig,
            memoryId,
            frontmatter: {
              id: memoryId,
              url,
              title,
              capturedAt: "2026-05-09T00:00:00.000Z",
              extractionStatus: "success",
            },
            markdown,
          });
        }

        await writeFixtureContent(
          memoryId,
          "Fixture Reader",
          "https://example.com/reader",
          readerMarkdown,
        );
        await writeFixtureContent(
          secondMemoryId,
          "Second Fixture Reader",
          "https://example.com/second-reader",
          [
            "# Second Fixture Reader",
            "",
            "Second reader body.",
            "",
            "## Follow Up",
            "",
            "Ready-to-ready navigation should replace the rendered article.",
          ].join("\\n"),
        );
        await writeFixtureContent(
          tocScrollMemoryId,
          "Long Contents Fixture",
          "https://example.com/long-contents",
          [
            "# Long Contents Fixture",
            "",
            "This reader exists to make the right-rail table of contents overflow.",
            "",
            ...Array.from({ length: 48 }, (_, index) => [
              \`## Section \${index + 1}\`,
              "",
              \`Body \${index + 1}.\`,
            ]).flat(),
          ].join("\\n"),
        );
  `);
}

async function selectReaderText(page: Page, text: string) {
  await page.locator("[data-reader-content]").evaluate((root, selectedText) => {
    const findTextNode = (node: Node): Text | undefined => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current !== null) {
        if (current.nodeValue?.includes(selectedText)) {
          return current as Text;
        }

        current = walker.nextNode();
      }

      return undefined;
    };
    const textNode = findTextNode(root);
    if (textNode === undefined) {
      throw new Error(`Text not found: ${selectedText}`);
    }

    const startOffset = textNode.nodeValue?.indexOf(selectedText) ?? -1;
    if (startOffset < 0) {
      throw new Error(`Text node did not contain: ${selectedText}`);
    }

    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, startOffset + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
}
