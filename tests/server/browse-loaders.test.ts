import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadTraumaConfig, type ResolvedTraumaConfig } from "../../src/server/config";
import { initializeDatabase, schema } from "../../src/server/db";
import { loadFlashbackBrowseRows } from "../../src/server/flashbacks/browse";
import { loadBrowseMemories } from "../../src/server/memories/browse";
import { loadMomentBrowseRows } from "../../src/server/moments/browse";
import { createReaderContentHash, writeMemoryContent } from "../../src/server/store";
import { readCanonicalReaderText } from "../../src/server/store/flashback-markers";

const originalEnv = { ...process.env };
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f901";
const now = new Date("2026-05-16T00:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("server browse loaders", () => {
  it("uses empty Moment fixtures without loading runtime config", async () => {
    const root = await makeTempRoot();
    process.env.TRAUMA_BROWSE_FIXTURES = "1";
    process.env.TRAUMA_CONFIG_PATH = join(root, "missing-trauma.config.json");

    await expect(loadMomentBrowseRows()).resolves.toEqual([]);
  });

  it("loads runtime Moments in fixture mode when a config exists", async () => {
    const config = await createRuntimeConfig();
    process.env.TRAUMA_BROWSE_FIXTURES = "1";
    await seedMemory(config);
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Loader Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Loader Memory\n\n## Chapter One\n\nBody.",
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.moments.create({
        id: "moment-loader",
        memoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(loadMomentBrowseRows()).resolves.toMatchObject([
      {
        id: "moment-loader",
        targetAnchor: "chapter-one",
        targetStatus: "current",
      },
    ]);
  });

  it("keeps the flashback browse database open until rows materialize", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const markdown = "# Loader Memory\n\nA selected text.";
    const flashbackStartOffset =
      readCanonicalReaderText(markdown).indexOf("selected text");
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Loader Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values({
        id: "flashback-loader",
        memoryId,
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(markdown),
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(loadFlashbackBrowseRows()).resolves.toEqual([
      {
        id: "flashback-loader",
        memoryId,
        memoryTitle: "Loader Memory",
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(markdown),
        createdAt: "2026-05-16T00:00:00.000Z",
      },
    ]);
  });

  it("filters stale flashback browse rows that cannot render into the reader", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const markdown = "# Loader Memory\n\nA selected text.";
    const flashbackStartOffset =
      readCanonicalReaderText(markdown).indexOf("selected text");
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Loader Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values({
        id: "stale-flashback-loader",
        memoryId,
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(loadFlashbackBrowseRows()).resolves.toEqual([]);
  });

  it("filters stale flashbacks from memory browse aggregates", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const markdown = "# Loader Memory\n\nA selected text.";
    const flashbackStartOffset =
      readCanonicalReaderText(markdown).indexOf("selected text");
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Loader Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values([
        {
          id: "renderable-memory-flashback",
          memoryId,
          text: "selected text",
          prefix: "before",
          suffix: "after",
          startOffset: flashbackStartOffset,
          endOffset: flashbackStartOffset + "selected text".length,
          contentHash: createReaderContentHash(markdown),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "stale-memory-flashback",
          memoryId,
          text: "selected text",
          prefix: "before",
          suffix: "after",
          startOffset: flashbackStartOffset,
          endOffset: flashbackStartOffset + "selected text".length,
          contentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    } finally {
      connection.close();
    }

    await expect(loadBrowseMemories()).resolves.toMatchObject([
      {
        id: memoryId,
        flashbacks: [
          {
            id: "renderable-memory-flashback",
          },
        ],
      },
    ]);
  });

  it("keeps the Moment browse database open until rows materialize", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.moments.create({
        id: "moment-loader",
        memoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(loadMomentBrowseRows()).resolves.toEqual([
      {
        id: "moment-loader",
        memoryId,
        memoryTitle: "Loader Memory",
        memoryUrl: `https://example.com/${memoryId}`,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: "2026-05-16T00:00:00.000Z",
        targetAnchor: null,
        targetStatus: "stale",
      },
    ]);
  });

  it("resolves stale Moment anchors by current section path when unique", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Loader Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Loader Memory\n\n## Renamed Chapter\n\nBody.",
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.moments.create({
        id: "moment-loader",
        memoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(loadMomentBrowseRows()).resolves.toEqual([
      {
        id: "moment-loader",
        memoryId,
        memoryTitle: "Loader Memory",
        memoryUrl: `https://example.com/${memoryId}`,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: "2026-05-16T00:00:00.000Z",
        targetAnchor: "renamed-chapter",
        targetStatus: "resolved_from_path",
      },
    ]);
  });
});

async function createRuntimeConfig(): Promise<ResolvedTraumaConfig> {
  const root = await makeTempRoot();
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        projectPath: "./data",
        storePath: "./data/storage",
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: false,
            remote: "origin",
            branch: "main",
            push: false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  process.env.TRAUMA_CONFIG_PATH = configPath;
  return loadTraumaConfig({ configPath });
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-browse-loaders-"));
  tempDirs.push(root);
  return root;
}

async function seedMemory(config: ResolvedTraumaConfig): Promise<void> {
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: `https://example.com/${memoryId}`,
      title: "Loader Memory",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${memoryId}/CONTENT.md`,
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
}
