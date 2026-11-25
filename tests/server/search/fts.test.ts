import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialBrowseMemoryPageRequest,
  parseBrowseQuery,
} from "../../../src/components/memories/browse-data";
import type { MemoryBackupQueue } from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { readBundledMigrations } from "../../../src/server/db/bundled-migrations";
import {
  applyBundledMigrations,
  applyRuntimeMigrations,
} from "../../../src/server/db/migrations";
import { addMemory } from "../../../src/server/memories/add-memory";
import { loadBrowseMemoryPage } from "../../../src/server/memories/browse";
import { deleteMemory } from "../../../src/server/memories/delete-memory";
import {
  backfillMemorySearchIndex,
  deleteMemorySearchDocument,
  sanitizeFtsQuery,
  searchMemoryFts,
  upsertMemorySearchDocument,
} from "../../../src/server/search";
import { writeMemoryContent } from "../../../src/server/store/memory-content";

const FTS5_MIGRATION_FOLDER_MILLIS = 1785100000000;
const tempDirs: string[] = [];
const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete process.env.TRAUMA_CONFIG_PATH;
  } else {
    process.env.TRAUMA_CONFIG_PATH = previousConfigPath;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempRoot(prefix = "trauma-fts5-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(root: string): ResolvedTraumaConfig {
  const configFilePath = join(root, "trauma.config.json");
  const config: ResolvedTraumaConfig = {
    configFilePath,
    projectPath: join(root, "data"),
    storePath: join(root, "data/store"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
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
  writeFileSync(
    configFilePath,
    JSON.stringify(
      {
        projectPath: config.projectPath,
        storePath: config.storePath,
        databasePath: config.databasePath,
        backup: config.backup,
      },
      null,
      2,
    ),
    "utf8",
  );
  return config;
}

function createNoopBackupQueue(): MemoryBackupQueue {
  return {
    enqueue: async () => ({ backupStatus: "disabled" as const }),
    start: () => undefined,
    stop: async () => undefined,
    waitForIdle: async () => undefined,
  } as unknown as MemoryBackupQueue;
}

describe("memory_search_fts migration", () => {
  it("creates memory_search_fts on a fresh database", () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      const table = connection.sqlite
        .query<{ name: string; sql: string }, []>(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_search_fts'",
        )
        .get();

      expect(table).toBeDefined();
      expect(table?.name).toBe("memory_search_fts");
      expect(table?.sql.toLowerCase()).toContain("fts5");
      expect(table?.sql.toLowerCase()).toContain("unicode61");
    } finally {
      connection.close();
    }
  });

  it("upgrades an existing pre-0023 database cleanly", () => {
    const root = createTempRoot();
    const sqlite = new Database(join(root, "existing.sqlite"), { create: true });

    try {
      const allMigrations = readBundledMigrations();
      const preFtsMigrations = allMigrations.filter(
        (migration) => migration.folderMillis < FTS5_MIGRATION_FOLDER_MILLIS,
      );
      expect(preFtsMigrations.length).toBeGreaterThan(0);
      expect(preFtsMigrations.length).toBeLessThan(allMigrations.length);
      expect(
        allMigrations.some(
          (migration) => migration.folderMillis === FTS5_MIGRATION_FOLDER_MILLIS,
        ),
      ).toBe(true);

      applyRuntimeMigrations(sqlite, preFtsMigrations, "pre-fts");

      const beforeTable = sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_search_fts'",
        )
        .get();
      expect(beforeTable).toBeNull();

      // Upgrade to latest bundled migrations.
      applyBundledMigrations(sqlite);

      const afterTable = sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_search_fts'",
        )
        .get();
      expect(afterTable?.name).toBe("memory_search_fts");
    } finally {
      sqlite.close();
    }
  });
});

