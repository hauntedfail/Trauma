import { Buffer } from "node:buffer";

import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue } from "~/server/backup";
import { BackupEnvironmentFailsafeError } from "~/server/backup/environment";
import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import type {
  MemoryBrowsePageRow,
  ReaderMemoryAggregateRow,
} from "~/server/db/repositories";
import { authenticateApiRequest } from "~/server/http/api-auth";
import { readJsonMutationRequest } from "~/server/http/mutation-request";
import { ImportAdmissionError, validateImportUrl } from "~/server/importer";
import {
  createRuntimeMemoryImporter,
  type RuntimeMemoryImporter,
} from "~/server/importer/runtime";
import {
  AddMemoryIdempotencyConflictError,
  AddMemoryIdempotencyReplayError,
  addMemory,
} from "~/server/memories/add-memory";
import { isMemoryId } from "~/server/memories/id";
import {
  backfillMemorySearchIndex,
  searchMemoryFts,
  type MemoryFtsMatch,
} from "~/server/search";

const DEFAULT_API_MEMORIES_LIMIT = 20;
const MAX_API_MEMORIES_LIMIT = 100;

interface MemoryPostHandlerOptions {
  createImporter?: () => RuntimeMemoryImporter;
}

export async function GET(event: APIEvent): Promise<Response> {
  const auth = authenticateApiRequest(event.request);
  if (!auth.ok) {
    return json({ error: auth.error }, { status: auth.status });
  }

  const parsedQuery = parseListMemoriesQuery(event.request);
  if (!parsedQuery.ok) {
    return json({ error: parsedQuery.error }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    let tagId = "";
    if (parsedQuery.tag.length > 0) {
      const allTags = await connection.repositories.taxonomy.listTagsForBrowse();
      const matchedTag = allTags.find(
        (entry) =>
          entry.id === parsedQuery.tag ||
          entry.name.toLowerCase() === parsedQuery.tag.toLowerCase(),
      );
      if (matchedTag === undefined) {
        return json({ items: [], nextCursor: null, hasMore: false }, { status: 200 });
      }
      tagId = matchedTag.id;
    }

    let categoryId = "";
    if (parsedQuery.category.length > 0) {
      const allCategories =
        await connection.repositories.taxonomy.listCategoriesForBrowse();
      const matchedCategory = allCategories.find(
        (entry) =>
          entry.id === parsedQuery.category ||
          entry.name.toLowerCase() === parsedQuery.category.toLowerCase(),
      );
      if (matchedCategory === undefined) {
        return json({ items: [], nextCursor: null, hasMore: false }, { status: 200 });
      }
      categoryId = matchedCategory.id;
    }

    if (parsedQuery.q.length > 0) {
      await backfillMemorySearchIndex({
        db: connection.sqlite,
        storePath: config.storePath,
      });
      const searchResult = await listMemoriesByFts({
        connection,
        q: parsedQuery.q,
        tagId,
        categoryId,
        readState: parsedQuery.readState,
        limit: parsedQuery.limit,
        offset: parsedQuery.searchCursor?.offset ?? 0,
      });
      return json(searchResult, { status: 200 });
    }

    const page = await connection.repositories.memories.listForBrowsePage({
      categoryId,
      tagId,
      flashbackId: "",
      readState: parsedQuery.readState,
      searchFields: [],
      searchTerms: [],
      cursor: parsedQuery.browseCursor,
      limit: parsedQuery.limit,
    });

    const hasMore = page.nextCursor !== null;
    const nextCursor =
      page.nextCursor !== null
        ? encodeMemoriesCursor({
            v: 1,
            mode: "browse",
            createdAt: page.nextCursor.createdAt.toISOString(),
            id: page.nextCursor.id,
          })
        : null;

    return json(
      {
        items: page.rows.map(toApiBrowseMemoryItem),
        nextCursor,
        hasMore,
      },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

export function createMemoryPostHandler(
  options: MemoryPostHandlerOptions = {},
) {
  return async function postMemory(event: APIEvent): Promise<Response> {
    return handleMemoryPost(event, options);
  };
}

export async function POST(event: APIEvent): Promise<Response> {
  return handleMemoryPost(event);
}

async function handleMemoryPost(
  event: APIEvent,
  options: MemoryPostHandlerOptions = {},
): Promise<Response> {
  const auth = authenticateApiRequest(event.request);
  if (!auth.ok) {
    return json({ error: auth.error }, { status: auth.status });
  }
  const idempotencyKey = readAddMemoryIdempotencyKey(event.request);
  if (!idempotencyKey.ok) {
    return json({ error: idempotencyKey.error }, { status: 400 });
  }
  const importer = options.createImporter?.() ?? createRuntimeMemoryImporter();
  const payload = await parseAddMemoryPayloadInternal(event.request, {
    validateUrl: importer.validateUrl,
  });
  if (!payload.ok) {
    return json({ error: payload.error }, { status: payload.status ?? 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const memory = await addMemory({
      url: payload.url,
      config,
      db: connection.db,
      backupQueue: getMemoryBackupQueue(config),
      importer,
      ...(idempotencyKey.value === undefined
        ? {}
        : { idempotencyKey: idempotencyKey.value }),
    });

    return json({ memory }, { status: 201 });
  } catch (error) {
    if (
      error instanceof AddMemoryIdempotencyConflictError ||
      error instanceof AddMemoryIdempotencyReplayError
    ) {
      return json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BackupEnvironmentFailsafeError) {
      return json(
        {
          error: error.message,
          backupFailsafe: error.alert ?? null,
        },
        { status: 409 },
      );
    }
    if (error instanceof ImportAdmissionError) {
      return json(
        { code: error.code, error: error.message },
        {
          status: 429,
          headers: { "retry-after": String(error.retryAfterSeconds) },
        },
      );
    }

    throw error;
  } finally {
    connection.close();
  }
}

type AddMemoryPayloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status?: number };

interface ParseAddMemoryPayloadOptions {
  validateUrl?: (url: string) => Promise<string>;
  validationTimeoutMs?: number;
}

const DEFAULT_ROUTE_URL_VALIDATION_TIMEOUT_MS = 10_000;

function readAddMemoryIdempotencyKey(
  request: Request,
):
  | { ok: true; value: string | undefined }
  | { ok: false; error: string } {
  const value = request.headers.get("idempotency-key");
  if (value === null) {
    return { ok: true, value: undefined };
  }
  if (!isMemoryId(value)) {
    return { ok: false, error: "Idempotency-Key must be a UUID v7" };
  }
  return { ok: true, value };
}

export const parseAddMemoryPayload = parseAddMemoryPayloadInternal;

async function parseAddMemoryPayloadInternal(
  request: Request,
  options: ParseAddMemoryPayloadOptions = {},
): Promise<AddMemoryPayloadResult> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "url") {
    return { ok: false, error: "request body must contain only url" };
  }

  if (typeof payload.url !== "string") {
    return { ok: false, error: "url must be a non-empty string" };
  }

  const url = payload.url.trim();
  if (url === "") {
    return { ok: false, error: "url must be a non-empty string" };
  }

  try {
    return {
      ok: true,
      url: await validateUrlWithinTimeout(url, {
        validateUrl: options.validateUrl ?? validateImportUrl,
        timeoutMs:
          options.validationTimeoutMs ??
          DEFAULT_ROUTE_URL_VALIDATION_TIMEOUT_MS,
      }),
    };
  } catch (error) {
    if (isUrlValidationTimeout(error)) {
      return { ok: false, error: "url validation timed out" };
    }

    return { ok: false, error: "url must be a valid absolute URL" };
  }
}

async function validateUrlWithinTimeout(
  url: string,
  input: { validateUrl: (url: string) => Promise<string>; timeoutMs: number },
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.validateUrl(url),
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new UrlValidationTimeoutError());
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function json(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}

class UrlValidationTimeoutError extends Error {}

function isUrlValidationTimeout(error: unknown) {
  return error instanceof UrlValidationTimeoutError;
}

type BrowseMemoriesCursorPayload = {
  v: 1;
  mode: "browse";
  createdAt: string;
  id: string;
};

type SearchMemoriesCursorPayload = {
  v: 1;
  mode: "search";
  offset: number;
};

type MemoriesCursorPayload =
  | BrowseMemoriesCursorPayload
  | SearchMemoriesCursorPayload;

type ParsedListMemoriesQuery =
  | {
      ok: true;
      q: string;
      tag: string;
      category: string;
      readState: "all" | "read" | "unread";
      limit: number;
      browseCursor: { createdAt: Date; id: string } | null;
      searchCursor: { offset: number } | null;
    }
  | { ok: false; error: string };

interface ApiMemoryListItem {
  id: string;
  url: string;
  title: string;
  description: string;
  capturedAt: string;
  read: boolean;
  extractionStatus: MemoryBrowsePageRow["extractionStatus"];
  tags: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  snippet?: string;
  rank?: number;
}

function parseListMemoriesQuery(request: Request): ParsedListMemoriesQuery {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const tag = params.get("tag")?.trim() ?? "";
  const category = params.get("category")?.trim() ?? "";

  const rawRead = params.get("read")?.trim().toLowerCase() ?? "";
  let readState: "all" | "read" | "unread";
  if (rawRead === "" || rawRead === "all") {
    readState = "all";
  } else if (rawRead === "read" || rawRead === "true") {
    readState = "read";
  } else if (rawRead === "unread" || rawRead === "false") {
    readState = "unread";
  } else {
    return {
      ok: false,
      error: "read must be one of all, read, unread, true, false",
    };
  }

  const rawLimit = params.get("limit")?.trim() ?? "";
  let limit = DEFAULT_API_MEMORIES_LIMIT;
  if (rawLimit !== "") {
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      return { ok: false, error: "limit must be a positive integer" };
    }
    const parsedLimit = Number(rawLimit);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
      return { ok: false, error: "limit must be a positive integer" };
    }
    limit = Math.min(parsedLimit, MAX_API_MEMORIES_LIMIT);
  }

  const rawCursor = params.get("cursor")?.trim() ?? "";
  if (rawCursor === "") {
    return {
      ok: true,
      q,
      tag,
      category,
      readState,
      limit,
      browseCursor: null,
      searchCursor: null,
    };
  }

  const decoded = decodeMemoriesCursor(rawCursor);
  if (decoded === null) {
    return { ok: false, error: "invalid cursor" };
  }

  if (q.length > 0) {
    if (decoded.mode !== "search") {
      return { ok: false, error: "invalid cursor" };
    }
    return {
      ok: true,
      q,
      tag,
      category,
      readState,
      limit,
      browseCursor: null,
      searchCursor: { offset: decoded.offset },
    };
  }

  if (decoded.mode !== "browse") {
    return { ok: false, error: "invalid cursor" };
  }

  const createdAt = new Date(decoded.createdAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== decoded.createdAt
  ) {
    return { ok: false, error: "invalid cursor" };
  }

  return {
    ok: true,
    q,
    tag,
    category,
    readState,
    limit,
    browseCursor: { createdAt, id: decoded.id },
    searchCursor: null,
  };
}

function encodeMemoriesCursor(payload: MemoriesCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeMemoriesCursor(token: string): MemoriesCursorPayload | null {
  if (token.length === 0 || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.v !== 1) {
    return null;
  }

  if (parsed.mode === "browse") {
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.trim() === ""
    ) {
      return null;
    }
    return {
      v: 1,
      mode: "browse",
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  }

  if (parsed.mode === "search") {
    if (
      typeof parsed.offset !== "number" ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      return null;
    }
    return {
      v: 1,
      mode: "search",
      offset: parsed.offset,
    };
  }

  return null;
}

async function listMemoriesByFts(input: {
  connection: ReturnType<typeof initializeDatabase>;
  q: string;
  tagId: string;
  categoryId: string;
  readState: "all" | "read" | "unread";
  limit: number;
  offset: number;
}): Promise<{
  items: ApiMemoryListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const accepted: Array<{ item: ApiMemoryListItem; nextOffset: number }> = [];
  const batchSize = Math.max(input.limit + 1, 25);
  let scanOffset = input.offset;

  while (accepted.length < input.limit + 1) {
    const ftsMatches = searchMemoryFts(input.connection.sqlite, input.q, {
      limit: batchSize,
      offset: scanOffset,
    });
    if (ftsMatches.length === 0) {
      break;
    }

    for (let index = 0; index < ftsMatches.length; index += 1) {
      const match = ftsMatches[index];
      if (match === undefined) {
        continue;
      }
      const row =
        await input.connection.repositories.memories.findReaderAggregateById(
          match.memoryId,
        );
      if (row === undefined) {
        continue;
      }
      if (input.readState === "read" && !row.read) {
        continue;
      }
      if (input.readState === "unread" && row.read) {
        continue;
      }
      if (
        input.tagId.length > 0 &&
        !row.memoryTags.some((entry) => entry.tag.id === input.tagId)
      ) {
        continue;
      }
      if (
        input.categoryId.length > 0 &&
        !row.memoryCategories.some(
          (entry) => entry.category.id === input.categoryId,
        )
      ) {
        continue;
      }

      accepted.push({
        item: toApiSearchMemoryItem(row, match),
        nextOffset: scanOffset + index + 1,
      });
      if (accepted.length >= input.limit + 1) {
        break;
      }
    }

    scanOffset += ftsMatches.length;
    if (ftsMatches.length < batchSize) {
      break;
    }
  }

  const hasMore = accepted.length > input.limit;
  const pageEntries = accepted.slice(0, input.limit);
  const lastEntry = pageEntries[pageEntries.length - 1];
  const nextCursor =
    hasMore && lastEntry !== undefined
      ? encodeMemoriesCursor({
          v: 1,
          mode: "search",
          offset: lastEntry.nextOffset,
        })
      : null;

  return {
    items: pageEntries.map((entry) => entry.item),
    nextCursor,
    hasMore,
  };
}

function toApiBrowseMemoryItem(row: MemoryBrowsePageRow): ApiMemoryListItem {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    capturedAt: row.capturedAt,
    read: row.read,
    extractionStatus: row.extractionStatus,
    tags: row.tags,
    categories: row.categories,
  };
}

function toApiSearchMemoryItem(
  row: ReaderMemoryAggregateRow,
  match: MemoryFtsMatch,
): ApiMemoryListItem {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description ?? "",
    capturedAt: row.createdAt.toISOString(),
    read: row.read,
    extractionStatus: row.extractionStatus,
    tags: row.memoryTags.map((entry) => ({
      id: entry.tag.id,
      name: entry.tag.name,
    })),
    categories: row.memoryCategories.map((entry) => ({
      id: entry.category.id,
      name: entry.category.name,
    })),
    snippet: match.snippet,
    rank: match.rank,
  };
}
