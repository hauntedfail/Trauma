import { loadRuntimeTraumaConfig } from "../config";
import type { ResolvedTraumaConfig } from "../config";
import { getMemoryBackupQueue } from "../backup";
import { initializeDatabase } from "../db";
import type { MemoryBrowseRow } from "../db/repositories";
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
    return (await connection.repositories.memories.listForBrowse()).map(toBrowseMemory);
  } finally {
    connection?.close();
  }
}

function toBrowseMemory(row: MemoryBrowseRow): BrowseMemory {
  return row;
}

function startBackupQueue(config: ResolvedTraumaConfig): void {
  getMemoryBackupQueue(config);
}
