import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  markdownToSearchText,
  resolveSqliteClient,
  type FtsDatabaseTarget,
} from "../search";

export interface BackfillMemoryWordCountsInput {
  db: FtsDatabaseTarget;
  storePath: string;
}

export interface BackfillMemoryWordCountsResult {
  totalMissing: number;
  filled: number;
  skippedMissingFiles: number;
  errors: Array<{ memoryId: string; error: string }>;
}

interface MissingWordCountRow {
  id: string;
  contentPath: string;
}

/**
 * Counts words in plain text using the same rule as Defuddle 0.19.13's
 * `countWords` (`node_modules/defuddle/dist/utils.js`):
 * every character in the BMP ranges Hiragana, Katakana, CJK Extension A,
 * CJK Unified Ideographs, CJK Compatibility Ideographs, and Korean Hangul
 * counts as one word, and remaining non-whitespace runs each count as one word.
 */
export function countWordsInText(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let cjkCount = 0;
  let wordCount = 0;
  let inWord = false;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isDefuddleCjkCharCode(code)) {
      cjkCount += 1;
      inWord = false;
    } else if (code <= 32) {
      inWord = false;
    } else if (!inWord) {
      wordCount += 1;
      inWord = true;
    }
  }

  return cjkCount + wordCount;
}

/**
 * Reduces raw `CONTENT.md` (stripping leading YAML frontmatter) or Markdown
 * text to plain text via `markdownToSearchText`, then counts words with the
 * Defuddle-compatible CJK + whitespace rule.
 */
export function countMarkdownWords(markdown: string): number {
  const plainText = markdownToSearchText(markdown);
  return countWordsInText(plainText);
}

/**
 * Backfills `memories.word_count` in a single pass for every row where
 * `word_count IS NULL` and `extraction_status = 'success'`, computing each
 * count from the stored `CONTENT.md` file under `storePath`.
 *
 * Updates only `word_count` (preserving `updated_at` and all other columns),
 * skips missing files, isolates per-row errors (including paths that escape
 * `storePath`), and is idempotent across repeated runs.
 */
export async function backfillMemoryWordCounts(
  input: BackfillMemoryWordCountsInput,
): Promise<BackfillMemoryWordCountsResult> {
  const sqlite = resolveSqliteClient(input.db);
  const storeRoot = resolve(input.storePath);

  const missingRows = sqlite
    .query<MissingWordCountRow, []>(
      `SELECT
        m.id AS id,
        m.content_path AS contentPath
      FROM memories m
      WHERE m.word_count IS NULL
        AND m.extraction_status = 'success'
      ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all();

  const updateWordCount = sqlite.prepare(
    "UPDATE memories SET word_count = ? WHERE id = ? AND word_count IS NULL",
  );

  let realStoreRoot: string | null = null;
  let filled = 0;
  let skippedMissingFiles = 0;
  const errors: Array<{ memoryId: string; error: string }> = [];

  for (const row of missingRows) {
    try {
      const contentFilePath = resolveSafeContentPath(storeRoot, row.contentPath);
      const realContentPath = await realpath(contentFilePath);
      if (realStoreRoot === null) {
        realStoreRoot = await realpath(storeRoot);
      }
      assertWithinRoot(realStoreRoot, realContentPath, row.contentPath);

      const rawContent = await readFile(realContentPath, "utf8");
      const wordCount = countMarkdownWords(rawContent);
      const outcome = updateWordCount.run(wordCount, row.id);
      if (outcome.changes > 0) {
        filled += 1;
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        skippedMissingFiles += 1;
        continue;
      }
      errors.push({
        memoryId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    totalMissing: missingRows.length,
    filled,
    skippedMissingFiles,
    errors,
  };
}

function isDefuddleCjkCharCode(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0xac00 && code <= 0xd7af) // Korean Hangul
  );
}

function resolveSafeContentPath(storeRoot: string, contentPath: string): string {
  const resolved = resolve(storeRoot, contentPath);
  assertWithinRoot(storeRoot, resolved, contentPath);
  return resolved;
}

function assertWithinRoot(
  rootPath: string,
  candidatePath: string,
  originalContentPath: string,
): void {
  const prefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  if (!candidatePath.startsWith(prefix)) {
    throw new Error(`Memory content path escapes storePath: ${originalContentPath}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
