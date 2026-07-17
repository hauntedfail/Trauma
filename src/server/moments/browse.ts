import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import type {
  MomentBrowseCursor,
  MomentBrowseRow as StoredMomentBrowseRow,
  MomentRepository,
} from "../db/repositories";
import { MemoryContentStoreError, readMemoryContent } from "../store";
import { renderMemoryMarkdown } from "../reader/markdown-renderer";
import { mapWithConcurrency } from "../browse/concurrency";
import { normalizeBrowseLimit } from "../browse/limits";
import { parseCollectionPageInput } from "../browse/collection-page";
import { encodeCollectionCursor } from "../browse/collection-cursor";

const MOMENT_BROWSE_SCAN_CHUNK_LIMIT = 100;
const MOMENT_TOC_READ_CONCURRENCY = 8;

export type MomentTargetStatus = "current" | "resolved_from_path" | "stale";

export type MomentBrowseRow = StoredMomentBrowseRow & {
  targetAnchor: string | null;
  targetStatus: MomentTargetStatus;
};

export interface MomentBrowsePage {
  moments: MomentBrowseRow[];
  nextCursor: string | null;
}

export async function loadMomentBrowsePage(
  input: { cursor?: string | null; limit?: number } = {},
): Promise<MomentBrowsePage> {
  "use server";

  const request = parseCollectionPageInput("moments", input);
  let config: ResolvedTraumaConfig;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    if (
      process.env.TRAUMA_BROWSE_FIXTURES === "1" &&
      error instanceof TraumaConfigError
    ) {
      return { moments: [], nextCursor: null };
    }
    throw error;
  }

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const activeConnection = initializeDatabase(config);
    connection = activeConnection;
    const page = await collectMomentBrowsePage({
      cursor: request.cursor,
      limit: request.limit,
      listRows: (pageInput) =>
        activeConnection.repositories.moments.listPageForBrowse(pageInput),
      resolveRows: (rows) => resolveMomentTargets({ config, rows }),
    });
    return {
      moments: page.rows,
      nextCursor:
        page.nextCursor === null
          ? null
          : encodeCollectionCursor("moments", page.nextCursor),
    };
  } finally {
    connection?.close();
  }
}

export async function collectMomentBrowsePage(input: {
  cursor: MomentBrowseCursor | null;
  limit: number;
  listRows: (input: {
    cursor: MomentBrowseCursor | null;
    limit: number;
  }) => Promise<StoredMomentBrowseRow[]>;
  resolveRows: (rows: StoredMomentBrowseRow[]) => Promise<MomentBrowseRow[]>;
}): Promise<{
  rows: MomentBrowseRow[];
  nextCursor: MomentBrowseCursor | null;
}> {
  const limit = normalizeBrowseLimit(input.limit);
  const rows = await input.listRows({ cursor: input.cursor, limit });
  const lastRow = rows[rows.length - 1];
  return {
    rows: await input.resolveRows(rows),
    nextCursor:
      rows.length === limit && lastRow !== undefined
        ? { createdAt: new Date(lastRow.createdAt), id: lastRow.id }
        : null,
  };
}

export async function loadMomentBrowseRows(): Promise<MomentBrowseRow[]> {
  "use server";

  let config: ResolvedTraumaConfig;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    if (
      process.env.TRAUMA_BROWSE_FIXTURES === "1" &&
      error instanceof TraumaConfigError
    ) {
      return [];
    }

    throw error;
  }

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return loadMomentBrowseRowsForConfig(config);
  }

  return loadMomentBrowseRowsForConfig(config);
}

export async function loadMomentBrowseRowsForConfig(
  config: ResolvedTraumaConfig,
): Promise<MomentBrowseRow[]> {
  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    connection = initializeDatabase(config);
    const rows = await listAllMomentBrowseRows(connection.repositories.moments);
    return resolveMomentTargets({ config, rows });
  } finally {
    connection?.close();
  }
}

