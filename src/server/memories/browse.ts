import { loadTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { MemoryBrowseRow } from "../db/repositories";
import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { BrowseMemory } from "../../components/memories/browse-data";

export async function loadBrowseMemories(): Promise<BrowseMemory[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return browseFixtureMemories;
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadTraumaConfig();
    connection = initializeDatabase(config);
    return (await connection.repositories.memories.listForBrowse()).map(toBrowseMemory);
  } finally {
    connection?.close();
  }
}

function toBrowseMemory(row: MemoryBrowseRow): BrowseMemory {
  return row;
}
