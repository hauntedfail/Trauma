import { describe, expect, it, vi } from "vitest";

import {
  MAX_FLASHBACK_PAGE_SCAN_BATCHES,
  collectFlashbackBrowsePage,
  filterRenderableFlashbackRowsByVariant,
} from "../../../src/server/flashbacks/browse";
import {
  collectMomentBrowsePage,
  resolveMomentTargetsByMemory,
} from "../../../src/server/moments/browse";
import type {
  FlashbackBrowseCursor,
  FlashbackBrowseRow,
  MomentBrowseCursor,
  MomentBrowseRow as StoredMomentBrowseRow,
} from "../../../src/server/db/repositories";

describe("bounded collection browse pages", () => {
  it("caps raw Flashback scan batches and advances after an empty renderable page", async () => {
    const rawRows = Array.from({ length: 20 }, (_, index) =>
      flashbackRow(index + 1),
    );
    const listRows = vi.fn(
      async (input: { cursor: FlashbackBrowseCursor | null; limit: number }) =>
        listAfterCursor(rawRows, input),
    );
    const filterRows = vi.fn(
      async (_rows: FlashbackBrowseRow[]) => [] as FlashbackBrowseRow[],
    );

    const page = await collectFlashbackBrowsePage({
      cursor: null,
      filterRows,
      limit: 2,
      listRows,
    });

    expect(page.rows).toEqual([]);
    expect(listRows).toHaveBeenCalledTimes(MAX_FLASHBACK_PAGE_SCAN_BATCHES);
    expect(listRows.mock.calls.every((call) => call[0].limit === 2)).toBe(true);
    expect(filterRows.mock.calls.flatMap((call) => call[0])).toHaveLength(
      2 * MAX_FLASHBACK_PAGE_SCAN_BATCHES,
    );
    expect(page.nextCursor).toEqual({
      createdAt: new Date(rawRows[7]!.createdAt),
      id: rawRows[7]!.id,
    });
  });

  it("fills a Flashback page after stale rows without omitting the next stable row", async () => {
    const rawRows = Array.from({ length: 6 }, (_, index) =>
      flashbackRow(index + 1),
    );
    const page = await collectFlashbackBrowsePage({
      cursor: null,
      filterRows: async (rows) =>
        rows.filter((row) => Number(row.id.split("-")[1]) > 2),
      limit: 2,
      listRows: async (input) => listAfterCursor(rawRows, input),
    });

    expect(page.rows.map((row) => row.id)).toEqual(["flashback-3", "flashback-4"]);
    expect(page.nextCursor).toEqual({
      createdAt: new Date(rawRows[3]!.createdAt),
      id: "flashback-4",
    });
  });

  it("limits Moment target resolution candidates to one SQL page", async () => {
    const rawRows = Array.from({ length: 12 }, (_, index) => momentRow(index + 1));
    const listRows = vi.fn(
      async (input: { cursor: MomentBrowseCursor | null; limit: number }) =>
        listAfterCursor(rawRows, input),
    );
    const resolveRows = vi.fn(async (rows: StoredMomentBrowseRow[]) =>
      rows.map((row) => ({
        ...row,
        targetAnchor: row.sectionAnchor,
        targetStatus: "current" as const,
      })),
    );

    const page = await collectMomentBrowsePage({
      cursor: null,
      limit: 3,
      listRows,
      resolveRows,
    });

    expect(listRows).toHaveBeenCalledOnce();
    expect(listRows).toHaveBeenCalledWith({ cursor: null, limit: 3 });
    expect(resolveRows).toHaveBeenCalledOnce();
    expect(resolveRows.mock.calls[0]?.[0]).toHaveLength(3);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toEqual({
      createdAt: new Date(rawRows[2]!.createdAt),
      id: rawRows[2]!.id,
    });
  });

  it("reads each distinct Flashback variant at most once per raw batch", async () => {
    const rows = [
      flashbackRow(1),
      flashbackRow(2),
      {
        ...flashbackRow(3),
        variantKind: "translation" as const,
        langCode: "ja-JP" as const,
        translationOutputHash: "sha256:" + "a".repeat(64),
      },
    ];
    const resolveVariantRows = vi.fn(async (variantRows: FlashbackBrowseRow[]) =>
      new Set(variantRows.map((row) => row.id)),
    );

    const filtered = await filterRenderableFlashbackRowsByVariant({
      resolveVariantRows,
      rows,
    });

    expect(filtered).toEqual(rows);
    expect(resolveVariantRows).toHaveBeenCalledTimes(2);
    expect(resolveVariantRows.mock.calls.map((call) => call[0].length)).toEqual([2, 1]);
  });

  it("reads one Moment TOC per distinct memory in the bounded SQL page", async () => {
    const rows = [momentRow(1), momentRow(2), { ...momentRow(3), memoryId: "memory-1" }];
    const loadToc = vi.fn(async (_memoryId: string) => undefined);

    const resolved = await resolveMomentTargetsByMemory({ loadToc, rows });

    expect(resolved).toHaveLength(3);
    expect(resolved.every((row) => row.targetStatus === "stale")).toBe(true);
    expect(loadToc).toHaveBeenCalledTimes(2);
    expect(new Set(loadToc.mock.calls.map((call) => call[0]))).toEqual(
      new Set(["memory-1", "memory-2"]),
    );
  });
});

function listAfterCursor<Row extends { createdAt: string; id: string }>(
  rows: Row[],
  input: {
    cursor: { createdAt: Date; id: string } | null;
    limit: number;
  },
): Row[] {
  const start = input.cursor === null
    ? 0
    : rows.findIndex(
        (row) =>
          row.id === input.cursor?.id &&
          row.createdAt === input.cursor.createdAt.toISOString(),
      ) + 1;
  return rows.slice(start, start + input.limit);
}

function flashbackRow(index: number): FlashbackBrowseRow {
  return {
    id: `flashback-${index}`,
    memoryId: "memory-1",
    memoryTitle: "Memory One",
    variantKind: "source",
    langCode: null,
    translationOutputHash: null,
    text: `selected ${index}`,
    prefix: "before ",
    suffix: " after",
    startOffset: index,
    endOffset: index + 10,
    contentHash: null,
    createdAt: new Date(Date.UTC(2026, 6, 17, 0, 0, 20 - index)).toISOString(),
  };
}

function momentRow(index: number): StoredMomentBrowseRow {
  return {
    id: `moment-${index}`,
    memoryId: `memory-${index}`,
    memoryTitle: `Memory ${index}`,
    memoryUrl: `https://example.com/${index}`,
    sectionAnchor: `section-${index}`,
    sectionTitle: `Section ${index}`,
    sectionLevel: 2,
    sectionPath: `1/${index}`,
    sectionStartOffset: null,
    sectionEndOffset: null,
    contentHash: null,
    createdAt: new Date(Date.UTC(2026, 6, 17, 0, 0, 20 - index)).toISOString(),
  };
}
