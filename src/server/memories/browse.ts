import { loadRuntimeTraumaConfig } from "../config";
import type { ResolvedTraumaConfig } from "../config";
import { getMemoryBackupQueue } from "../backup";
import { initializeDatabase } from "../db";
import type {
  ListMemoryBrowsePageInput,
  MemoryBrowsePageRow,
  MemoryBrowseRow,
} from "../db/repositories";
import { filterRenderableFlashbackRows } from "../flashbacks/browse";
import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import {
  filterBrowseMemories,
  parseBrowseSearch,
  type BrowseMemory,
  type BrowseMemoryCursor,
  type BrowseMemoryPage,
  type BrowseMemoryPageRequest,
} from "../../components/memories/browse-data";

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
    const page = await connection.repositories.memories.listForBrowsePage(
      toMemoryBrowsePageRepositoryInput(request),
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
  const limit = normalizePageRequestLimit(request.limit);
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

function normalizePageRequestLimit(limit: number): number {
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return 1;
  }

  return normalized;
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
