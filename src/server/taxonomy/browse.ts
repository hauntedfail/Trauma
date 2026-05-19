import { browseFixtureMemories } from "../../components/memories/browse-fixtures";
import type {
  BrowseMemory,
  BrowseTaxonomySummary,
  BrowseTaxonomySummaryItem,
} from "../../components/memories/browse-data";
import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { TaxonomyBrowseRow } from "../db/repositories";

export async function loadBrowseTaxonomy(): Promise<BrowseTaxonomySummary> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return getFixtureTaxonomySummary(browseFixtureMemories);
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const [categories, tags] = await Promise.all([
      connection.repositories.taxonomy.listCategoriesForBrowse(),
      connection.repositories.taxonomy.listTagsForBrowse(),
    ]);

    return {
      categories: categories.map(toBrowseTaxonomySummaryItem),
      tags: tags.map(toBrowseTaxonomySummaryItem),
    };
  } finally {
    connection?.close();
  }
}

function toBrowseTaxonomySummaryItem(
  row: TaxonomyBrowseRow,
): BrowseTaxonomySummaryItem {
  return row;
}

function getFixtureTaxonomySummary(
  memories: BrowseMemory[],
): BrowseTaxonomySummary {
  return {
    categories: getFixtureTaxonomyItems(
      memories.flatMap((memory) => memory.categories),
    ),
    tags: getFixtureTaxonomyItems(memories.flatMap((memory) => memory.tags)),
  };
}

function getFixtureTaxonomyItems(
  items: BrowseMemory["categories"],
): BrowseTaxonomySummaryItem[] {
  const counts = new Map<string, BrowseTaxonomySummaryItem>();

  for (const item of items) {
    const current = counts.get(item.id);
    if (current === undefined) {
      counts.set(item.id, {
        ...item,
        memoryCount: 1,
        lastAssignedAt: null,
      });
      continue;
    }

    current.memoryCount += 1;
  }

  return [...counts.values()].sort(
    (left, right) =>
      right.memoryCount - left.memoryCount || left.name.localeCompare(right.name),
  );
}
