import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { BrowseFlashback } from "../../components/memories/browse-data";
import type {
  FlashbackBrowseCursor,
  FlashbackBrowseRow,
  TranslationRepository,
} from "../db/repositories";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import {
  MemoryContentStoreError,
  readMemoryContent,
  readResolvedMemoryContent,
} from "../store";
import {
  applyFlashbackMarkers,
  FlashbackMarkerError,
  type FlashbackMarkerRange,
} from "../store/flashback-markers";
import { resolveCurrentTranslationReadOnly } from "../translation/current-translation";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import { normalizeBrowseLimit } from "../browse/limits";
import { mapWithConcurrency } from "../browse/concurrency";
import {
  collectFilteredCursorPage,
  type CursorPage,
} from "../browse/filtered-page";
import { parseCollectionPageInput } from "../browse/collection-page";
import { encodeCollectionCursor } from "../browse/collection-cursor";

const RECENT_FLASHBACK_SCAN_CHUNK_LIMIT = 100;
const MAX_RECENT_FLASHBACK_FETCH_ROUNDS = 20;
const FLASHBACK_VARIANT_READ_CONCURRENCY = 8;
export const MAX_FLASHBACK_PAGE_SCAN_BATCHES = 4;

export interface FlashbackBrowsePage {
  flashbacks: FlashbackBrowseRow[];
  nextCursor: string | null;
}

export async function loadFlashbackBrowsePage(
  input: { cursor?: string | null; limit?: number } = {},
): Promise<FlashbackBrowsePage> {
  "use server";

  const request = parseCollectionPageInput("flashbacks", input);
  let config: ResolvedTraumaConfig;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    if (
      process.env.TRAUMA_BROWSE_FIXTURES === "1" &&
      error instanceof TraumaConfigError
    ) {
      return loadFixtureFlashbackBrowsePage(request);
    }
    throw error;
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const activeConnection = initializeDatabase(config);
    connection = activeConnection;
    const page = await collectFlashbackBrowsePage({
      cursor: request.cursor,
      filterRows: (rows) =>
        filterRenderableFlashbackRows({
          config,
          rows,
          translationRepository: activeConnection.repositories.translations,
        }),
      limit: request.limit,
      listRows: (pageInput) =>
        activeConnection.repositories.flashbacks.listRecentForBrowse(pageInput),
    });
    return formatFlashbackBrowsePage(page);
  } finally {
    connection?.close();
  }
}

export async function collectFlashbackBrowsePage(input: {
  cursor: FlashbackBrowseCursor | null;
  filterRows: (rows: FlashbackBrowseRow[]) => Promise<FlashbackBrowseRow[]>;
  limit: number;
  listRows: (input: {
    cursor: FlashbackBrowseCursor | null;
    limit: number;
  }) => Promise<FlashbackBrowseRow[]>;
}): Promise<CursorPage<FlashbackBrowseRow, FlashbackBrowseCursor>> {
  const limit = normalizeBrowseLimit(input.limit);
  return collectFilteredCursorPage({
    cursor: input.cursor,
    filterRows: input.filterRows,
    limit,
    loadPage: async ({ cursor, limit: pageLimit }) => {
      const rows = await input.listRows({ cursor, limit: pageLimit });
      const lastRow = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          rows.length === pageLimit && lastRow !== undefined
            ? { createdAt: new Date(lastRow.createdAt), id: lastRow.id }
            : null,
      };
    },
    maxFetchRounds: MAX_FLASHBACK_PAGE_SCAN_BATCHES,
  });
}

export async function loadFlashbackBrowseRows(): Promise<FlashbackBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return fixtureFlashbackBrowseRows();
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await listAllFlashbackBrowseRows(
      connection.repositories.flashbacks,
    );
    return await filterRenderableFlashbackRows({
      config,
      rows,
      translationRepository: connection.repositories.translations,
    });
  } finally {
    connection?.close();
  }
}

export async function loadRecentFlashbackBrowseRows(input: {
  limit: number;
}): Promise<FlashbackBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return fixtureFlashbackBrowseRows().slice(0, normalizeBrowseLimit(input.limit));
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const limit = normalizeBrowseLimit(input.limit);
    const renderableRows: FlashbackBrowseRow[] = [];
    let cursor: { createdAt: Date; id: string } | null = null;
    let rounds = 0;

    while (
      renderableRows.length < limit &&
      rounds < MAX_RECENT_FLASHBACK_FETCH_ROUNDS
    ) {
      rounds += 1;
      const rows = await connection.repositories.flashbacks.listRecentForBrowse({
        cursor,
        limit: RECENT_FLASHBACK_SCAN_CHUNK_LIMIT,
      });
      if (rows.length === 0) {
        break;
      }

      renderableRows.push(
        ...(await filterRenderableFlashbackRows({
          config,
          rows,
          translationRepository: connection.repositories.translations,
        })),
      );

      const lastRow = rows[rows.length - 1];
      if (rows.length < RECENT_FLASHBACK_SCAN_CHUNK_LIMIT || lastRow === undefined) {
        break;
      }

      cursor = {
        createdAt: new Date(lastRow.createdAt),
        id: lastRow.id,
      };
    }

    return renderableRows.slice(0, limit);
  } finally {
    connection?.close();
  }
}