describe("sanitizeFtsQuery and FTS5 search", () => {
  it("sanitizes dangerous FTS5 syntax characters without throwing", () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      upsertMemorySearchDocument(connection.db, {
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
        title: "FTS Syntax Safety",
        url: "https://example.com/fts",
        description: "Testing operators AND OR NOT NEAR",
        bodyText: "Contains quotes, colons, parentheses, and asterisks safely.",
      });

      const adversarialQueries = [
        "",
        "   ",
        '"""',
        '"unclosed quote',
        "AND OR NOT NEAR",
        "title:foo bar:baz nonexistent_column:qux",
        "foo* (bar) ^baz -qux",
        "NEAR(foo bar, 3)",
        "*** --- ??? ::: () [] {} \\ / % _",
        "'; DROP TABLE memories; --",
        '日本語 "未閉じ (括弧) OR *',
      ];

      expect(sanitizeFtsQuery("*** --- ???")).toBe("");
      expect(sanitizeFtsQuery('title:secret "unclosed')).toBe(
        '"title" "secret" "unclosed"',
      );

      for (const query of adversarialQueries) {
        expect(() => searchMemoryFts(connection.sqlite, query)).not.toThrow();
      }
    } finally {
      connection.close();
    }
  });

  it("ranks English matches, supports upsert deduplication, pagination, and deletion", () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      const idBodyOnly = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201";
      const idTitleMatch = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202";

      upsertMemorySearchDocument(connection.db, {
        memoryId: idBodyOnly,
        title: "Distributed Systems Notes",
        url: "https://example.com/systems",
        description: "General notes on storage engines",
        bodyText: "SQLite uses a write-ahead log and supports zeppelin indexing.",
      });

      upsertMemorySearchDocument(connection.db, {
        memoryId: idTitleMatch,
        title: "Zeppelin Architecture Guide",
        url: "https://example.com/zeppelin",
        description: "Deep dive into zeppelin design",
        bodyText: "Overview of classic airship engineering.",
      });

      // Upsert again with updated text to verify no duplicate FTS rows are left behind.
      upsertMemorySearchDocument(connection.db, {
        memoryId: idTitleMatch,
        title: "Zeppelin Architecture Guide",
        url: "https://example.com/zeppelin",
        description: "Deep dive into zeppelin design",
        bodyText: "Updated overview of zeppelin engineering.",
      });

      const allMatches = searchMemoryFts(connection.db, "zeppelin");
      expect(allMatches.map((m) => m.memoryId)).toEqual([idTitleMatch, idBodyOnly]);
      expect(allMatches[0]?.snippet).toContain("<mark>");
      expect(allMatches[1]?.snippet).toContain("<mark>zeppelin</mark>");

      const secondPage = searchMemoryFts(connection.db, "zeppelin", {
        limit: 1,
        offset: 1,
      });
      expect(secondPage.map((m) => m.memoryId)).toEqual([idBodyOnly]);

      deleteMemorySearchDocument(connection.db, idTitleMatch);
      const afterDelete = searchMemoryFts(connection.db, "zeppelin");
      expect(afterDelete.map((m) => m.memoryId)).toEqual([idBodyOnly]);
    } finally {
      connection.close();
    }
  });

  it("matches Japanese exact tokens and Japanese substrings with highlighted snippets", () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      const idJaSentence = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301";
      const idJaToken = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f302";

      upsertMemorySearchDocument(connection.sqlite, {
        memoryId: idJaSentence,
        title: "東京メモ",
        url: "https://example.jp/tokyo",
        description: "街歩きの記録",
        bodyText: "今日は東京都渋谷区でスペシャルティコーヒーを飲みました。",
      });

      upsertMemorySearchDocument(connection.sqlite, {
        memoryId: idJaToken,
        title: "京都 コーヒー メモ",
        url: "https://example.jp/kyoto",
        description: "喫茶店まとめ",
        bodyText: "鴨川沿いの静かなカフェで読書した。",
      });

      // Substring inside a contiguous Japanese sentence (not matched by unicode61 alone).
      const shibuyaMatches = searchMemoryFts(connection.sqlite, "渋谷");
      expect(shibuyaMatches.map((m) => m.memoryId)).toEqual([idJaSentence]);
      expect(shibuyaMatches[0]?.snippet).toContain("<mark>渋谷</mark>");

      // Matches both the spaced token doc (FTS5) and the contiguous sentence doc (LIKE fallback).
      const coffeeMatches = searchMemoryFts(connection.sqlite, "コーヒー");
      expect(coffeeMatches.map((m) => m.memoryId)).toEqual([
        idJaToken,
        idJaSentence,
      ]);
      expect(coffeeMatches[1]?.snippet).toContain("<mark>コーヒー</mark>");

      // Multi-term Japanese substring query.
      const multiJa = searchMemoryFts(connection.sqlite, "渋谷 コーヒー");
      expect(multiJa.map((m) => m.memoryId)).toEqual([idJaSentence]);
    } finally {
      connection.close();
    }
  });
});

