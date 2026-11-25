import { loadRuntimeTraumaConfig } from "../config";
import type { ResolvedTraumaConfig } from "../config";
import { getMemoryBackupQueue } from "../backup";
import { initializeDatabase } from "../db";
import type {
  FlashbackBrowseRow,
  ListMemoryBrowsePageInput,
  MemoryBrowsePageResult,
  MemoryBrowsePageRow,
} from "../db/repositories";
import { filterRenderableFlashbackRows } from "../flashbacks/browse";
import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import {
  filterBrowseMemories,
  parseBrowseSearch,
  type BrowseFlashback,
  type BrowseMemory,
  type BrowseMemoryCursor,
  type BrowseMemoryPage,
  type BrowseMemoryPageRequest,
  type BrowseQuery,
} from "../../components/memories/browse-data";
import { normalizeBrowseLimit } from "../browse/limits";
import { collectFilteredCursorPage } from "../browse/filtered-page";
import { findMemoryIdsMatchingSearchTerm } from "../search";

const MAX_RENDERABLE_FLASHBACK_FILTER_FETCH_ROUNDS = 20;

export interface LoadBrowseMemoriesOptions {
  startBackupQueue?: (config: ResolvedTraumaConfig) => void;
}

export async function loadBrowseMemoryPage(
  request: BrowseMemoryPageRequest,
  options: LoadBrowseMemoriesOptions = {},
): Promise<BrowseMemoryPage> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return loadBrowseFixtureMemoryPage(request);
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    (options.startBackupQueue ?? startBackupQueue)(config);
    connection = initializeDatabase(config);
    const repositoryInput = toMemoryBrowsePageRepositoryInput(request);
    const page = shouldApplyRenderableFlashbackBrowseFilters(request.query)
      ? await listBrowseMemoryPageWithRenderableFlashbackFilters({
          config,
          query: request.query,
          repositories: connection.repositories,
          repositoryInput,
          sqlite: connection.sqlite,
        })
      : await connection.repositories.memories.listForBrowsePage(
          repositoryInput,
        );

    return {
      memories: page.rows.map(toBrowseMemoryWithoutFlashbacks),
      nextCursor:
        page.nextCursor === null
          ? null
          : {
              createdAt: page.nextCursor.createdAt.toISOString(),
              id: page.nextCursor.id,
              ...(page.nextCursor.lastOpenedAt !== undefined
                ? {
                    lastOpenedAt:
                      page.nextCursor.lastOpenedAt === null
                        ? null
                        : page.nextCursor.lastOpenedAt.toISOString(),
                  }
                : {}),
            },
    };
  } finally {
    connection?.close();
  }
}

function loadBrowseFixtureMemoryPage(
  request: BrowseMemoryPageRequest,
): BrowseMemoryPage {
  const filtered = filterBrowseMemories(browseFixtureMemories, request.query);
  const start = findFixtureCursorIndex(filtered, request.cursor);
  const limit = normalizeBrowseLimit(request.limit);
  const pageRows = filtered.slice(start, start + limit);
  const hasNextPage = start + limit < filtered.length;
  const lastPageRow = pageRows[pageRows.length - 1];

  return {
    memories: pageRows.map(withoutFlashbacks),
    nextCursor:
      hasNextPage && lastPageRow !== undefined
        ? { createdAt: lastPageRow.capturedAt, id: lastPageRow.id }
        : null,
  };
}

function findFixtureCursorIndex(
  memories: BrowseMemory[],
  cursor: BrowseMemoryCursor | null,
): number {
  if (cursor === null) {
    return 0;
  }

  const index = memories.findIndex(
    (memory) =>
      memory.id === cursor.id && memory.capturedAt === cursor.createdAt,
  );
  return index === -1 ? memories.length : index + 1;
}

async function listBrowseMemoryPageWithRenderableFlashbackFilters(input: {
  config: ResolvedTraumaConfig;
  query: BrowseQuery;
  repositories: ReturnType<typeof initializeDatabase>["repositories"];
  repositoryInput: ListMemoryBrowsePageInput;
  sqlite: ReturnType<typeof initializeDatabase>["sqlite"];
}): Promise<MemoryBrowsePageResult> {
  const limit = normalizeBrowseLimit(input.repositoryInput.limit);
  return collectFilteredCursorPage({
    cursor: input.repositoryInput.cursor,
    filterRows: (rows: MemoryBrowsePageRow[]) =>
      filterPageRowsByRenderableFlashbacks({
        config: input.config,
        query: input.query,
        repositories: input.repositories,
        rows,
        sqlite: input.sqlite,
      }),
    limit,
    loadPage: ({ cursor, limit: pageLimit }) =>
      input.repositories.memories.listForBrowsePage({
        ...input.repositoryInput,
        cursor,
        limit: pageLimit,
      }),
    maxFetchRounds: MAX_RENDERABLE_FLASHBACK_FILTER_FETCH_ROUNDS,
  });
}

function shouldApplyRenderableFlashbackBrowseFilters(query: BrowseQuery): boolean {
  const search = parseBrowseSearch(query.q);
  return (
    query.flashback.length > 0 ||
    search.freeTerms.length > 0 ||
    search.fields.some((field) => field.field === "flashback")
  );
}

