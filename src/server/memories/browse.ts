import { loadRuntimeTraumaConfig } from "../config";
import type { ResolvedTraumaConfig } from "../config";
import { getMemoryBackupQueue } from "../backup";
import { initializeDatabase } from "../db";
import type { MemoryBrowseRow } from "../db/repositories";
import { filterRenderableFlashbackRows } from "../flashbacks/browse";
import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { BrowseMemory } from "../../components/memories/browse-data";

interface LoadBrowseMemoriesOptions {
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

function startBackupQueue(config: ResolvedTraumaConfig): void {
  getMemoryBackupQueue(config);
}