export async function loadBrowseFlashbacksForMemories(input: {
  memoryIds: string[];
  selectedFlashbackId: string;
}): Promise<Record<string, BrowseFlashback[]>> {
  "use server";

  const memoryIds = [...new Set(input.memoryIds.filter((id) => id.length > 0))];
  if (memoryIds.length === 0) {
    return {};
  }

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return groupBrowseFlashbacksByMemoryId(
      fixtureFlashbackBrowseRows().filter((row) => memoryIds.includes(row.memoryId)),
      memoryIds,
    );
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await connection.repositories.flashbacks.listForBrowseMemoryIds({
      memoryIds,
    });
    const selectedRow =
      input.selectedFlashbackId.length === 0
        ? undefined
        : await connection.repositories.flashbacks.findForBrowseById(
            input.selectedFlashbackId,
          );
    const candidates = mergeSelectedFlashbackCandidate({
      memoryIds,
      rows,
      selectedRow,
    });
    const renderableRows = await filterRenderableFlashbackRows({
      config,
      rows: candidates,
      translationRepository: connection.repositories.translations,
    });

    return groupBrowseFlashbacksByMemoryId(renderableRows, memoryIds);
  } finally {
    connection?.close();
  }
}

function fixtureFlashbackBrowseRows(): FlashbackBrowseRow[] {
  return browseFixtureMemories
    .flatMap((memory) =>
      memory.flashbacks.map((flashback) => ({
        id: flashback.id,
        memoryId: memory.id,
        memoryTitle: memory.title,
        variantKind: flashback.variantKind,
        langCode: flashback.langCode,
        translationOutputHash: flashback.translationOutputHash,
        text: flashback.text,
        prefix: flashback.prefix,
        suffix: flashback.suffix,
        startOffset: 0,
        endOffset: flashback.text.length,
        contentHash: null,
        createdAt: flashback.createdAt,
      })),
    )
    .toSorted((left, right) => {
      const dateOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return dateOrder !== 0 ? dateOrder : right.id.localeCompare(left.id);
    });
}

async function loadFixtureFlashbackBrowsePage(request: {
  cursor: FlashbackBrowseCursor | null;
  limit: number;
}): Promise<FlashbackBrowsePage> {
  const page = await collectFlashbackBrowsePage({
    cursor: request.cursor,
    filterRows: async (rows) => rows,
    limit: request.limit,
    listRows: async ({ cursor, limit }) =>
      listFixtureFlashbackPage(fixtureFlashbackBrowseRows(), cursor, limit),
  });
  return formatFlashbackBrowsePage(page);
}

function listFixtureFlashbackPage(
  rows: FlashbackBrowseRow[],
  cursor: FlashbackBrowseCursor | null,
  limit: number,
): FlashbackBrowseRow[] {
  return rows
    .filter((row) =>
      cursor === null ||
      Date.parse(row.createdAt) < cursor.createdAt.getTime() ||
      (
        Date.parse(row.createdAt) === cursor.createdAt.getTime() &&
        row.id < cursor.id
      )
    )
    .slice(0, limit);
}

function formatFlashbackBrowsePage(
  page: CursorPage<FlashbackBrowseRow, FlashbackBrowseCursor>,
): FlashbackBrowsePage {
  return {
    flashbacks: page.rows,
    nextCursor:
      page.nextCursor === null
        ? null
        : encodeCollectionCursor("flashbacks", page.nextCursor),
  };
}

function mergeSelectedFlashbackCandidate(input: {
  memoryIds: string[];
  rows: FlashbackBrowseRow[];
  selectedRow: FlashbackBrowseRow | undefined;
}): FlashbackBrowseRow[] {
  if (
    input.selectedRow === undefined ||
    !input.memoryIds.includes(input.selectedRow.memoryId) ||
    input.rows.some((row) => row.id === input.selectedRow?.id)
  ) {
    return input.rows;
  }

  return [input.selectedRow, ...input.rows];
}

function groupBrowseFlashbacksByMemoryId(
  rows: FlashbackBrowseRow[],
  memoryIds: string[],
): Record<string, BrowseFlashback[]> {
  const memoryIdSet = new Set(memoryIds);
  const grouped: Record<string, BrowseFlashback[]> = {};
  for (const memoryId of memoryIds) {
    grouped[memoryId] = [];
  }

  for (const row of rows) {
    if (!memoryIdSet.has(row.memoryId)) {
      continue;
    }

    grouped[row.memoryId]?.push({
      id: row.id,
      memoryId: row.memoryId,
      variantKind: row.variantKind,
      langCode: row.langCode,
      translationOutputHash: row.translationOutputHash,
      text: row.text,
      prefix: row.prefix,
      suffix: row.suffix,
      createdAt: row.createdAt,
    });
  }

  return grouped;
}