async function listAllMomentBrowseRows(
  repository: Pick<MomentRepository, "listPageForBrowse">,
): Promise<StoredMomentBrowseRow[]> {
  const rows: StoredMomentBrowseRow[] = [];
  let cursor: MomentBrowseCursor | null = null;

  while (true) {
    const page = await repository.listPageForBrowse({
      cursor,
      limit: MOMENT_BROWSE_SCAN_CHUNK_LIMIT,
    });
    rows.push(...page);
    const lastRow = page[page.length - 1];
    if (page.length < MOMENT_BROWSE_SCAN_CHUNK_LIMIT || lastRow === undefined) {
      return rows;
    }
    cursor = { createdAt: new Date(lastRow.createdAt), id: lastRow.id };
  }
}

async function resolveMomentTargets(input: {
  config: Parameters<typeof readMemoryContent>[0]["config"];
  rows: StoredMomentBrowseRow[];
}): Promise<MomentBrowseRow[]> {
  return resolveMomentTargetsByMemory({
    rows: input.rows,
    loadToc: (memoryId) => readMomentMemoryToc(input.config, memoryId),
  });
}

export async function resolveMomentTargetsByMemory(input: {
  loadToc: (memoryId: string) => Promise<MomentToc | undefined>;
  rows: StoredMomentBrowseRow[];
}): Promise<MomentBrowseRow[]> {
  const rowsByMemoryId = new Map<
    string,
    { index: number; row: StoredMomentBrowseRow }[]
  >();
  input.rows.forEach((row, index) => {
    const memoryRows = rowsByMemoryId.get(row.memoryId);
    const indexedRow = { index, row };
    if (memoryRows === undefined) {
      rowsByMemoryId.set(row.memoryId, [indexedRow]);
    } else {
      memoryRows.push(indexedRow);
    }
  });

  const targets = new Array<Pick<MomentBrowseRow, "targetAnchor" | "targetStatus">>(
    input.rows.length,
  );
  await mapWithConcurrency(
    [...rowsByMemoryId.entries()],
    MOMENT_TOC_READ_CONCURRENCY,
    async ([memoryId, memoryRows]) => {
      const toc = await input.loadToc(memoryId);
      const tocIndex = toc === undefined ? undefined : createMomentTocIndex(toc);
      for (const { index, row } of memoryRows) {
        targets[index] = resolveMomentTarget(row, tocIndex);
      }
    },
  );

  return input.rows.map((row, index) => ({
    ...row,
    ...(targets[index] ?? staleMomentTarget()),
  }));
}

type MomentToc = ReturnType<typeof renderMemoryMarkdown>["toc"];

interface MomentTocIndex {
  anchors: Map<string, Set<string>>;
  paths: Map<string, { anchor: string; count: number }>;
}

function createMomentTocIndex(toc: MomentToc): MomentTocIndex {
  const anchors = new Map<string, Set<string>>();
  const paths = new Map<string, { anchor: string; count: number }>();
  for (const entry of toc) {
    const anchorPaths = anchors.get(entry.id);
    if (anchorPaths === undefined) {
      anchors.set(entry.id, new Set([entry.path]));
    } else {
      anchorPaths.add(entry.path);
    }

    const path = paths.get(entry.path);
    paths.set(entry.path, {
      anchor: path?.anchor ?? entry.id,
      count: (path?.count ?? 0) + 1,
    });
  }
  return { anchors, paths };
}

function resolveMomentTarget(
  row: StoredMomentBrowseRow,
  toc: MomentTocIndex | undefined,
): Pick<MomentBrowseRow, "targetAnchor" | "targetStatus"> {
  if (toc === undefined) {
    return staleMomentTarget();
  }

  if (toc.anchors.get(row.sectionAnchor)?.has(row.sectionPath) === true) {
    return { targetAnchor: row.sectionAnchor, targetStatus: "current" };
  }

  const path = toc.paths.get(row.sectionPath);
  if (path?.count === 1) {
    return { targetAnchor: path.anchor, targetStatus: "resolved_from_path" };
  }

  return staleMomentTarget();
}

function staleMomentTarget(): Pick<
  MomentBrowseRow,
  "targetAnchor" | "targetStatus"
> {
  return { targetAnchor: null, targetStatus: "stale" };
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
