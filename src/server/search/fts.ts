import type { Database as BunDatabase } from "bun:sqlite";

import type { TraumaDatabase } from "../db/repositories";

export type FtsDatabaseTarget = BunDatabase | TraumaDatabase;

export interface MemorySearchDocument {
  memoryId: string;
  title: string;
  url: string;
  description?: string | null;
  bodyText: string;
}

export interface SearchMemoryFtsOptions {
  limit?: number;
  offset?: number;
}

export interface MemoryFtsMatch {
  memoryId: string;
  rank: number;
  snippet: string;
}

interface FtsSearchRow {
  memoryId: string;
  rank: number;
  bodySnippet: string | null;
  titleSnippet: string | null;
  descSnippet: string | null;
  title: string;
  description: string;
  bodyText: string;
}

interface LikeFallbackRow {
  memoryId: string;
  title: string;
  url: string;
  description: string;
  bodyText: string;
}

const DEFAULT_SEARCH_LIMIT = 30;
const CJK_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const SNIPPET_CONTEXT_RADIUS = 48;

export function resolveSqliteClient(target: FtsDatabaseTarget): BunDatabase {
  if (isBunDatabase(target)) {
    return target;
  }

  const client = (
    target as {
      $client?: BunDatabase;
      session?: { client?: BunDatabase };
    }
  ).$client ?? (target as { session?: { client?: BunDatabase } }).session?.client;

  if (client !== undefined && isBunDatabase(client)) {
    return client;
  }

  throw new Error("Unable to resolve underlying bun:sqlite Database client for FTS5.");
}

export function containsCjkCharacters(value: string): boolean {
  return CJK_SCRIPT_PATTERN.test(value);
}

/**
 * Converts arbitrary user input into a safe FTS5 MATCH expression.
 * Every alphanumeric/Unicode token is double-quoted so FTS5 operators,
 * column filters, quotes, and punctuation can never cause a syntax error.
 */
export function sanitizeFtsQuery(rawQuery: string): string {
  const normalized = rawQuery.normalize("NFC").trim();
  if (normalized.length === 0) {
    return "";
  }

  const tokens = normalized.match(SEARCH_TOKEN_PATTERN);
  if (tokens === null || tokens.length === 0) {
    return "";
  }

  return tokens
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ");
}

export function upsertMemorySearchDocument(
  target: FtsDatabaseTarget,
  doc: MemorySearchDocument,
): void {
  const sqlite = resolveSqliteClient(target);
  const title = doc.title ?? "";
  const url = doc.url ?? "";
  const description = doc.description ?? "";
  const bodyText = doc.bodyText ?? "";

  runInSavepoint(sqlite, "memory_search_fts_upsert", () => {
    sqlite
      .prepare("DELETE FROM memory_search_fts WHERE memory_id = ?")
      .run(doc.memoryId);
    sqlite
      .prepare(
        "INSERT INTO memory_search_fts (memory_id, title, url, description, body_text) VALUES (?, ?, ?, ?, ?)",
      )
      .run(doc.memoryId, title, url, description, bodyText);
  });
}

export function deleteMemorySearchDocument(
  target: FtsDatabaseTarget,
  memoryId: string,
): void {
  const sqlite = resolveSqliteClient(target);
  sqlite
    .prepare("DELETE FROM memory_search_fts WHERE memory_id = ?")
    .run(memoryId);
}

