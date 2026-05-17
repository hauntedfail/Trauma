import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { FlashbackBrowseRow } from "../db/repositories";
import { loadRuntimeTraumaConfig, type ResolvedTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import { MemoryContentStoreError, readMemoryContent } from "../store";
import {
  applyFlashbackMarkers,
  FlashbackMarkerError,
  type FlashbackMarkerRange,
} from "../store/flashback-markers";

export async function loadFlashbackBrowseRows(): Promise<FlashbackBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return browseFixtureMemories
      .flatMap((memory) =>
        memory.flashbacks.map((flashback) => ({
          id: flashback.id,
          memoryId: memory.id,
          memoryTitle: memory.title,
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
    return filterRenderableFlashbackRows({ config, rows });
  } finally {
    connection?.close();
  }
}

export async function filterRenderableFlashbackRows(input: {
  config: ResolvedTraumaConfig;
  rows: FlashbackBrowseRow[];
}): Promise<FlashbackBrowseRow[]> {
  const rowsByMemoryId = new Map<string, FlashbackBrowseRow[]>();
  for (const row of input.rows) {
    const memoryRows = rowsByMemoryId.get(row.memoryId);
    if (memoryRows === undefined) {
      rowsByMemoryId.set(row.memoryId, [row]);
    } else {
      memoryRows.push(row);
    }
  }

  const renderableIds = new Set<string>();
  await Promise.all(
    [...rowsByMemoryId].map(async ([memoryId, rows]) => {
      for (const id of await resolveRenderableFlashbackIds({
        config: input.config,
        memoryId,
        rows,
      })) {
        renderableIds.add(id);
      }
    }),
  );

  return input.rows.filter((row) => renderableIds.has(row.id));
}

async function resolveRenderableFlashbackIds(input: {
  config: ResolvedTraumaConfig;
  memoryId: string;
  rows: FlashbackBrowseRow[];
}): Promise<Set<string>> {
  try {
    const content = await readMemoryContent({
      config: input.config,
      memoryId: input.memoryId,
    });
    return collectRenderedFlashbackIds(
      applyFlashbackMarkers(content.markdown, input.rows.map(toMarkerRange)),
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
