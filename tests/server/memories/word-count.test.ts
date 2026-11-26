import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import {
  backfillMemoryWordCounts,
  countMarkdownWords,
  countWordsInText,
} from "../../../src/server/memories/word-count";
import { writeMemoryContent } from "../../../src/server/store/memory-content";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempRoot(prefix = "trauma-word-count-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(root: string): ResolvedTraumaConfig {
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data", "store"),
    databasePath: join(root, ".trauma", "trauma.sqlite"),
    backup: {
      git: {
        enabled: false,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup {action} {memoryId}",
      },
    },
  };
}

describe("countMarkdownWords and countWordsInText", () => {
  it("counts words in an English Markdown body", () => {
    const markdown = [
      "# Hello World",
      "",
      "This is a **short** [example](https://example.com) paragraph.",
    ].join("\n");

    expect(countMarkdownWords(markdown)).toBe(8);
  });

  it("counts each Hiragana, Katakana, Kanji, and Hangul character as one word", () => {
    // 10 Japanese characters (Kanji + Hiragana + Katakana) without spaces.
    expect(countMarkdownWords("日本語のカタカナ文章")).toBe(10);
    // CJK Extension A (\u3400), CJK Compatibility (\uf900), and Hangul (3 chars).
    expect(countWordsInText("\u3400\uf900한국어")).toBe(5);
  });

  it("counts a mixed English and Japanese body using the Defuddle rule", () => {
    // Reading(1) + 東京ガイド(5) + in(1) + 2026(1) + with(1) + SolidStart(1) = 10
    expect(countMarkdownWords("Reading 東京ガイド in 2026 with SolidStart")).toBe(10);
    // CJK characters split adjacent Latin runs: SolidStart(1) + 入(1) + 門(1) + guide(1) = 4
    expect(countMarkdownWords("SolidStart入門guide")).toBe(4);
  });

  it("excludes YAML frontmatter words from the count", () => {
    const rawContent = [
      "---",
      'id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f401"',
      'url: "https://example.com/many-frontmatter-words-here"',
      'title: "Frontmatter Title Words Must Not Be Counted"',
      'captured_at: "2026-05-09T00:00:00.000Z"',
      'extraction_status: "success"',
      "---",
      "Alpha beta gamma",
    ].join("\n");

    expect(countMarkdownWords(rawContent)).toBe(3);
  });

  it("returns 0 for empty, whitespace-only, or frontmatter-only bodies", () => {
    expect(countMarkdownWords("")).toBe(0);
    expect(countMarkdownWords("   \n\t  ")).toBe(0);
    expect(
      countMarkdownWords(
        [
          "---",
          'id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f401"',
          'title: "Only Frontmatter"',
          "---",
          "",
        ].join("\n"),
      ),
    ).toBe(0);
  });
});