describe("addMemory, deleteMemory, and browse integration", () => {
  it("syncs FTS5 on addMemory/deleteMemory and matches CONTENT.md bodies in browse search", async () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    process.env.TRAUMA_CONFIG_PATH = config.configFilePath;
    const connection = initializeDatabase(config);

    try {
      const enMemory = await addMemory({
        url: "https://example.com/en-body",
        config,
        db: connection.db,
        backupQueue: createNoopBackupQueue(),
        importer: {
          importUrl: async ({ url }) => ({
            status: "success",
            url,
            title: "Unrelated English Title",
            description: "Generic description",
            faviconUrl: null,
            markdown: "# Body Section\n\nSecret keyword **bioluminescent** lives only in markdown body.",
          }),
        },
        now: () => new Date("2026-05-09T01:00:00.000Z"),
      });

      const jaMemory = await addMemory({
        url: "https://example.jp/ja-body",
        config,
        db: connection.db,
        backupQueue: createNoopBackupQueue(),
        importer: {
          importUrl: async ({ url }) => ({
            status: "success",
            url,
            title: "無関係なタイトル",
            description: "概要なし",
            faviconUrl: null,
            markdown: "## 本文\n\n神保町の古書店で珍しい技術書を見つけた。",
          }),
        },
        now: () => new Date("2026-05-09T02:00:00.000Z"),
      });

      // Verify FTS5 direct search.
      expect(searchMemoryFts(connection.db, "bioluminescent").map((m) => m.memoryId)).toEqual([
        enMemory.id,
      ]);
      expect(searchMemoryFts(connection.db, "古書店").map((m) => m.memoryId)).toEqual([
        jaMemory.id,
      ]);

      // Verify browse loader matches CONTENT.md bodies for both English and Japanese substrings.
      const enBrowse = await loadBrowseMemoryPage(
        createInitialBrowseMemoryPageRequest(parseBrowseQuery("?q=bioluminescent")),
        { startBackupQueue: () => undefined },
      );
      expect(enBrowse.memories.map((m) => m.id)).toEqual([enMemory.id]);

      const jaBrowse = await loadBrowseMemoryPage(
        createInitialBrowseMemoryPageRequest(parseBrowseQuery("?q=古書店")),
        { startBackupQueue: () => undefined },
      );
      expect(jaBrowse.memories.map((m) => m.id)).toEqual([jaMemory.id]);

      // Verify deleteMemory removes the FTS5 entry.
      const deleted = await deleteMemory({
        config,
        db: connection.db,
        memoryId: enMemory.id,
      });
      expect(deleted.status).toBe("deleted");
      expect(searchMemoryFts(connection.db, "bioluminescent")).toEqual([]);
    } finally {
      connection.close();
    }
  });
});

describe("backfillMemorySearchIndex", () => {
  it("indexes existing memories from CONTENT.md and safely skips missing files", async () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      const now = Date.parse("2026-05-09T00:00:00.000Z");
      const existingId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f401";
      const missingFileId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f402";
      const alreadyIndexedId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f403";

      const insertMemory = connection.sqlite.prepare(
        "INSERT INTO memories (id, url, title, description, content_path, extraction_status, backup_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );

      insertMemory.run(
        existingId,
        "https://example.com/backfill-1",
        "Backfill Target",
        "Needs indexing",
        `memories/${existingId}/CONTENT.md`,
        "success",
        "disabled",
        now,
        now,
      );
      insertMemory.run(
        missingFileId,
        "https://example.com/missing",
        "Missing File Memory",
        "No file on disk",
        `memories/${missingFileId}/CONTENT.md`,
        "success",
        "disabled",
        now + 1000,
        now + 1000,
      );
      insertMemory.run(
        alreadyIndexedId,
        "https://example.com/already",
        "Already Indexed",
        "Pre-indexed",
        `memories/${alreadyIndexedId}/CONTENT.md`,
        "success",
        "disabled",
        now + 2000,
        now + 2000,
      );

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: existingId,
        frontmatter: {
          id: existingId,
          url: "https://example.com/backfill-1",
          title: "Backfill Target",
          capturedAt: new Date(now).toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Archived Essay\n\nDiscusses **quasar** astronomy and 銀河系の観測.",
      });

      upsertMemorySearchDocument(connection.sqlite, {
        memoryId: alreadyIndexedId,
        title: "Already Indexed",
        url: "https://example.com/already",
        description: "Pre-indexed",
        bodyText: "Original pre-indexed body",
      });

      const firstPass = await backfillMemorySearchIndex({
        db: connection.db,
        storePath: config.storePath,
      });

      expect(firstPass).toEqual({
        totalMissing: 2,
        indexed: 1,
        skippedMissingFiles: 1,
        errors: [],
      });

      expect(searchMemoryFts(connection.db, "quasar").map((m) => m.memoryId)).toEqual([
        existingId,
      ]);
      expect(searchMemoryFts(connection.db, "銀河系").map((m) => m.memoryId)).toEqual([
        existingId,
      ]);

      // Second pass should only see the still-missing file and not re-index existingId.
      const secondPass = await backfillMemorySearchIndex({
        db: connection.db,
        storePath: config.storePath,
      });
      expect(secondPass).toEqual({
        totalMissing: 1,
        indexed: 0,
        skippedMissingFiles: 1,
        errors: [],
      });
    } finally {
      connection.close();
    }
  });
});
