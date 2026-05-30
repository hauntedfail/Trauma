import { loadRuntimeTraumaConfig } from "../config";
import type { ResolvedTraumaConfig } from "../config";
import { getMemoryBackupQueue } from "../backup";
import { initializeDatabase } from "../db";
import type {
  FlashbackBrowseRow,
  ListMemoryBrowsePageInput,
  MemoryBrowsePageResult,
  MemoryBrowsePageRow,
  MemoryBrowseRow,
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

const MAX_RENDERABLE_FLASHBACK_FILTER_FETCH_ROUNDS = 20;

export interface LoadBrowseMemoriesOptions {
  startBackupQueue?: (config: ResolvedTraumaConfig) => void;
}

export async function loadBrowseMemories(
  options: LoadBrowseMemoriesOptions = {},
): Promise<BrowseMemory[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return browseFixtureMemories;
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    (options.startBackupQueue ?? startBackupQueue)(config);
    connection = initializeDatabase(config);
    const rows = await connection.repositories.memories.listForBrowse();
    return (
      await filterBrowseMemoryFlashbacks({
        config,
        rows,
        translationRepository: connection.repositories.translations,
      })
    ).map(toBrowseMemory);
  } finally {
    connection?.close();
  }
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
}): Promise<MemoryBrowsePageResult> {
  const limit = normalizeBrowseLimit(input.repositoryInput.limit);
  const rows: MemoryBrowsePageRow[] = [];
  let cursor = input.repositoryInput.cursor;
  let nextCursor: MemoryBrowsePageResult["nextCursor"] = null;
  let rounds = 0;

  while (
    rows.length < limit &&
    rounds < MAX_RENDERABLE_FLASHBACK_FILTER_FETCH_ROUNDS
  ) {
    rounds += 1;
    const page = await input.repositories.memories.listForBrowsePage({
      ...input.repositoryInput,
      cursor,
      limit: limit - rows.length,
    });

    if (page.rows.length === 0) {
      nextCursor = null;
      break;
    }

    rows.push(
      ...(await filterPageRowsByRenderableFlashbacks({
        config: input.config,
        query: input.query,
        repositories: input.repositories,
        rows: page.rows,
      })),
    );

    if (rows.length >= limit) {
      nextCursor = page.nextCursor;
      break;
    }

    nextCursor = page.nextCursor;
    if (page.nextCursor === null) {
      break;
    }

    cursor = page.nextCursor;
  }

  return { rows, nextCursor };
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
  const matchingIds = new Set(
    filterBrowseMemories(
      input.rows.map((row) => ({
        ...toBrowseMemoryWithoutFlashbacks(row),
        flashbacks: flashbacksByMemoryId.get(row.id) ?? [],
      })),
      input.query,
    ).map((memory) => memory.id),
  );

  return input.rows.filter((row) => matchingIds.has(row.id));
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

  return {
    categoryId: request.query.category,
    cursor: toRepositoryCursor(request.cursor),
    flashbackId: request.query.flashback,
    limit: request.limit,
    readState: search.readState,
    searchFields: search.fields.map((field) => ({
      field: field.field,
      values: [field.value],
    })),
    searchTerms: search.freeTerms,
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

  return {
    createdAt,
    id: cursor.id,
  };
}

async function filterBrowseMemoryFlashbacks(input: {
  config: ResolvedTraumaConfig;
  rows: MemoryBrowseRow[];
  translationRepository: ReturnType<typeof initializeDatabase>["repositories"]["translations"];
}): Promise<MemoryBrowseRow[]> {
  const renderableFlashbackIds = new Set(
    (
      await filterRenderableFlashbackRows({
        config: input.config,
        rows: input.rows.flatMap((row) => row.flashbacks),
        translationRepository: input.translationRepository,
      })
    ).map((flashback) => flashback.id),
  );

  return input.rows.map((row) => ({
    ...row,
    flashbacks: row.flashbacks.filter((flashback) =>
      renderableFlashbackIds.has(flashback.id),
    ),
  }));
}

function toBrowseMemory(row: MemoryBrowseRow): BrowseMemory {
  return {
    ...row,
    flashbacks: row.flashbacks.map((flashback) => ({
      id: flashback.id,
      memoryId: flashback.memoryId,
      variantKind: flashback.variantKind,
      langCode: flashback.langCode,
      translationOutputHash: flashback.translationOutputHash,
      text: flashback.text,
      prefix: flashback.prefix,
      suffix: flashback.suffix,
      createdAt: flashback.createdAt,
    })),
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
