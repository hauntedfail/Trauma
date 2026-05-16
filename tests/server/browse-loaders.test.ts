import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadTraumaConfig, type ResolvedTraumaConfig } from "../../src/server/config";
import { initializeDatabase, schema } from "../../src/server/db";
import { loadFlashbackBrowseRows } from "../../src/server/flashbacks/browse";
import { loadMomentBrowseRows } from "../../src/server/moments/browse";

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
  it("keeps the flashback browse database open until rows materialize", async () => {
    const config = await createRuntimeConfig();
    await seedMemory(config);
    const connection = initializeDatabase(config);
    try {
      await connection.db.insert(schema.flashbacks).values({
        id: "flashback-loader",
        memoryId,
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: 10,
        endOffset: 23,
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
        startOffset: 10,
        endOffset: 23,
        contentHash: null,
        createdAt: "2026-05-16T00:00:00.000Z",
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
      },
    ]);
  });
});

async function createRuntimeConfig(): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-browse-loaders-"));
  tempDirs.push(root);
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
