import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { FlashbackBrowseRow } from "../db/repositories";
import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";

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
    return rows;
  } finally {
    connection?.close();
  }
}
