import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type { HighlightBrowseRow } from "../db/repositories";
import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";

export async function loadHighlightBrowseRows(): Promise<HighlightBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return browseFixtureMemories
      .flatMap((memory) =>
        memory.highlights.map((highlight) => ({
          id: highlight.id,
          memoryId: memory.id,
          memoryTitle: memory.title,
          text: highlight.text,
          prefix: highlight.prefix,
          suffix: highlight.suffix,
          startOffset: 0,
          endOffset: highlight.text.length,
          createdAt: highlight.createdAt,
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
    return connection.repositories.highlights.listForBrowse();
  } finally {
    connection?.close();
  }
}
