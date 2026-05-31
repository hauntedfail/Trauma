import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: () => name,
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);
vi.mock("~/server/flashbacks/browse", () => ({
  loadBrowseFlashbacksForMemories: vi.fn(),
  loadFlashbackBrowseRows: vi.fn(),
  loadRecentFlashbackBrowseRows: vi.fn(),
}));

const {
  getBrowseFlashbacksForMemories,
  getFlashbackBrowseRows,
  getRecentFlashbackBrowseRows,
  revalidateFlashbackBrowseRows,
} = await import("../../src/components/flashbacks/flashbacks-loader");

describe("flashbacks loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates Flashback browse, recent, and memory-card query caches", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateFlashbackBrowseRows();

    expect(routerMocks.revalidate).toHaveBeenCalledWith(getFlashbackBrowseRows.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getRecentFlashbackBrowseRows.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseFlashbacksForMemories.key);
  });
});
