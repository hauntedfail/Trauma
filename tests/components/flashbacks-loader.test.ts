import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: (...args: unknown[]) => `${name}:${JSON.stringify(args)}`,
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);
vi.mock("~/server/flashbacks/browse", () => ({
  loadBrowseFlashbacksForMemories: vi.fn(),
  loadFlashbackBrowsePage: vi.fn(),
  loadFlashbackBrowseRows: vi.fn(),
  loadRecentFlashbackBrowseRows: vi.fn(),
}));

const {
  getBrowseFlashbacksForMemories,
  getFlashbackBrowsePage,
  getFlashbackBrowseRows,
  getRecentFlashbackBrowseRows,
  revalidateFlashbackBrowsePage,
  revalidateFlashbackBrowseRows,
} = await import("../../src/components/flashbacks/flashbacks-loader");

describe("flashbacks loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates paged, legacy, recent, and memory-card query caches", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateFlashbackBrowseRows();

    expect(routerMocks.revalidate).toHaveBeenCalledWith(getFlashbackBrowsePage.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getFlashbackBrowseRows.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getRecentFlashbackBrowseRows.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseFlashbacksForMemories.key);
  });

  it("revalidates only the requested page cursor for an in-place retry", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateFlashbackBrowsePage("opaque-cursor");

    expect(routerMocks.revalidate).toHaveBeenCalledOnce();
    expect(routerMocks.revalidate).toHaveBeenCalledWith(
      'flashback-browse-page:[{"cursor":"opaque-cursor"}]',
    );
  });
});