export function searchMemoryFts(
  target: FtsDatabaseTarget,
  rawQuery: string,
  options: SearchMemoryFtsOptions = {},
): MemoryFtsMatch[] {
  const trimmed = rawQuery.trim();
  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_SEARCH_LIMIT));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  if (trimmed.length === 0 || limit === 0) {
    return [];
  }

  const sqlite = resolveSqliteClient(target);
  const fetchLimit = limit + offset;
  const sanitized = sanitizeFtsQuery(trimmed);
  const results: MemoryFtsMatch[] = [];
  const seenIds = new Set<string>();

  if (sanitized.length > 0) {
    const rows = sqlite
      .query<FtsSearchRow, [string, number]>(
        `SELECT
          memory_id AS memoryId,
          bm25(memory_search_fts, 0.0, 10.0, 4.0, 5.0, 1.0) AS rank,
          snippet(memory_search_fts, 4, '<mark>', '</mark>', '...', 24) AS bodySnippet,
          snippet(memory_search_fts, 1, '<mark>', '</mark>', '...', 24) AS titleSnippet,
          snippet(memory_search_fts, 3, '<mark>', '</mark>', '...', 24) AS descSnippet,
          title,
          description,
          body_text AS bodyText
        FROM memory_search_fts
        WHERE memory_search_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?`,
      )
      .all(sanitized, fetchLimit);

    for (const row of rows) {
      if (seenIds.has(row.memoryId)) {
        continue;
      }
      seenIds.add(row.memoryId);
      results.push({
        memoryId: row.memoryId,
        rank: row.rank,
        snippet: selectBestFtsSnippet(row),
      });
    }
  }

  // unicode61 tokenizes contiguous CJK runs as a single token, so CJK substring
  // queries (e.g. searching for a word inside a Japanese sentence) require a
  // LIKE fallback against memory_search_fts.
  if (containsCjkCharacters(trimmed) && results.length < fetchLimit) {
    const fallbackMatches = searchMemoryFtsLikeFallback(
      sqlite,
      trimmed,
      fetchLimit,
      seenIds,
    );
    for (const match of fallbackMatches) {
      seenIds.add(match.memoryId);
      results.push(match);
      if (results.length >= fetchLimit) {
        break;
      }
    }
  }

  return results.slice(offset, offset + limit);
}

/**
 * Checks which memory IDs (optionally restricted to `candidateMemoryIds`) match
 * a single free-text search term in `memory_search_fts` via FTS5 MATCH or CJK LIKE.
 */
export function findMemoryIdsMatchingSearchTerm(
  target: FtsDatabaseTarget,
  rawTerm: string,
  candidateMemoryIds?: readonly string[],
): Set<string> {
  const trimmed = rawTerm.trim();
  const matched = new Set<string>();
  if (trimmed.length === 0) {
    return matched;
  }
  if (candidateMemoryIds !== undefined && candidateMemoryIds.length === 0) {
    return matched;
  }

  const sqlite = resolveSqliteClient(target);
  const candidateClause =
    candidateMemoryIds !== undefined
      ? ` AND memory_id IN (${candidateMemoryIds.map(() => "?").join(", ")})`
      : "";
  const candidateParams = candidateMemoryIds !== undefined ? [...candidateMemoryIds] : [];

  const sanitized = sanitizeFtsQuery(trimmed);
  if (sanitized.length > 0) {
    const rows = sqlite
      .query<{ memoryId: string }, string[]>(
        `SELECT memory_id AS memoryId
        FROM memory_search_fts
        WHERE memory_search_fts MATCH ?${candidateClause}`,
      )
      .all(sanitized, ...candidateParams);
    for (const row of rows) {
      matched.add(row.memoryId);
    }
  }

  if (containsCjkCharacters(trimmed)) {
    const likePattern = `%${escapeSqlLike(trimmed.toLowerCase())}%`;
    const rows = sqlite
      .query<{ memoryId: string }, string[]>(
        `SELECT memory_id AS memoryId
        FROM memory_search_fts
        WHERE (
          lower(title) LIKE ? ESCAPE '\\'
          OR lower(url) LIKE ? ESCAPE '\\'
          OR lower(description) LIKE ? ESCAPE '\\'
          OR lower(body_text) LIKE ? ESCAPE '\\'
        )${candidateClause}`,
      )
      .all(likePattern, likePattern, likePattern, likePattern, ...candidateParams);
    for (const row of rows) {
      matched.add(row.memoryId);
    }
  }

  return matched;
}