async function filterPageRowsByRenderableFlashbacks(input: {
  config: ResolvedTraumaConfig;
  query: BrowseQuery;
  repositories: ReturnType<typeof initializeDatabase>["repositories"];
  rows: MemoryBrowsePageRow[];
  sqlite: ReturnType<typeof initializeDatabase>["sqlite"];
}): Promise<MemoryBrowsePageRow[]> {
  const memoryIds = input.rows.map((row) => row.id);
  const renderableFlashbacks = await filterRenderableFlashbackRows({
    config: input.config,
    rows: await input.repositories.flashbacks.listForBrowseMemoryIds({
      memoryIds,
    }),
    translationRepository: input.repositories.translations,
  });
  const flashbacksByMemoryId =
    groupBrowseFlashbacksByMemoryId(renderableFlashbacks);
  const search = parseBrowseSearch(input.query.q);
  const ftsMatchesByTerm = search.freeTerms.map((term) =>
    findMemoryIdsMatchingSearchTerm(input.sqlite, term, memoryIds),
  );
  const matchingIds = new Set(
    input.rows
      .map((row) => ({
        ...toBrowseMemoryWithoutFlashbacks(row),
        flashbacks: flashbacksByMemoryId.get(row.id) ?? [],
      }))
      .filter((memory) =>
        memoryMatchesRenderableBrowseSearch(
          memory,
          input.query,
          search,
          ftsMatchesByTerm,
        ),
      )
      .map((memory) => memory.id),
  );

  return input.rows.filter((row) => matchingIds.has(row.id));
}

function memoryMatchesRenderableBrowseSearch(
  memory: BrowseMemory,
  query: BrowseQuery,
  search: ReturnType<typeof parseBrowseSearch>,
  ftsMatchesByTerm: readonly ReadonlySet<string>[],
): boolean {
  if (
    query.flashback.length > 0 &&
    !memory.flashbacks.some((flashback) => flashback.id === query.flashback)
  ) {
    return false;
  }

  for (const field of search.fields) {
    if (field.field !== "flashback" || field.value.length === 0) {
      continue;
    }
    const matched = memory.flashbacks.some((flashback) =>
      [flashback.text, flashback.prefix, flashback.suffix].some((value) =>
        value.trim().toLowerCase().includes(field.value),
      ),
    );
    if (!matched) {
      return false;
    }
  }

  if (search.freeTerms.length > 0) {
    const searchableValues = [
      memory.title,
      memory.url,
      memory.description,
      ...memory.categories.map((category) => category.name),
      ...memory.tags.map((tag) => tag.name),
      ...memory.flashbacks.flatMap((flashback) => [
        flashback.text,
        flashback.prefix,
        flashback.suffix,
      ]),
    ].map((value) => value.trim().toLowerCase());

    for (const [index, term] of search.freeTerms.entries()) {
      if (ftsMatchesByTerm[index]?.has(memory.id)) {
        continue;
      }
      if (!searchableValues.some((value) => value.includes(term))) {
        return false;
      }
    }
  }

  return true;
}

function groupBrowseFlashbacksByMemoryId(
  rows: FlashbackBrowseRow[],
): Map<string, BrowseFlashback[]> {
  const grouped = new Map<string, BrowseFlashback[]>();
  for (const row of rows) {
    const flashbacks = grouped.get(row.memoryId) ?? [];
    flashbacks.push(toBrowseFlashback(row));
    grouped.set(row.memoryId, flashbacks);
  }

  return grouped;
}

function toBrowseFlashback(row: FlashbackBrowseRow): BrowseFlashback {
  return {
    id: row.id,
    memoryId: row.memoryId,
    variantKind: row.variantKind,
    langCode: row.langCode,
    translationOutputHash: row.translationOutputHash,
    text: row.text,
    prefix: row.prefix,
    suffix: row.suffix,
    createdAt: row.createdAt,
  };
}

function toMemoryBrowsePageRepositoryInput(
  request: BrowseMemoryPageRequest,
): ListMemoryBrowsePageInput {
  const search = parseBrowseSearch(request.query.q);
  const parsedNow =
    typeof request.now === "string" && request.now.trim().length > 0
      ? new Date(request.now)
      : undefined;
  if (parsedNow !== undefined && Number.isNaN(parsedNow.getTime())) {
    throw new Error("Invalid memory browse now timestamp.");
  }

  return {
    categoryId: request.query.category,
    cursor: toRepositoryCursor(request.cursor),
    flashbackId: request.query.flashback,
    includeArchive: search.inArchive,
    lane: request.query.lane,
    limit: request.limit,
    now: parsedNow,
    readState: search.readState,
    searchFields: search.fields.map((field) => ({
      field: field.field,
      values: [field.value],
    })),
    searchTerms: search.freeTerms,
    shelfExpiryAction: request.shelfExpiryAction,
    shelfTtlDays: request.shelfTtlDays,
    sort: request.query.sort,
    tagId: request.query.tag,
  };
}

function toRepositoryCursor(
  cursor: BrowseMemoryCursor | null,
): ListMemoryBrowsePageInput["cursor"] {
  if (cursor === null) {
    return null;
  }

  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("Invalid memory browse cursor timestamp.");
  }

  if (cursor.lastOpenedAt === undefined) {
    return {
      createdAt,
      id: cursor.id,
    };
  }

  if (cursor.lastOpenedAt === null) {
    return {
      createdAt,
      id: cursor.id,
      lastOpenedAt: null,
    };
  }

  const lastOpenedAt = new Date(cursor.lastOpenedAt);
  if (Number.isNaN(lastOpenedAt.getTime())) {
    throw new Error("Invalid memory browse cursor lastOpenedAt timestamp.");
  }

  return {
    createdAt,
    id: cursor.id,
    lastOpenedAt,
  };
}

function toBrowseMemoryWithoutFlashbacks(row: MemoryBrowsePageRow): BrowseMemory {
  return {
    ...row,
    flashbacks: [],
  };
}

function withoutFlashbacks(memory: BrowseMemory): BrowseMemory {
  return {
    ...memory,
    flashbacks: [],
  };
}

function startBackupQueue(config: ResolvedTraumaConfig): void {
  getMemoryBackupQueue(config);
}
