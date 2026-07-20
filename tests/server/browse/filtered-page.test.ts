import { describe, expect, it, vi } from "vitest";

import { collectFilteredCursorPage } from "../../../src/server/browse/filtered-page";

describe("collectFilteredCursorPage", () => {
  it("bounds all-filtered scans while preserving a continuation cursor", async () => {
    const loadPage = vi.fn(async ({ cursor }: { cursor: number | null }) => {
      const row = cursor ?? 0;
      return {
        rows: [row],
        nextCursor: row + 1,
      };
    });

    await expect(
      collectFilteredCursorPage<number, number>({
        cursor: null,
        filterRows: async () => [],
        limit: 1,
        loadPage,
        maxFetchRounds: 3,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: 3 });
    expect(loadPage).toHaveBeenCalledTimes(3);
  });

  it("fills the requested page across filtered source pages", async () => {
    const pages = new Map<number | null, { rows: number[]; nextCursor: number | null }>([
      [null, { rows: [1, 2], nextCursor: 2 }],
      [2, { rows: [3, 4], nextCursor: 4 }],
      [4, { rows: [5], nextCursor: null }],
    ]);

    await expect(
      collectFilteredCursorPage<number, number>({
        cursor: null,
        filterRows: async (rows) => rows.filter((row) => row % 2 === 1),
        limit: 3,
        loadPage: async ({ cursor }) => pages.get(cursor) ?? { rows: [], nextCursor: null },
        maxFetchRounds: 20,
      }),
    ).resolves.toEqual({ rows: [1, 3, 5], nextCursor: null });
  });
});
