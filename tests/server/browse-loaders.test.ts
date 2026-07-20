import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialBrowseMemoryPageRequest,
  parseBrowseQuery,
} from "../../src/components/memories/browse-data";
import { loadTraumaConfig, type ResolvedTraumaConfig } from "../../src/server/config";
import { initializeDatabase, schema } from "../../src/server/db";
import {
  loadBrowseFlashbacksForMemories,
  loadFlashbackBrowseRows,
  loadRecentFlashbackBrowseRows,
} from "../../src/server/flashbacks/browse";
import { loadBrowseMemoryPage } from "../../src/server/memories/browse";
import { loadMomentBrowseRows } from "../../src/server/moments/browse";
import {
  createMemoryContentFixture,
  createReaderContentHash,
  writeMemoryContent,
} from "../../src/server/store";
import { readCanonicalReaderText } from "../../src/server/store/flashback-markers";
import { createSha256ContentHash } from "../../src/server/translation/hash";
import { resolveTranslatedMemoryContentPath } from "../../src/server/translation/paths";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../src/server/translation/prompt";

const originalEnv = { ...process.env };
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f901";
const olderMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f902";
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
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
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

  it("keeps the flashback browse database open while resolving translated rows", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const sourceMarkdown = "# Loader Memory\n\nSource text.";
    const translatedMarkdown = "翻訳された selected text.";
    const translatedReaderText = readCanonicalReaderText(translatedMarkdown);
    const flashbackStartOffset = translatedReaderText.indexOf("selected text");

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
          url: `https://example.com/${memoryId}`,
          title: "Loader Memory",
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
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.translationJobs).values({
        jobId: "019e3906-0000-7000-8000-000000000916",
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
      await connection.db.insert(schema.flashbacks).values({
        id: "translated-flashback-loader",
        memoryId,
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: outputHash,
        text: "selected text",
        prefix: "翻訳された ",
        suffix: ".",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(translatedMarkdown),
        createdAt: now,
        updatedAt: now,
      });
      await connection.db.insert(schema.flashbacks).values({
        id: "stale-translated-flashback-loader",
        memoryId,
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: staleHash,
        text: "selected text",
        prefix: "翻訳された ",
        suffix: ".",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(translatedMarkdown),
        createdAt: new Date(now.getTime() + 1_000),
        updatedAt: new Date(now.getTime() + 1_000),
      });
    } finally {
      connection.close();
    }

    await expect(loadFlashbackBrowseRows()).resolves.toEqual([
      {
        id: "translated-flashback-loader",
        memoryId,
        memoryTitle: "Loader Memory",
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: outputHash,
        text: "selected text",
        prefix: "翻訳された ",
        suffix: ".",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(translatedMarkdown),
        createdAt: "2026-05-16T00:00:00.000Z",
      },
    ]);
    await expect(loadRecentFlashbackBrowseRows({ limit: 5 })).resolves.toEqual([
      {
        id: "translated-flashback-loader",
        memoryId,
        memoryTitle: "Loader Memory",
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: outputHash,
        text: "selected text",
        prefix: "翻訳された ",
        suffix: ".",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "selected text".length,
        contentHash: createReaderContentHash(translatedMarkdown),
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

  it("backfills recent flashback rows after renderability filtering", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const markdown =
      "# Loader Memory\n\nA first selected text and a second selected text.";
    const readerText = readCanonicalReaderText(markdown);
    const firstOffset = readerText.indexOf("first selected text");
    const secondOffset = readerText.indexOf("second selected text");
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
          id: "stale-recent-flashback",
          memoryId,
          text: "first selected text",
          prefix: "before",
          suffix: "after",
          startOffset: firstOffset,
          endOffset: firstOffset + "first selected text".length,
          contentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          createdAt: new Date(now.getTime() + 2_000),
          updatedAt: new Date(now.getTime() + 2_000),
        },
        {
          id: "renderable-recent-flashback",
          memoryId,
          text: "first selected text",
          prefix: "before",
          suffix: "after",
          startOffset: firstOffset,
          endOffset: firstOffset + "first selected text".length,
          contentHash: createReaderContentHash(markdown),
          createdAt: new Date(now.getTime() + 1_000),
          updatedAt: new Date(now.getTime() + 1_000),
        },
        {
          id: "backfilled-recent-flashback",
          memoryId,
          text: "second selected text",
          prefix: "before",
          suffix: "after",
          startOffset: secondOffset,
          endOffset: secondOffset + "second selected text".length,
          contentHash: createReaderContentHash(markdown),
          createdAt: now,
          updatedAt: now,
        },
      ]);
    } finally {
      connection.close();
    }

    await expect(loadRecentFlashbackBrowseRows({ limit: 2 })).resolves.toEqual([
      expect.objectContaining({ id: "renderable-recent-flashback" }),
      expect.objectContaining({ id: "backfilled-recent-flashback" }),
    ]);
  });

  it("filters stale flashbacks from paged memory browse IDs", async () => {
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

    await expect(
      loadBrowseMemoryPage({
        ...createInitialBrowseMemoryPageRequest(
          parseBrowseQuery("?flashback=renderable-memory-flashback"),
        ),
        limit: 1,
      }),
    ).resolves.toMatchObject({
      memories: [{ id: memoryId, flashbacks: [] }],
      nextCursor: null,
    });
    await expect(
      loadBrowseMemoryPage({
        ...createInitialBrowseMemoryPageRequest(
          parseBrowseQuery("?flashback=stale-memory-flashback"),
        ),
        limit: 1,
      }),
    ).resolves.toEqual({ memories: [], nextCursor: null });
  });

  it("loads memory browse pages without validating or returning flashbacks", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values({
        id: "unvalidated-page-flashback",
        memoryId,
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: 0,
        endOffset: "selected text".length,
        contentHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    await expect(
      loadBrowseMemoryPage(
        createInitialBrowseMemoryPageRequest(parseBrowseQuery("")),
      ),
    ).resolves.toMatchObject({
      memories: [
        {
          id: memoryId,
          flashbacks: [],
        },
      ],
      nextCursor: null,
    });
  });

  it("filters stale flashbacks from paged browse flashback filters", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config, {
      createdAt: new Date(now.getTime() + 1_000),
      id: memoryId,
      title: "Stale Flashback Memory",
    });
    await seedMemory(config, {
      createdAt: now,
      id: olderMemoryId,
      title: "Renderable Flashback Memory",
    });
    const staleMarkdown = "# Stale Flashback Memory\n\nA stale selected text.";
    const renderableMarkdown =
      "# Renderable Flashback Memory\n\nA needle selected text.";
    const renderableOffset =
      readCanonicalReaderText(renderableMarkdown).indexOf("needle selected text");
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: `https://example.com/${memoryId}`,
        title: "Stale Flashback Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: staleMarkdown,
    });
    await writeMemoryContent({
      config,
      memoryId: olderMemoryId,
      frontmatter: {
        id: olderMemoryId,
        url: `https://example.com/${olderMemoryId}`,
        title: "Renderable Flashback Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: renderableMarkdown,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values([
        {
          id: "stale-page-flashback",
          memoryId,
          text: "needle selected text",
          prefix: "before",
          suffix: "after",
          startOffset: 0,
          endOffset: "needle selected text".length,
          contentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          createdAt: new Date(now.getTime() + 1_000),
          updatedAt: new Date(now.getTime() + 1_000),
        },
        {
          id: "renderable-page-flashback",
          memoryId: olderMemoryId,
          text: "needle selected text",
          prefix: "before",
          suffix: "after",
          startOffset: renderableOffset,
          endOffset: renderableOffset + "needle selected text".length,
          contentHash: createReaderContentHash(renderableMarkdown),
          createdAt: now,
          updatedAt: now,
        },
      ]);
    } finally {
      connection.close();
    }

    const fieldedPage = await loadBrowseMemoryPage({
      ...createInitialBrowseMemoryPageRequest(
        parseBrowseQuery("?q=flashback:{needle selected text}"),
      ),
      limit: 1,
    });
    const freeSearchPage = await loadBrowseMemoryPage({
      ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("?q=needle")),
      limit: 1,
    });
    const staleIdPage = await loadBrowseMemoryPage({
      ...createInitialBrowseMemoryPageRequest(
        parseBrowseQuery("?flashback=stale-page-flashback"),
      ),
      limit: 1,
    });

    expect(fieldedPage).toMatchObject({
      memories: [{ id: olderMemoryId, flashbacks: [] }],
      nextCursor: null,
    });
    expect(freeSearchPage).toMatchObject({
      memories: [{ id: olderMemoryId, flashbacks: [] }],
      nextCursor: null,
    });
    expect(staleIdPage).toEqual({
      memories: [],
      nextCursor: null,
    });
  });

  it("keeps scanning stale flashback page candidates until a renderable row is found", async () => {
    const config = await createRuntimeConfig();
    const staleCount = 25;
    const staleFlashbacks: (typeof schema.flashbacks.$inferInsert)[] = [];

    for (let index = 0; index < staleCount; index += 1) {
      const id = `018f04a2-3c6f-7c88-9a8b-8c99a9b7e${String(index).padStart(3, "0")}`;
      const createdAt = new Date(now.getTime() + (staleCount - index) * 1_000);
      await seedMemory(config, {
        createdAt,
        id,
        title: `Stale Flashback Memory ${index}`,
      });
      await writeMemoryContent({
        config,
        memoryId: id,
        frontmatter: {
          id,
          url: `https://example.com/${id}`,
          title: `Stale Flashback Memory ${index}`,
          capturedAt: createdAt.toISOString(),
          extractionStatus: "success",
        },
        markdown: `# Stale Flashback Memory ${index}\n\nA stale selected text.`,
      });
      staleFlashbacks.push({
        id: `stale-page-flashback-${index}`,
        memoryId: id,
        text: "needle selected text",
        prefix: "before",
        suffix: "after",
        startOffset: 0,
        endOffset: "needle selected text".length,
        contentHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        createdAt,
        updatedAt: createdAt,
      });
    }

    const renderableMarkdown =
      "# Renderable Flashback Memory\n\nA needle selected text.";
    const renderableOffset =
      readCanonicalReaderText(renderableMarkdown).indexOf("needle selected text");
    await seedMemory(config, {
      createdAt: now,
      id: olderMemoryId,
      title: "Renderable Flashback Memory",
    });
    await writeMemoryContent({
      config,
      memoryId: olderMemoryId,
      frontmatter: {
        id: olderMemoryId,
        url: `https://example.com/${olderMemoryId}`,
        title: "Renderable Flashback Memory",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: renderableMarkdown,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values([
        ...staleFlashbacks,
        {
          id: "renderable-page-flashback-after-stale-window",
          memoryId: olderMemoryId,
          text: "needle selected text",
          prefix: "before",
          suffix: "after",
          startOffset: renderableOffset,
          endOffset: renderableOffset + "needle selected text".length,
          contentHash: createReaderContentHash(renderableMarkdown),
          createdAt: now,
          updatedAt: now,
        },
      ]);
    } finally {
      connection.close();
    }

    const boundedPage = await loadBrowseMemoryPage({
      ...createInitialBrowseMemoryPageRequest(parseBrowseQuery("?q=needle")),
      limit: 1,
    });
    expect(boundedPage).toMatchObject({
      memories: [],
      nextCursor: expect.objectContaining({ id: expect.any(String) }),
    });

    await expect(loadBrowseMemoryPage({
      cursor: boundedPage.nextCursor,
      limit: 1,
      query: parseBrowseQuery("?q=needle"),
    })).resolves.toMatchObject({
      memories: [{ id: olderMemoryId, flashbacks: [] }],
      nextCursor: null,
    });
  });

  it("returns memory-card flashbacks keyed by memory id", async () => {
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
        id: "memory-card-flashback",
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

    await expect(
      loadBrowseFlashbacksForMemories({
        memoryIds: [memoryId],
        selectedFlashbackId: "memory-card-flashback",
      }),
    ).resolves.toEqual({
      [memoryId]: [
        {
          id: "memory-card-flashback",
          memoryId,
          variantKind: "source",
          langCode: null,
          translationOutputHash: null,
          text: "selected text",
          prefix: "before",
          suffix: "after",
          createdAt: "2026-05-16T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns an empty memory-card flashback record without config for empty memory ids", async () => {
    const root = await makeTempRoot();
    process.env.TRAUMA_CONFIG_PATH = join(root, "missing-trauma.config.json");

    await expect(
      loadBrowseFlashbacksForMemories({
        memoryIds: [],
        selectedFlashbackId: "unused",
      }),
    ).resolves.toEqual({});
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

  it("preserves all Moment browse rows across bounded repository pages", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const sectionCount = 101;
    const sections = Array.from(
      { length: sectionCount },
      (_, index) => `## Section ${index + 1}\n\nBody ${index + 1}.`,
    );
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
      markdown: ["# Loader Memory", ...sections].join("\n\n"),
    });
    const connection = initializeDatabase(config);
    try {
      for (let index = 0; index < sectionCount; index += 1) {
        const ordinal = index + 1;
        const createdAt = new Date(now.getTime() + index);
        await connection.repositories.moments.create({
          id: `moment-page-${String(ordinal).padStart(3, "0")}`,
          memoryId,
          sectionAnchor: `section-${ordinal}`,
          sectionTitle: `Section ${ordinal}`,
          sectionLevel: 2,
          sectionPath: `1/${ordinal}`,
          sectionStartOffset: null,
          sectionEndOffset: null,
          contentHash: null,
          createdAt,
          updatedAt: createdAt,
        });
      }
    } finally {
      connection.close();
    }

    const rows = await loadMomentBrowseRows();
    expect(rows).toHaveLength(sectionCount);
    expect(rows.every((row) => row.targetStatus === "current")).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(sectionCount);
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

async function seedMemory(
  config: ResolvedTraumaConfig,
  input: {
    createdAt?: Date;
    id?: string;
    title?: string;
  } = {},
): Promise<void> {
  const id = input.id ?? memoryId;
  const title = input.title ?? "Loader Memory";
  const createdAt = input.createdAt ?? now;
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id,
      url: `https://example.com/${id}`,
      title,
      description: null,
      faviconUrl: null,
      contentPath: `memories/${id}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt,
      updatedAt: createdAt,
    });
  } finally {
    connection.close();
  }
}