describe("backfillMemoryWordCounts", () => {
  it("fills NULL success rows, preserves non-null/updated_at/link_only rows, skips missing files, isolates path escapes, and is idempotent", async () => {
    const root = createTempRoot();
    const config = createTestConfig(root);
    const connection = initializeDatabase(config);

    try {
      const baseTime = Date.parse("2026-05-09T00:00:00.000Z");
      const englishId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f501";
      const japaneseId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f502";
      const alreadyCountedId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f503";
      const zeroCountedId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f504";
      const missingFileId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f505";
      const lexicalEscapeId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f506";
      const symlinkEscapeId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f507";
      const linkOnlyId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f508";

      const insertMemory = connection.sqlite.prepare(
        `INSERT INTO memories (
          id, url, title, description, content_path, extraction_status,
          word_count, backup_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      insertMemory.run(
        englishId,
        "https://example.com/english",
        "English Memory",
        null,
        `memories/${englishId}/CONTENT.md`,
        "success",
        null,
        "disabled",
        baseTime,
        baseTime + 111,
      );
      insertMemory.run(
        japaneseId,
        "https://example.com/japanese",
        "Japanese Memory",
        null,
        `memories/${japaneseId}/CONTENT.md`,
        "success",
        null,
        "disabled",
        baseTime + 1000,
        baseTime + 222,
      );
      insertMemory.run(
        alreadyCountedId,
        "https://example.com/already",
        "Already Counted",
        null,
        `memories/${alreadyCountedId}/CONTENT.md`,
        "success",
        777,
        "disabled",
        baseTime + 2000,
        baseTime + 333,
      );
      insertMemory.run(
        zeroCountedId,
        "https://example.com/zero",
        "Zero Counted",
        null,
        `memories/${zeroCountedId}/CONTENT.md`,
        "success",
        0,
        "disabled",
        baseTime + 2500,
        baseTime + 350,
      );
      insertMemory.run(
        missingFileId,
        "https://example.com/missing",
        "Missing File",
        null,
        `memories/${missingFileId}/CONTENT.md`,
        "success",
        null,
        "disabled",
        baseTime + 3000,
        baseTime + 444,
      );
      insertMemory.run(
        lexicalEscapeId,
        "https://example.com/escape",
        "Escaping Path",
        null,
        "../outside-secret.md",
        "success",
        null,
        "disabled",
        baseTime + 4000,
        baseTime + 555,
      );
      insertMemory.run(
        symlinkEscapeId,
        "https://example.com/symlink-escape",
        "Symlink Escape",
        null,
        `memories/${symlinkEscapeId}/CONTENT.md`,
        "success",
        null,
        "disabled",
        baseTime + 4500,
        baseTime + 575,
      );
      insertMemory.run(
        linkOnlyId,
        "https://example.com/link-only",
        "Link Only",
        null,
        `memories/${linkOnlyId}/CONTENT.md`,
        "link_only",
        null,
        "disabled",
        baseTime + 5000,
        baseTime + 666,
      );

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: englishId,
        frontmatter: {
          id: englishId,
          url: "https://example.com/english",
          title: "Frontmatter Words Excluded",
          capturedAt: new Date(baseTime).toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Essay\n\nOne two three **four** five.",
      });

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: japaneseId,
        frontmatter: {
          id: japaneseId,
          url: "https://example.com/japanese",
          title: "日本語タイトル除外",
          capturedAt: new Date(baseTime + 1000).toISOString(),
          extractionStatus: "success",
        },
        markdown: "日本語の文章です",
      });

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: alreadyCountedId,
        frontmatter: {
          id: alreadyCountedId,
          url: "https://example.com/already",
          title: "Already Counted",
          capturedAt: new Date(baseTime + 2000).toISOString(),
          extractionStatus: "success",
        },
        markdown: "Only two",
      });

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: zeroCountedId,
        frontmatter: {
          id: zeroCountedId,
          url: "https://example.com/zero",
          title: "Zero Counted",
          capturedAt: new Date(baseTime + 2500).toISOString(),
          extractionStatus: "success",
        },
        markdown: "Should remain zero",
      });

      await writeMemoryContent({
        config: { storePath: config.storePath },
        memoryId: linkOnlyId,
        frontmatter: {
          id: linkOnlyId,
          url: "https://example.com/link-only",
          title: "Link Only",
          capturedAt: new Date(baseTime + 5000).toISOString(),
          extractionStatus: "link_only",
        },
        markdown: "[https://example.com/link-only](<https://example.com/link-only>)",
      });

      // Create an outside file targeted by both the lexical escape and symlink escape.
      const outsideFile = join(config.projectPath, "outside-secret.md");
      mkdirSync(config.projectPath, { recursive: true });
      writeFileSync(outsideFile, "secret outside content", "utf8");

      const symlinkDir = join(config.storePath, "memories", symlinkEscapeId);
      mkdirSync(symlinkDir, { recursive: true });
      symlinkSync(outsideFile, join(symlinkDir, "CONTENT.md"));

      const firstPass = await backfillMemoryWordCounts({
        db: connection.db,
        storePath: config.storePath,
      });

      expect(firstPass.totalMissing).toBe(5);
      expect(firstPass.filled).toBe(2);
      expect(firstPass.skippedMissingFiles).toBe(1);
      expect(firstPass.errors).toHaveLength(2);
      expect(firstPass.errors.map((entry) => entry.memoryId)).toEqual([
        lexicalEscapeId,
        symlinkEscapeId,
      ]);
      for (const entry of firstPass.errors) {
        expect(entry.error).toContain("escapes storePath");
      }

      const rows = connection.sqlite
        .query<
          { id: string; wordCount: number | null; updatedAt: number; title: string },
          []
        >(
          "SELECT id, word_count AS wordCount, updated_at AS updatedAt, title FROM memories",
        )
        .all();
      const byId = new Map(rows.map((row) => [row.id, row]));

      // Essay + One two three four five. = 6 words; updated_at untouched.
      expect(byId.get(englishId)).toEqual({
        id: englishId,
        wordCount: 6,
        updatedAt: baseTime + 111,
        title: "English Memory",
      });
      // 日本語の文章です = 8 CJK characters; updated_at untouched.
      expect(byId.get(japaneseId)).toEqual({
        id: japaneseId,
        wordCount: 8,
        updatedAt: baseTime + 222,
        title: "Japanese Memory",
      });
      // Pre-populated rows keep their exact values.
      expect(byId.get(alreadyCountedId)?.wordCount).toBe(777);
      expect(byId.get(zeroCountedId)?.wordCount).toBe(0);
      // Missing, escaping, and link_only rows remain NULL.
      expect(byId.get(missingFileId)?.wordCount).toBeNull();
      expect(byId.get(lexicalEscapeId)?.wordCount).toBeNull();
      expect(byId.get(symlinkEscapeId)?.wordCount).toBeNull();
      expect(byId.get(linkOnlyId)?.wordCount).toBeNull();

      // Second pass is idempotent: fills 0 rows.
      const secondPass = await backfillMemoryWordCounts({
        db: connection.db,
        storePath: config.storePath,
      });
      expect(secondPass.totalMissing).toBe(3);
      expect(secondPass.filled).toBe(0);
      expect(secondPass.skippedMissingFiles).toBe(1);
      expect(secondPass.errors).toHaveLength(2);
    } finally {
      connection.close();
    }
  });
});
