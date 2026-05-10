import { execFileSync } from "node:child_process";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { expect, test, type Page } from "@playwright/test";

const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";
const SECOND_READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102";

test("renders a fixture memory in reader mode", async ({ page }) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);

  await expect(page.locator("#reader-title")).toHaveText("Fixture Reader");
  await expect(page.getByRole("link", { name: "Details" })).toBeVisible();
  await expect(page.locator("#details")).toBeVisible();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(new RegExp(`/memories/${READER_MEMORY_ID}#details$`));
  await expect(page.getByText("Curated markdown body")).toBeVisible();
  await expect(page.locator("mark[data-highlight-id='hl-fixture']")).toContainText(
    "saved highlight",
  );

  await page.evaluate((memoryId) => {
    const link = document.createElement("a");
    link.href = `/memories/${memoryId}`;
    link.textContent = "Open second reader fixture";
    document.body.append(link);
  }, SECOND_READER_MEMORY_ID);
  await page.getByRole("link", { name: "Open second reader fixture" }).click();

  await expect(page).toHaveURL(new RegExp(`/memories/${SECOND_READER_MEMORY_ID}$`));
  await expect(page.locator("#reader-title")).toHaveText("Second Fixture Reader");
  await expect(page.getByText("Second reader body")).toBeVisible();
  await expect(page.getByText("Curated markdown body")).toHaveCount(0);
});

test("toggles selected reader text as a persisted highlight", async ({ page }) => {
  createReaderFixture();
  const selectedText = "Curated markdown body";

  await page.goto(`/memories/${READER_MEMORY_ID}`);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/highlights") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await expect(
    page.locator("mark[data-highlight-id]", { hasText: selectedText }),
  ).toBeVisible();
  expect((await createResponse).ok()).toBe(true);

  await page.reload();
  await expect(
    page.locator("mark[data-highlight-id]", { hasText: selectedText }),
  ).toBeVisible();

  const removeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/highlights") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await expect(
    page.locator("mark[data-highlight-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  expect((await removeResponse).ok()).toBe(true);

  await page.reload();
  await expect(
    page.locator("mark[data-highlight-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  await expect(page.getByText(selectedText)).toBeVisible();
});

function createReaderFixture() {
  execFileSync(
    resolveBunExecutable(),
    [
      "-e",
      `
        import { mkdir, rm, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { schema } from "./src/server/db/index.ts";
        import { initializeDatabase } from "./src/server/db/connection.ts";
        import { writeMemoryContent } from "./src/server/store/index.ts";

        const configPath = join(process.cwd(), ".trauma/e2e/trauma.config.json");
        const memoryId = "${READER_MEMORY_ID}";
        const secondMemoryId = "${SECOND_READER_MEMORY_ID}";
        const config = {
          storePath: "./project/store",
          projectPath: "./project",
          databasePath: "./runtime/trauma.sqlite",
          backup: {
            git: {
              enabled: true,
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
          [
            "# Fixture Reader",
            "",
            "Curated markdown body with <mark data-highlight-id=\\"hl-fixture\\">saved highlight</mark>.",
            "",
            "## Details",
            "",
            "| Kind | Value |",
            "| --- | --- |",
            "| reader | smoke |",
          ].join("\\n"),
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
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: `${process.cwd()}/.tmp/bun-cache`,
        MISE_TRUSTED_CONFIG_PATHS: `${process.cwd()}/mise.toml`,
        TMPDIR: `${process.cwd()}/.tmp/bun-tmp`,
      },
      stdio: "pipe",
    },
  );
}

async function selectReaderText(page: Page, text: string) {
  await page.locator("[data-reader-content]").evaluate((root, selectedText) => {
    const textNode = findTextNode(root, selectedText);
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

function findTextNode(root: Node, text: string): Text | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current !== null) {
    if (current.nodeValue?.includes(text)) {
      return current as Text;
    }

    current = walker.nextNode();
  }

  return undefined;
}

function resolveBunExecutable() {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    process.versions.bun !== undefined ? process.execPath : undefined,
    `${homedir()}/.local/share/mise/installs/bun/1.3.13/bin/bun`,
    process.env.npm_execpath,
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      isBunExecutable(candidate) &&
      (candidate.includes("/") ? canAccess(candidate) : true),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for reader E2E fixtures");
  }

  return executable;
}

function isBunExecutable(path: string) {
  return path === "bun" || path.endsWith("/bun") || path.endsWith("\\bun.exe");
}

function canAccess(path: string) {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