function searchMemoryFtsLikeFallback(
  sqlite: BunDatabase,
  rawQuery: string,
  fetchLimit: number,
  excludeIds: ReadonlySet<string>,
): MemoryFtsMatch[] {
  const terms = rawQuery
    .normalize("NFC")
    .split(/[\s\u3000]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    return [];
  }

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  for (const term of terms) {
    const pattern = `%${escapeSqlLike(term.toLowerCase())}%`;
    clauses.push(
      `(lower(title) LIKE ? ESCAPE '\\' OR lower(url) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\' OR lower(body_text) LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = sqlite
    .query<LikeFallbackRow, (string | number)[]>(
      `SELECT
        memory_id AS memoryId,
        title,
        url,
        description,
        body_text AS bodyText
      FROM memory_search_fts
      WHERE ${clauses.join(" AND ")}
      LIMIT ?`,
    )
    .all(...params, fetchLimit + excludeIds.size);

  const matches: MemoryFtsMatch[] = [];
  for (const row of rows) {
    if (excludeIds.has(row.memoryId)) {
      continue;
    }
    matches.push({
      memoryId: row.memoryId,
      rank: 0,
      snippet: buildLikeSnippet(row, terms),
    });
    if (matches.length >= fetchLimit) {
      break;
    }
  }

  return matches;
}

function selectBestFtsSnippet(row: FtsSearchRow): string {
  if (row.bodySnippet !== null && row.bodySnippet.includes("<mark>")) {
    return row.bodySnippet;
  }
  if (row.descSnippet !== null && row.descSnippet.includes("<mark>")) {
    return row.descSnippet;
  }
  if (row.titleSnippet !== null && row.titleSnippet.includes("<mark>")) {
    return row.titleSnippet;
  }
  const fallbackSource = row.bodyText || row.description || row.title;
  return truncatePlainSnippet(fallbackSource, SNIPPET_CONTEXT_RADIUS * 2);
}

function buildLikeSnippet(row: LikeFallbackRow, terms: readonly string[]): string {
  const fields = [row.bodyText, row.description, row.title, row.url];
  for (const field of fields) {
    if (field.length === 0) {
      continue;
    }
    const lowerField = field.toLowerCase();
    let bestIndex = -1;
    let bestTerm = "";
    for (const term of terms) {
      const index = lowerField.indexOf(term.toLowerCase());
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        bestTerm = term;
      }
    }
    if (bestIndex !== -1) {
      const start = Math.max(0, bestIndex - SNIPPET_CONTEXT_RADIUS);
      const end = Math.min(
        field.length,
        bestIndex + bestTerm.length + SNIPPET_CONTEXT_RADIUS,
      );
      const prefix = start > 0 ? "..." : "";
      const suffix = end < field.length ? "..." : "";
      const before = field.slice(start, bestIndex);
      const matched = field.slice(bestIndex, bestIndex + bestTerm.length);
      const after = field.slice(bestIndex + bestTerm.length, end);
      return `${prefix}${before}<mark>${matched}</mark>${after}${suffix}`;
    }
  }

  return truncatePlainSnippet(row.bodyText || row.description || row.title, SNIPPET_CONTEXT_RADIUS * 2);
}

function truncatePlainSnippet(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function runInSavepoint(
  sqlite: BunDatabase,
  savepointName: string,
  operation: () => void,
): void {
  sqlite.run(`SAVEPOINT ${savepointName}`);
  try {
    operation();
    sqlite.run(`RELEASE SAVEPOINT ${savepointName}`);
  } catch (error) {
    try {
      sqlite.run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      sqlite.run(`RELEASE SAVEPOINT ${savepointName}`);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function isBunDatabase(value: unknown): value is BunDatabase {
  return (
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    typeof (value as { prepare?: unknown }).prepare === "function" &&
    "query" in value &&
    typeof (value as { query?: unknown }).query === "function"
  );
}
