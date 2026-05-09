import { execFileSync } from "node:child_process";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { expect, test } from "@playwright/test";

const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";

test("renders a fixture memory in reader mode", async ({ page }) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);

  await expect(page.getByRole("heading", { name: "Fixture Reader" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Details" })).toBeVisible();
  await expect(page.locator("#details")).toBeVisible();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(new RegExp(`/memories/${READER_MEMORY_ID}#details$`));
  await expect(page.getByText("Curated markdown body")).toBeVisible();
  await expect(page.locator("mark[data-highlight-id='hl-fixture']")).toContainText(
    "saved highlight",
  );
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

        const connection = initializeDatabase(resolvedConfig);
        try {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url: "https://example.com/reader",
            title: "Fixture Reader",
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
        } finally {
          connection.close();
        }

        await writeMemoryContent({
          config: resolvedConfig,
          memoryId,
          frontmatter: {
            id: memoryId,
            url: "https://example.com/reader",
            title: "Fixture Reader",
            capturedAt: "2026-05-09T00:00:00.000Z",
            extractionStatus: "success",
          },
          markdown: [
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
        });
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
