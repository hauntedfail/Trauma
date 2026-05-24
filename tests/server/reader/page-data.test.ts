import { execFileSync } from "node:child_process";
import { accessSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  it("loads reader relation data through the repository boundary", () => {
    const source = readFileSync("src/server/reader/page-data.ts", "utf8");

    expect(source).toContain("findReaderAggregateById");
    expect(source).not.toContain("connection.db.query");
    expect(source).not.toContain("drizzle-orm");
  });

  it("loads memory metadata, CONTENT.md, rendered HTML, and table of contents", () => {
    const result = runReaderFixture({
      targetMemoryId: MEMORY_ID,
      markdown: "# Fixture Reader\n\nA saved flashback.",
    });

    expect(result.status).toBe("ready");
    expect(result.memory.title).toBe("Fixture Reader");
    expect(result.memory.url).toBe("https://example.com/reader");
    expect(result.memory.read).toBe(false);
    expect(result.memory.categories).toEqual([{ id: "reader-category", name: "Reader" }]);
    expect(result.memory.tags).toEqual([{ id: "reader-tag", name: "reader" }]);
    expect(result.memory.moments).toEqual([
      {
        id: "flashback-reader",
        sectionAnchor: "fixture-reader",
        sectionTitle: "Fixture Reader",
        sectionLevel: 1,
        sectionPath: "1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: "2026-05-09T00:00:00.000Z",
      },
    ]);
    expect(result.memory.flashbacks).toEqual([
      {
        id: "hl-1",
        text: "flashback",
        prefix: "A saved ",
        suffix: ".",
        startOffset: 26,
        endOffset: 35,
        contentHash: null,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        createdAt: "2026-05-09T00:00:00.000Z",
      },
    ]);
    expect(result.content).toMatchObject({
      relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
    });
    expect(result.content.variants).toEqual([
      {
        active: true,
        kind: "source",
        label: "Original",
        readerUrl: `/memories/${MEMORY_ID}`,
        relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
      },
    ]);
    expect("markdown" in result.content).toBe(false);
    expect(result.rendered.toc).toEqual([
      { id: "fixture-reader", level: 1, path: "1", text: "Fixture Reader" },
    ]);
    expect(result.rendered.html).toContain('<h1 id="fixture-reader"');
    expect(result.rendered.html).toContain(
      '<mark data-flashback-id="hl-1" id="hl-1">flashback</mark>',
    );
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

  it("renders clean content instead of crashing when saved flashback ranges are stale", () => {
    const result = runReaderFixture({
      targetMemoryId: MEMORY_ID,
      markdown: "# Fixture Reader\n\nA saved flashback.",
      insertOverlappingFlashback: true,
    });

    expect(result.status).toBe("ready");
    expect(result.rendered.html).toContain("<p>A saved flashback.</p>");
    expect(result.rendered.html).not.toContain("<mark");
    expect(result.memory.flashbacks).toEqual([]);
  });

  it("renders only the active content variant's flashbacks", () => {
    const sourceText =
      "Top 5 repos defining it, the academic case for why, and who says it's wrong.";
    const translatedText =
      "それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。";
    const result = runTranslatedReaderFixture({
      sourceMarkdown: sourceText,
      translatedMarkdown: translatedText,
    });

    expect(result.source.status).toBe("ready");
    expect(
      result.source.memory.flashbacks.map(
        (row: { variantKind: string }) => row.variantKind,
      ),
    ).toEqual(["source"]);
    expect(result.source.rendered.html).toContain(
      `<mark data-flashback-id="source-flashback" id="source-flashback">${sourceText}</mark>`,
    );
    expect(result.source.rendered.html).not.toContain("translated-flashback");
    expect(result.source.memory.flashbacks).toEqual([
      expect.objectContaining({
        id: "source-flashback",
        text: sourceText,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
      }),
    ]);

    expect(result.translated.status).toBe("ready");
    expect(
      result.translated.memory.flashbacks.map(
        (row: { variantKind: string }) => row.variantKind,
      ),
    ).toEqual(["translation"]);
    expect(result.translated.content).toMatchObject({
      langCode: "ja-JP",
      relativePath: `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
      sourceReaderUrl: `/memories/${MEMORY_ID}`,
    });
    expect(result.translated.rendered.html).toContain(
      `<mark data-flashback-id="translated-flashback" id="translated-flashback">${translatedText}</mark>`,
    );
    expect(result.translated.rendered.html).not.toContain("source-flashback");
    expect(result.translated.rendered.html).not.toContain("stale-translated-flashback");
    expect(result.translated.memory.flashbacks).toEqual([
      {
        id: "translated-flashback",
        text: translatedText,
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: translatedText.length,
        contentHash: expect.stringMatching(/^sha256:/),
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: expect.stringMatching(/^sha256:/),
        createdAt: "2026-05-09T00:00:00.000Z",
      },
    ]);
  });

  it("returns a user-readable unavailable state when the default config cannot load", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-reader-"));
    tempDirs.push(root);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { loadReaderMemory } from "./src/server/reader/page-data.ts";

        process.env.TRAUMA_CONFIG_PATH = join(process.env.TRAUMA_TEST_ROOT, "missing.config.json");
        const result = await loadReaderMemory("${MEMORY_ID}");
        process.stdout.write(JSON.stringify(result));
      `,
      {
        TRAUMA_TEST_ROOT: root,
      },
    );

    expect(JSON.parse(output)).toEqual({
      status: "unavailable",
      message: "Reader content is unavailable.",
    });
  });
});

function runReaderFixture(input: {
  targetMemoryId: string;
  markdown: string;
  insertOverlappingFlashback?: boolean;
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
        await connection.db.insert(schema.categories).values({
          id: "reader-category",
          name: "Reader",
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        });
        await connection.db.insert(schema.tags).values({
          id: "reader-tag",
          name: "reader",
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        });
        await connection.db.insert(schema.memoryCategories).values({
          memoryId,
          categoryId: "reader-category",
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        });
        await connection.db.insert(schema.memoryTags).values({
          memoryId,
          tagId: "reader-tag",
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        });
        const flashbackStartOffset = markdown.indexOf("flashback");
        if (flashbackStartOffset >= 0) {
          await connection.db.insert(schema.flashbacks).values({
            id: "hl-1",
            memoryId,
            text: "flashback",
            prefix: "A saved ",
            suffix: ".",
            startOffset: flashbackStartOffset,
            endOffset: flashbackStartOffset + "flashback".length,
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
          });
          if (process.env.TRAUMA_TEST_INSERT_OVERLAPPING_FLASHBACK === "true") {
            await connection.db.insert(schema.flashbacks).values({
              id: "hl-2",
              memoryId,
              text: "saved flash",
              prefix: "A ",
              suffix: "back.",
              startOffset: flashbackStartOffset - "saved ".length,
              endOffset: flashbackStartOffset + "flash".length,
              createdAt: new Date("2026-05-09T00:00:00.000Z"),
              updatedAt: new Date("2026-05-09T00:00:00.000Z"),
            });
          }
        }
        await connection.db.insert(schema.moments).values({
          id: "flashback-reader",
          memoryId,
          sectionAnchor: "fixture-reader",
          sectionTitle: "Fixture Reader",
          sectionLevel: 1,
          sectionPath: "1",
          sectionStartOffset: null,
          sectionEndOffset: null,
          contentHash: null,
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
      TRAUMA_TEST_INSERT_OVERLAPPING_FLASHBACK:
        input.insertOverlappingFlashback === true ? "true" : "false",
      TRAUMA_TEST_WRITE_CONTENT: input.writeContent === false ? "false" : "true",
    },
  );

  return JSON.parse(output);
}

function runTranslatedReaderFixture(input: {
  sourceMarkdown: string;
  translatedMarkdown: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "trauma-reader-translated-"));
  tempDirs.push(root);
  const output = runBunScript(
    `
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { dirname, join } from "node:path";
      import { schema } from "./src/server/db/index.ts";
      import { initializeDatabase } from "./src/server/db/connection.ts";
      import { loadReaderMemory } from "./src/server/reader/page-data.ts";
      import {
        createMemoryContentFixture,
        writeMemoryContent,
      } from "./src/server/store/index.ts";
      import { createReaderContentHash } from "./src/server/store/flashback-markers.ts";
      import { createSha256ContentHash } from "./src/server/translation/hash.ts";
      import {
        BRILLIANT_CHUNKER_VERSION,
        BRILLIANT_PROMPT_POLICY_VERSION,
      } from "./src/server/translation/prompt.ts";
      import { resolveTranslatedMemoryContentPath } from "./src/server/translation/paths.ts";

      const root = process.env.TRAUMA_TEST_ROOT;
      const sourceMarkdown = process.env.TRAUMA_TEST_SOURCE_MARKDOWN;
      const translatedMarkdown = process.env.TRAUMA_TEST_TRANSLATED_MARKDOWN;
      if (!root || sourceMarkdown === undefined || translatedMarkdown === undefined) {
        throw new Error("translated reader fixture env is required");
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
      const now = new Date("2026-05-09T00:00:00.000Z");
      const memoryId = "${MEMORY_ID}";
      const jobId = "019e3906-0000-7000-8000-000000000901";
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
          createdAt: now,
          updatedAt: now,
        });
      } finally {
        connection.close();
      }

      await writeMemoryContent({
        config,
        memoryId,
        frontmatter: {
          id: memoryId,
          url: "https://example.com/reader",
          title: "Fixture Reader",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: sourceMarkdown,
      });

      const translatedPath = resolveTranslatedMemoryContentPath({
        config,
        langCode: "ja-JP",
        memoryId,
      });
      await mkdir(dirname(translatedPath.absolutePath), { recursive: true });
      await writeFile(
        translatedPath.absolutePath,
        createMemoryContentFixture({
          frontmatter: {
            id: memoryId,
            url: "https://example.com/reader",
            title: "Fixture Reader",
            capturedAt: now.toISOString(),
            extractionStatus: "success",
          },
          markdown: translatedMarkdown,
        }),
        "utf8",
      );

      const sourceHash = createSha256ContentHash(
        await readFile(join(config.storePath, "memories", memoryId, "CONTENT.md")),
      );
      const outputHash = createSha256ContentHash(
        await readFile(translatedPath.absolutePath),
      );
      const dbConnection = initializeDatabase(config);
      try {
        await dbConnection.db.insert(schema.flashbacks).values({
          id: "source-flashback",
          memoryId,
          text: sourceMarkdown,
          prefix: "",
          suffix: "",
          startOffset: 0,
          endOffset: sourceMarkdown.length,
          contentHash: null,
          createdAt: now,
          updatedAt: now,
        });
        await dbConnection.db.insert(schema.flashbacks).values({
          id: "translated-flashback",
          memoryId,
          variantKind: "translation",
          langCode: "ja-JP",
          translationOutputHash: outputHash,
          text: translatedMarkdown,
          prefix: "",
          suffix: "",
          startOffset: 0,
          endOffset: translatedMarkdown.length,
          contentHash: createReaderContentHash(translatedMarkdown),
          createdAt: now,
          updatedAt: now,
        });
        await dbConnection.db.insert(schema.flashbacks).values({
          id: "stale-translated-flashback",
          memoryId,
          variantKind: "translation",
          langCode: "ja-JP",
          translationOutputHash: "sha256:" + "b".repeat(64),
          text: translatedMarkdown,
          prefix: "",
          suffix: "",
          startOffset: 0,
          endOffset: translatedMarkdown.length,
          contentHash: null,
          createdAt: now,
          updatedAt: now,
        });
        await dbConnection.db.insert(schema.translationJobs).values({
          jobId,
          memoryId,
          langCode: "ja-JP",
          sourceHash,
          model: null,
          reasoningEffort: null,
          promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
          chunkerVersion: BRILLIANT_CHUNKER_VERSION,
          status: "complete",
          chunkCount: 1,
          outputPath: translatedPath.relativePath,
          outputHash,
          error: null,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await dbConnection.db.insert(schema.translationProjectionSpans).values({
          jobId,
          spanIndex: 0,
          memoryId,
          langCode: "ja-JP",
          sourceHash,
          outputHash,
          blockId: "b000001",
          segmentId: "s000001",
          sourceMarkdownStart: 0,
          sourceMarkdownEnd: sourceMarkdown.length,
          sourceReaderStart: 0,
          sourceReaderEnd: sourceMarkdown.length,
          translatedMarkdownStart: 0,
          translatedMarkdownEnd: translatedMarkdown.length,
          translatedReaderStart: 0,
          translatedReaderEnd: translatedMarkdown.length,
          createdAt: now,
          updatedAt: now,
        });
      } finally {
        dbConnection.close();
      }

      const source = await loadReaderMemory(memoryId, { config });
      const translated = await loadReaderMemory(memoryId, {
        config,
        langCode: "ja-JP",
      });
      process.stdout.write(JSON.stringify({ source, translated }));
    `,
    {
      TRAUMA_TEST_ROOT: root,
      TRAUMA_TEST_SOURCE_MARKDOWN: input.sourceMarkdown,
      TRAUMA_TEST_TRANSLATED_MARKDOWN: input.translatedMarkdown,
    },
  );

  return JSON.parse(output);
}

function runBunScript(script: string, env: Record<string, string>) {
  const repositoryRoot = process.cwd();
  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: join(repositoryRoot, ".tmp/bun-cache"),
      TMPDIR: join(repositoryRoot, ".tmp/bun-tmp"),
    },
  });
}

function resolveBunExecutable() {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    process.versions.bun !== undefined ? process.execPath : undefined,
    join(homedir(), ".local/share/mise/installs/bun/1.3.13/bin/bun"),
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
    throw new Error("Bun executable is required for reader page-data tests");
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
