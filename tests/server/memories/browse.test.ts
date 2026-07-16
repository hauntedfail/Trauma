import { execFileSync } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialBrowseMemoryPageRequest,
  parseBrowseQuery,
} from "../../../src/components/memories/browse-data";
import {
  loadBrowseMemories,
  loadBrowseMemoryPage,
} from "../../../src/server/memories/browse";

const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;
const previousBrowseFixtures = process.env.TRAUMA_BROWSE_FIXTURES;

afterEach(() => {
  restoreEnv("TRAUMA_CONFIG_PATH", previousConfigPath);
  restoreEnv("TRAUMA_BROWSE_FIXTURES", previousBrowseFixtures);
});

describe("browse memory loader error policy", () => {
  it("surfaces missing required config instead of rendering an empty archive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-missing-config-"));

    await withCwd(cwd, async () => {
      await expect(loadBrowseMemories()).rejects.toThrow(/Missing trauma config/);
      await expect(
        loadBrowseMemoryPage(
          createInitialBrowseMemoryPageRequest(parseBrowseQuery("")),
        ),
      ).rejects.toThrow(/Missing trauma config/);
    });
  });

  it("returns fixture browse memory pages with cursors and no flashback excerpts", async () => {
    process.env.TRAUMA_BROWSE_FIXTURES = "1";
    const firstPage = await loadBrowseMemoryPage({
      ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("")),
      limit: 2,
    });
    const secondPage = await loadBrowseMemoryPage({
      query: parseBrowseQuery(""),
      cursor: firstPage.nextCursor,
      limit: 2,
    });

    expect(firstPage).toMatchObject({
      memories: [
        { id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901", flashbacks: [] },
        { id: "memory-ops", flashbacks: [] },
      ],
      nextCursor: { createdAt: "2026-05-08", id: "memory-ops" },
    });
    expect(secondPage).toMatchObject({
      memories: [
        { id: "memory-design", flashbacks: [] },
        { id: "memory-no-flashbacks", flashbacks: [] },
      ],
      nextCursor: { createdAt: "2026-05-06", id: "memory-no-flashbacks" },
    });
  });

  it("loads browse memories using TRAUMA_CONFIG_PATH outside the current working directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-browse-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "trauma-browse-config-"));
    const configPath = writeConfig(configRoot);

    const output = runBunScript(
      `
        import { loadBrowseMemories } from "./src/server/memories/browse.ts";

        process.chdir(process.env.TRAUMA_TEST_CWD);
        process.env.TRAUMA_CONFIG_PATH = process.env.TRAUMA_TEST_CONFIG_PATH;

        const result = await loadBrowseMemories();
        process.stdout.write(JSON.stringify(result));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_CWD: cwd,
      },
    );

    expect(JSON.parse(output)).toEqual([]);
  });

  it("starts the backup retry queue while loading browse memories", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-browse-retry-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "trauma-browse-retry-config-"));
    const configPath = writeConfig(configRoot);

    const output = runBunScript(
      `
        import { loadBrowseMemories } from "./src/server/memories/browse.ts";

        process.chdir(process.env.TRAUMA_TEST_CWD);
        process.env.TRAUMA_CONFIG_PATH = process.env.TRAUMA_TEST_CONFIG_PATH;

        const starts = [];
        await loadBrowseMemories({
          startBackupQueue: (config) => {
            starts.push(config.projectPath);
          },
        });
        process.stdout.write(JSON.stringify(starts));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_CWD: cwd,
      },
    );

    expect(JSON.parse(output)).toEqual([join(configRoot, "data")]);
  });

  it("starts the backup retry queue while loading browse memory pages", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-browse-page-retry-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "trauma-browse-page-retry-config-"));
    const configPath = writeConfig(configRoot);

    const output = runBunScript(
      `
        import {
          createInitialBrowseMemoryPageRequest,
          parseBrowseQuery,
        } from "./src/components/memories/browse-data.ts";
        import { loadBrowseMemoryPage } from "./src/server/memories/browse.ts";

        process.chdir(process.env.TRAUMA_TEST_CWD);
        process.env.TRAUMA_CONFIG_PATH = process.env.TRAUMA_TEST_CONFIG_PATH;

        const starts = [];
        await loadBrowseMemoryPage(
          createInitialBrowseMemoryPageRequest(parseBrowseQuery("")),
          {
            startBackupQueue: (config) => {
              starts.push(config.projectPath);
            },
          },
        );
        process.stdout.write(JSON.stringify(starts));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_CWD: cwd,
      },
    );

    expect(JSON.parse(output)).toEqual([join(configRoot, "data")]);
  });

  it("loads SQLite-backed browse memory pages with server-side search and no flashbacks", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-browse-page-"));
    const configPath = writeConfig(root);
    const output = runBunScript(
      `
        import {
          createInitialBrowseMemoryPageRequest,
          parseBrowseQuery,
        } from "./src/components/memories/browse-data.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { loadBrowseMemoryPage } from "./src/server/memories/browse.ts";
        import {
          createReaderContentHash,
          writeMemoryContent,
        } from "./src/server/store/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        const configPath = process.env.TRAUMA_TEST_CONFIG_PATH;
        if (!root || !configPath) {
          throw new Error("TRAUMA_TEST_ROOT and TRAUMA_TEST_CONFIG_PATH are required");
        }

        process.env.TRAUMA_CONFIG_PATH = configPath;
        const config = {
          configFilePath: configPath,
          projectPath: root + "/data",
          storePath: root + "/data/store",
          databasePath: root + "/.trauma/trauma.sqlite",
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
        const connection = initializeDatabase(config);
        try {
          const now = Date.parse("2026-05-09T00:00:00.000Z");
          const older = Date.parse("2026-05-08T00:00:00.000Z");
          const firstMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f211";
          const secondMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f212";
          const secondMarkdown = "deep lazy excerpt";
          connection.sqlite
            .prepare("insert into memories (id, url, title, description, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(firstMemoryId, "https://example.com/first", "First Memory", "First description", "memories/" + firstMemoryId + "/CONTENT.md", "success", "disabled", now, now);
          connection.sqlite
            .prepare("insert into memories (id, url, title, description, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(secondMemoryId, "https://example.com/second", "Second Memory", "Second description", "memories/" + secondMemoryId + "/CONTENT.md", "success", "disabled", older, older);
          await writeMemoryContent({
            config,
            memoryId: secondMemoryId,
            frontmatter: {
              id: secondMemoryId,
              url: "https://example.com/second",
              title: "Second Memory",
              capturedAt: new Date(older).toISOString(),
              extractionStatus: "success",
            },
            markdown: secondMarkdown,
          });
          connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("tag-search", "search-tag", now, now);
          connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run(secondMemoryId, "tag-search", now, now);
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, content_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-second", secondMemoryId, "deep lazy excerpt", "", "", 0, secondMarkdown.length, createReaderContentHash(secondMarkdown), now, now);
        } finally {
          connection.close();
        }

        const firstPage = await loadBrowseMemoryPage({
          ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("")),
          limit: 1,
        });
        const secondPage = await loadBrowseMemoryPage({
          query: parseBrowseQuery(""),
          cursor: firstPage.nextCursor,
          limit: 1,
        });
        const fieldedSearchPage = await loadBrowseMemoryPage({
          ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("?q=tag=search-tag")),
          limit: 1,
        });
        const flashbackFilterPage = await loadBrowseMemoryPage({
          ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("?flashback=flashback-second")),
          limit: 1,
        });

        process.stdout.write(JSON.stringify({
          firstPage,
          secondPage,
          fieldedSearchPage,
          flashbackFilterPage,
        }));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_ROOT: root,
      },
    );

    const firstMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f211";
    const secondMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f212";
    expect(JSON.parse(output)).toMatchObject({
      firstPage: {
        memories: [{ id: firstMemoryId, flashbacks: [] }],
        nextCursor: {
          createdAt: "2026-05-09T00:00:00.000Z",
          id: firstMemoryId,
        },
      },
      secondPage: {
        memories: [{ id: secondMemoryId, flashbacks: [] }],
        nextCursor: null,
      },
      fieldedSearchPage: {
        memories: [{ id: secondMemoryId, flashbacks: [] }],
        nextCursor: null,
      },
      flashbackFilterPage: {
        memories: [{ id: secondMemoryId, flashbacks: [] }],
        nextCursor: null,
      },
    });
  });

  it("includes current translated flashbacks in browse rows and hides stale translated output hashes", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-browse-translated-"));
    const configPath = writeConfig(root);
    const output = runBunScript(
      `
        import { mkdir, readFile, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { schema } from "./src/server/db/index.ts";
        import { initializeDatabase } from "./src/server/db/connection.ts";
        import { loadBrowseMemories } from "./src/server/memories/browse.ts";
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
        const configPath = process.env.TRAUMA_TEST_CONFIG_PATH;
        if (!root || !configPath) {
          throw new Error("TRAUMA_TEST_ROOT and TRAUMA_TEST_CONFIG_PATH are required");
        }

        process.env.TRAUMA_CONFIG_PATH = configPath;
        const config = {
          configFilePath: configPath,
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
        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f206";
        const jobId = "019e3906-0000-7000-8000-000000000906";
        const sourceMarkdown = "Source text only.";
        const translatedMarkdown = "翻訳されたflashback対象。";

        const connection = initializeDatabase(config);
        try {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url: "https://example.com/translated",
            title: "Translated Browse",
            description: "Translated browse fixture",
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
            url: "https://example.com/translated",
            title: "Translated Browse",
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
              url: "https://example.com/translated",
              title: "Translated Browse",
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
        const staleHash = "sha256:" + "b".repeat(64);
        const dbConnection = initializeDatabase(config);
        try {
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
          await dbConnection.db.insert(schema.flashbacks).values({
            id: "translated-current",
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
            id: "translated-stale",
            memoryId,
            variantKind: "translation",
            langCode: "ja-JP",
            translationOutputHash: staleHash,
            text: translatedMarkdown,
            prefix: "",
            suffix: "",
            startOffset: 0,
            endOffset: translatedMarkdown.length,
            contentHash: createReaderContentHash(translatedMarkdown),
            createdAt: now,
            updatedAt: now,
          });
        } finally {
          dbConnection.close();
        }

        const result = await loadBrowseMemories();
        process.stdout.write(JSON.stringify(result));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_ROOT: root,
      },
    );

    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f206",
        flashbacks: [
          expect.objectContaining({
            id: "translated-current",
            variantKind: "translation",
            langCode: "ja-JP",
            translationOutputHash: expect.stringMatching(/^sha256:/),
            text: "翻訳されたflashback対象。",
          }),
        ],
      }),
    ]);
  });
});

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

function writeConfig(root: string): string {
  mkdirSync(root, { recursive: true });
  const configPath = join(root, "trauma.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: {
        git: {
          enabled: true,
          remote: "origin",
          branch: "main",
          push: false,
          commitMessageTemplate: "backup memory {memoryId}",
        },
      },
    }),
    "utf8",
  );
  return configPath;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function runBunScript(script: string, env: Record<string, string>): string {
  const repositoryRoot = process.cwd();
  const cacheDir = join(repositoryRoot, ".tmp/bun-cache");
  const temporaryDir = join(repositoryRoot, ".tmp/bun-tmp");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(temporaryDir, { recursive: true });

  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      TMPDIR: temporaryDir,
    },
  });
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
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
    throw new Error("Bun executable is required for browse memory tests");
  }

  return executable;
}

function isBunExecutable(path: string): boolean {
  return path === "bun" || path.endsWith("/bun") || path.endsWith("\\bun.exe");
}

function canAccess(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
