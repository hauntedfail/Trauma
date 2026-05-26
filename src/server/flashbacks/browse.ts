import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
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

export async function loadFlashbackBrowseRows(): Promise<FlashbackBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return browseFixtureMemories
      .flatMap((memory) =>
        memory.flashbacks.map((flashback) => ({
          id: flashback.id,
          memoryId: memory.id,
          memoryTitle: memory.title,
          variantKind: "source" as const,
          langCode: null,
          translationOutputHash: null,
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
