import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  resolveSqliteClient,
  upsertMemorySearchDocument,
  type FtsDatabaseTarget,
} from "./fts";
import { markdownToSearchText } from "./markdown-text";

export interface BackfillMemorySearchIndexInput {
  db: FtsDatabaseTarget;
  storePath: string;
}

export interface BackfillMemorySearchIndexResult {
  totalMissing: number;
  indexed: number;
  skippedMissingFiles: number;
  errors: Array<{ memoryId: string; error: string }>;
}

interface MissingMemoryRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  contentPath: string;
}

/**
 * Indexes all memories present in `memories` that do not yet have a row in
 * `memory_search_fts` by reading their `CONTENT.md` files from `storePath`.
 * Missing files are safely skipped without aborting the backfill.
 */
export async function backfillMemorySearchIndex(
  input: BackfillMemorySearchIndexInput,
): Promise<BackfillMemorySearchIndexResult> {
  const sqlite = resolveSqliteClient(input.db);
  const storeRoot = resolve(input.storePath);

  const missingRows = sqlite
    .query<MissingMemoryRow, []>(
      `SELECT
        m.id AS id,
        m.title AS title,
        m.url AS url,
        m.description AS description,
        m.content_path AS contentPath
      FROM memories m
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_search_fts f WHERE f.memory_id = m.id
      )
      ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all();

  let indexed = 0;
  let skippedMissingFiles = 0;
  const errors: Array<{ memoryId: string; error: string }> = [];

  for (const row of missingRows) {
    try {
      const contentFilePath = resolveSafeContentPath(storeRoot, row.contentPath);
      const rawContent = await readFile(contentFilePath, "utf8");
      const bodyText = markdownToSearchText(rawContent);

      upsertMemorySearchDocument(sqlite, {
        memoryId: row.id,
        title: row.title,
        url: row.url,
        description: row.description,
        bodyText,
      });
      indexed += 1;
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
    indexed,
    skippedMissingFiles,
    errors,
  };
}

function resolveSafeContentPath(storeRoot: string, contentPath: string): string {
  const resolved = resolve(storeRoot, contentPath);
  const prefix = storeRoot.endsWith(sep) ? storeRoot : `${storeRoot}${sep}`;
  if (resolved !== storeRoot && !resolved.startsWith(prefix)) {
    throw new Error(`Memory content path escapes storePath: ${contentPath}`);
  }
  return resolved;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
