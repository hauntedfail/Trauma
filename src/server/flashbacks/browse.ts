import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { BrowseFlashback } from "../../components/memories/browse-data";
import type {
  FlashbackBrowseRow,
  TranslationRepository,
} from "../db/repositories";
import { loadRuntimeTraumaConfig, type ResolvedTraumaConfig } from "../config";
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

const RECENT_FLASHBACK_BACKFILL_CANDIDATE_LIMIT = 100;

export async function loadFlashbackBrowseRows(): Promise<FlashbackBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return fixtureFlashbackBrowseRows();
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await connection.repositories.flashbacks.listForBrowse();
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
    return fixtureFlashbackBrowseRows().slice(0, normalizeFlashbackLimit(input.limit));
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const limit = normalizeFlashbackLimit(input.limit);
    const rows = await connection.repositories.flashbacks.listRecentForBrowse({
      limit,
    });
    const renderableRows = await filterRenderableFlashbackRows({
      config,
      rows,
      translationRepository: connection.repositories.translations,
    });
    if (renderableRows.length >= limit || rows.length < limit) {
      return renderableRows.slice(0, limit);
    }

    const backfillRows =
      await connection.repositories.flashbacks.listRecentForBrowse({
        limit: RECENT_FLASHBACK_BACKFILL_CANDIDATE_LIMIT,
      });
    return (
      await filterRenderableFlashbackRows({
        config,
        rows: backfillRows,
        translationRepository: connection.repositories.translations,
      })
    ).slice(0, limit);
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
    .toSorted(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
}

function normalizeFlashbackLimit(limit: number): number {
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return 1;
  }

  return Math.min(normalized, 100);
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
  await Promise.all(
    [...rowsByVariant].map(async ([, rows]) => {
      for (const id of await resolveRenderableFlashbackIds({
        config: input.config,
        rows,
        translationRepository: input.translationRepository,
      })) {
        renderableIds.add(id);
      }
    }),
  );

  return input.rows.filter((row) => renderableIds.has(row.id));
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
