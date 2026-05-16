import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { MomentBrowseRow as StoredMomentBrowseRow } from "../db/repositories";
import { MemoryContentStoreError, readMemoryContent } from "../store";
import { renderMemoryMarkdown } from "../reader/markdown-renderer";

export type MomentTargetStatus = "current" | "resolved_from_path" | "stale";

export type MomentBrowseRow = StoredMomentBrowseRow & {
  targetAnchor: string | null;
  targetStatus: MomentTargetStatus;
};

export async function loadMomentBrowseRows(): Promise<MomentBrowseRow[]> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return [];
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await connection.repositories.moments.listForBrowse();
    const tocCache = new Map<
      string,
      Promise<ReturnType<typeof renderMemoryMarkdown>["toc"] | undefined>
    >();
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...await resolveMomentTarget({
          row,
          loadToc: () => getMomentMemoryToc({ config, memoryId: row.memoryId, tocCache }),
        }),
      })),
    );
  } finally {
    connection?.close();
  }
}

async function resolveMomentTarget(input: {
  row: StoredMomentBrowseRow;
  loadToc: () => Promise<ReturnType<typeof renderMemoryMarkdown>["toc"] | undefined>;
}): Promise<Pick<MomentBrowseRow, "targetAnchor" | "targetStatus">> {
  const toc = await input.loadToc();
  if (toc === undefined) {
    return { targetAnchor: null, targetStatus: "stale" };
  }

  if (toc.some((entry) => entry.id === input.row.sectionAnchor)) {
    return {
      targetAnchor: input.row.sectionAnchor,
      targetStatus: "current",
    };
  }

  const pathMatches = toc.filter((entry) => entry.path === input.row.sectionPath);
  if (pathMatches.length === 1) {
    return {
      targetAnchor: pathMatches[0]?.id ?? null,
      targetStatus: "resolved_from_path",
    };
  }

  return { targetAnchor: null, targetStatus: "stale" };
}

async function getMomentMemoryToc(input: {
  config: Parameters<typeof readMemoryContent>[0]["config"];
  memoryId: string;
  tocCache: Map<
    string,
    Promise<ReturnType<typeof renderMemoryMarkdown>["toc"] | undefined>
  >;
}) {
  const cached = input.tocCache.get(input.memoryId);
  if (cached !== undefined) {
    return cached;
  }

  const toc = readMomentMemoryToc(input.config, input.memoryId);
  input.tocCache.set(input.memoryId, toc);
  return toc;
}

async function readMomentMemoryToc(
  config: Parameters<typeof readMemoryContent>[0]["config"],
  memoryId: string,
) {
  try {
    const content = await readMemoryContent({ config, memoryId });
    return renderMemoryMarkdown(content.markdown).toc;
  } catch (error) {
    if (error instanceof MemoryContentStoreError) {
      return undefined;
    }

    throw error;
  }
}
