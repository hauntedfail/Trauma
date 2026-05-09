import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("loadReaderMemory", () => {
  it("loads memory metadata, CONTENT.md, rendered HTML, and table of contents", () => {
    const result = runReaderFixture({
      targetMemoryId: MEMORY_ID,
      markdown: "# Fixture Reader\n\nA saved <mark data-highlight-id=\"hl-1\">highlight</mark>.",
    });

    expect(result.status).toBe("ready");
    expect(result.memory.title).toBe("Fixture Reader");
    expect(result.memory.url).toBe("https://example.com/reader");
    expect(result.content.markdown).toContain("saved");
    expect(result.rendered.toc).toEqual([
      { id: "fixture-reader", level: 1, text: "Fixture Reader" },
    ]);
    expect(result.rendered.html).toContain('<h1 id="fixture-reader"');
    expect(result.rendered.html).toContain('<mark data-highlight-id="hl-1">highlight</mark>');
  });

  it("returns a user-readable missing state when the memory row does not exist", () => {
    const result = runReaderFixture({
      targetMemoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f002",
      markdown: "# Fixture Reader",
    });

    expect(result).toEqual({
      status: "not_found",
      message: "Memory was not found.",
    });
  });

  it("returns a user-readable missing state when CONTENT.md is absent", () => {
    const result = runReaderFixture({
      targetMemoryId: MEMORY_ID,
      markdown: "# Fixture Reader",
      writeContent: false,
    });

    expect(result).toEqual({
      status: "content_missing",
      message: "Readable content is missing for this memory.",
    });
  });
});

function runReaderFixture(input: {
  targetMemoryId: string;
  markdown: string;
  writeContent?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), "trauma-reader-"));
  tempDirs.push(root);
  const output = runBunScript(
    `
      import { join } from "node:path";
      import { schema } from "./src/server/db/index.ts";
      import { initializeDatabase } from "./src/server/db/connection.ts";
      import { loadReaderMemory } from "./src/server/reader/page-data.ts";
      import { writeMemoryContent } from "./src/server/store/index.ts";

      const root = process.env.TRAUMA_TEST_ROOT;
      const targetMemoryId = process.env.TRAUMA_TEST_TARGET_MEMORY_ID;
      const markdown = process.env.TRAUMA_TEST_MARKDOWN;
      if (!root || !targetMemoryId || markdown === undefined) {
        throw new Error("TRAUMA_TEST_ROOT, TRAUMA_TEST_TARGET_MEMORY_ID, and TRAUMA_TEST_MARKDOWN are required");
      }

      const config = {
        configFilePath: join(root, "trauma.config.json"),
        projectPath: join(root, "data"),
        storePath: join(root, "data/store"),
        databasePath: join(root, ".trauma/trauma.sqlite"),
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
      const memoryId = "${MEMORY_ID}";
      const connection = initializeDatabase(config);

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

      if (process.env.TRAUMA_TEST_WRITE_CONTENT !== "false") {
        await writeMemoryContent({
          config,
          memoryId,
          frontmatter: {
            id: memoryId,
            url: "https://example.com/reader",
            title: "Fixture Reader",
            capturedAt: "2026-05-09T00:00:00.000Z",
            extractionStatus: "success",
          },
          markdown,
        });
      }

      const result = await loadReaderMemory(targetMemoryId, { config });
      process.stdout.write(JSON.stringify(result));
    `,
    {
      TRAUMA_TEST_ROOT: root,
      TRAUMA_TEST_TARGET_MEMORY_ID: input.targetMemoryId,
      TRAUMA_TEST_MARKDOWN: input.markdown,
      TRAUMA_TEST_WRITE_CONTENT: input.writeContent === false ? "false" : "true",
    },
  );

  return JSON.parse(output);
}

function runBunScript(script: string, env: Record<string, string>) {
  const repositoryRoot = process.cwd();
  return execFileSync("mise", ["exec", "-C", repositoryRoot, "--", "bun", "-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: join(repositoryRoot, ".tmp/bun-cache"),
      MISE_TRUSTED_CONFIG_PATHS: join(repositoryRoot, "mise.toml"),
      TMPDIR: join(repositoryRoot, ".tmp/bun-tmp"),
    },
  });
}
