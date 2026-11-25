import { query, revalidate } from "@solidjs/router";

import { loadBrowseMemoryPage } from "~/server/memories/browse";
import { loadBrowseTaxonomy } from "~/server/taxonomy/browse";
import {
  BROWSE_MEMORY_PAGE_SIZE,
  createInitialBrowseMemoryPageRequest,
  defaultBrowseQuery,
  filterBrowseMemories,
  parseBrowseSearch,
  type BrowseMemory,
  type BrowseMemoryPage,
  type BrowseMemoryPageRequest,
  type BrowseMemoryPageRequestOptions,
  type BrowseQuery,
} from "./browse-data";
import { browseFixtureMemories } from "./browse-fixtures";

export const getBrowseMemoryPage = query(async (request: BrowseMemoryPageRequest) => {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return loadBrowseFixturePageWithPersistenceOverlay(request);
  }

  return loadBrowseMemoryPage(request);
}, "browse-memory-page");

export function revalidateBrowseMemoryPages() {
  return revalidate(getBrowseMemoryPage.key);
}

export function revalidateBrowseMemoryFirstPage(
  query: BrowseQuery = defaultBrowseQuery,
  options?: BrowseMemoryPageRequestOptions,
) {
  return revalidate(
    getBrowseMemoryPage.keyFor(createInitialBrowseMemoryPageRequest(query, options)),
  );
}

export const getBrowseTaxonomy = query(async () => {
  "use server";

  return loadBrowseTaxonomy();
}, "browse-taxonomy");

export function revalidateBrowseTaxonomy() {
  return revalidate(getBrowseTaxonomy.key);
}

export async function revalidateBrowseMemoryWorkspace() {
  await Promise.all([
    revalidateBrowseMemoryPages(),
    revalidateBrowseTaxonomy(),
  ]);
}

async function loadBrowseFixturePageWithPersistenceOverlay(
  request: BrowseMemoryPageRequest,
): Promise<BrowseMemoryPage> {
  "use server";

  const persistedById = new Map<
    string,
    {
      triageState: BrowseMemory["triageState"];
      triageChangedAt: string;
      lastPosition: BrowseMemory["lastPosition"];
      lastOpenedAt: string | null;
      read: boolean;
    }
  >();

  try {
    const [{ loadRuntimeTraumaConfig }, { initializeDatabase, schema }] =
      await Promise.all([import("~/server/config"), import("~/server/db")]);
    const config = loadRuntimeTraumaConfig();
    const connection = initializeDatabase(config);
    try {
      const rows = await connection.db
        .select({
          id: schema.memories.id,
          triageState: schema.memories.triageState,
          triageChangedAt: schema.memories.triageChangedAt,
          lastPosition: schema.memories.lastPosition,
          lastOpenedAt: schema.memories.lastOpenedAt,
          read: schema.memories.read,
        })
        .from(schema.memories);

      for (const row of rows) {
        let parsedPosition: BrowseMemory["lastPosition"] = null;
        if (typeof row.lastPosition === "string" && row.lastPosition.length > 0) {
          try {
            parsedPosition = JSON.parse(
              row.lastPosition,
            ) as BrowseMemory["lastPosition"];
          } catch {
            parsedPosition = null;
          }
        }
        persistedById.set(row.id, {
          triageState: row.triageState,
          triageChangedAt: row.triageChangedAt.toISOString(),
          lastPosition: parsedPosition,
          lastOpenedAt: row.lastOpenedAt ? row.lastOpenedAt.toISOString() : null,
          read: row.read,
        });
      }
    } finally {
      connection.close();
    }
  } catch {
    return loadBrowseMemoryPage(request);
  }

  const nowMs =
    typeof request.now === "string" && !Number.isNaN(Date.parse(request.now))
      ? Date.parse(request.now)
      : Date.now();
  const search = parseBrowseSearch(request.query.q);
  const hasShelfTtl =
    request.query.lane === "shelf" &&
    !search.inArchive &&
    typeof request.shelfTtlDays === "number" &&
    Number.isFinite(request.shelfTtlDays) &&
    request.shelfTtlDays > 0;
  const shelfCutoffMs = hasShelfTtl
    ? nowMs - (request.shelfTtlDays as number) * 86_400_000
    : null;

  const overlaid: BrowseMemory[] = browseFixtureMemories.map((memory) => {
    const persisted = persistedById.get(memory.id);
    const merged: BrowseMemory = persisted
      ? {
          ...memory,
          triageState: persisted.triageState,
          triageChangedAt: persisted.triageChangedAt,
          lastPosition: persisted.lastPosition,
          lastOpenedAt: persisted.lastOpenedAt,
          read: persisted.read,
        }
      : { ...memory };

    if (
      hasShelfTtl &&
      shelfCutoffMs !== null &&
      merged.triageState === "shelf"
    ) {
      const changedMs = merged.triageChangedAt
        ? Date.parse(merged.triageChangedAt)
        : Date.parse(merged.capturedAt);
      const expired = Number.isFinite(changedMs) && changedMs < shelfCutoffMs;
      if (expired && request.shelfExpiryAction === "soft-archive") {
        merged.triageState = "archive";
      } else {
        merged.shelfExpired = expired;
      }
    }

    return merged;
  });

  const filtered = filterBrowseMemories(overlaid, request.query);
  const start =
    request.cursor === null
      ? 0
      : (() => {
          const index = filtered.findIndex(
            (memory) =>
              memory.id === request.cursor?.id &&
              memory.capturedAt === request.cursor?.createdAt,
          );
          return index === -1 ? filtered.length : index + 1;
        })();
  const limit =
    typeof request.limit === "number" && request.limit > 0
      ? Math.min(Math.trunc(request.limit), 100)
      : BROWSE_MEMORY_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + limit);
  const hasNextPage = start + limit < filtered.length;
  const lastPageRow = pageRows[pageRows.length - 1];

  return {
    memories: pageRows.map((memory) => ({ ...memory, flashbacks: [] })),
    nextCursor:
      hasNextPage && lastPageRow !== undefined
        ? { createdAt: lastPageRow.capturedAt, id: lastPageRow.id }
        : null,
  };
}