export async function filterRenderableFlashbackRows(input: {
  config: ResolvedTraumaConfig;
  rows: FlashbackBrowseRow[];
  translationRepository?: TranslationRepository;
}): Promise<FlashbackBrowseRow[]> {
  return filterRenderableFlashbackRowsByVariant({
    rows: input.rows,
    resolveVariantRows: (rows) =>
      resolveRenderableFlashbackIds({
        config: input.config,
        rows,
        translationRepository: input.translationRepository,
      }),
  });
}

export async function filterRenderableFlashbackRowsByVariant(input: {
  rows: FlashbackBrowseRow[];
  resolveVariantRows: (
    rows: FlashbackBrowseRow[],
  ) => Promise<Set<string>>;
}): Promise<FlashbackBrowseRow[]> {
  const rowsByVariant = new Map<string, FlashbackBrowseRow[]>();
  for (const row of input.rows) {
    const variantRows = rowsByVariant.get(getFlashbackVariantKey(row));
    if (variantRows === undefined) {
      rowsByVariant.set(getFlashbackVariantKey(row), [row]);
    } else {
      variantRows.push(row);
    }
  }

  const renderableIds = new Set<string>();
  const resolvedIds = await mapWithConcurrency(
    [...rowsByVariant.values()],
    FLASHBACK_VARIANT_READ_CONCURRENCY,
    input.resolveVariantRows,
  );
  for (const ids of resolvedIds) {
    for (const id of ids) {
      renderableIds.add(id);
    }
  }

  return input.rows.filter((row) => renderableIds.has(row.id));
}

async function listAllFlashbackBrowseRows(
  repository: {
    listRecentForBrowse: (input: {
      cursor: { createdAt: Date; id: string } | null;
      limit: number;
    }) => Promise<FlashbackBrowseRow[]>;
  },
): Promise<FlashbackBrowseRow[]> {
  const rows: FlashbackBrowseRow[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;

  while (true) {
    const page = await repository.listRecentForBrowse({
      cursor,
      limit: RECENT_FLASHBACK_SCAN_CHUNK_LIMIT,
    });
    rows.push(...page);
    const lastRow = page[page.length - 1];
    if (page.length < RECENT_FLASHBACK_SCAN_CHUNK_LIMIT || lastRow === undefined) {
      return rows;
    }
    cursor = { createdAt: new Date(lastRow.createdAt), id: lastRow.id };
  }
}

async function resolveRenderableFlashbackIds(input: {
  config: ResolvedTraumaConfig;
  rows: FlashbackBrowseRow[];
  translationRepository?: TranslationRepository;
}): Promise<Set<string>> {
  const firstRow = input.rows[0];
  if (firstRow === undefined) {
    return new Set();
  }

  try {
    const markdown = await readFlashbackVariantMarkdown({
      config: input.config,
      row: firstRow,
      translationRepository: input.translationRepository,
    });
    return collectRenderedFlashbackIds(
      applyFlashbackMarkers(markdown, input.rows.map(toMarkerRange)),
    );
  } catch (error) {
    if (
      error instanceof MemoryContentStoreError ||
      error instanceof FlashbackMarkerError
    ) {
      return new Set();
    }

    throw error;
  }
}

async function readFlashbackVariantMarkdown(input: {
  config: ResolvedTraumaConfig;
  row: FlashbackBrowseRow;
  translationRepository?: TranslationRepository;
}): Promise<string> {
  if (input.row.variantKind === "source") {
    const content = await readMemoryContent({
      config: input.config,
      memoryId: input.row.memoryId,
    });
    return content.markdown;
  }

  if (
    input.row.langCode === null ||
    input.row.translationOutputHash === null ||
    input.translationRepository === undefined
  ) {
    throw new MemoryContentStoreError(
      "translated flashback row is missing variant context",
      "missing_content",
    );
  }

  const current = await resolveCurrentTranslationReadOnly({
    config: input.config,
    langCode: input.row.langCode,
    memoryId: input.row.memoryId,
    repository: input.translationRepository,
  });
  if (
    current.status !== "current" ||
    current.outputHash !== input.row.translationOutputHash
  ) {
    throw new MemoryContentStoreError(
      "translated flashback row is stale",
      "missing_content",
    );
  }

  const content = await readResolvedMemoryContent(
    resolveTranslatedMemoryContentPath({
      config: input.config,
      langCode: input.row.langCode,
      memoryId: input.row.memoryId,
    }),
  );
  return content.markdown;
}

function getFlashbackVariantKey(row: FlashbackBrowseRow): string {
  return [
    row.memoryId,
    row.variantKind,
    row.langCode ?? "",
    row.translationOutputHash ?? "",
  ].join(":");
}

function toMarkerRange(row: FlashbackBrowseRow): FlashbackMarkerRange {
  return {
    id: row.id,
    contentHash: row.contentHash,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    text: row.text,
  };
}

function collectRenderedFlashbackIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/\bdata-flashback-id="([^"]+)"/g)) {
    const id = match[1];
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return ids;
}
