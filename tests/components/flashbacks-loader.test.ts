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
  loadFlashbackBrowseRows: vi.fn(),
}));

const { getFlashbackBrowseRows, revalidateFlashbackBrowseRows } = await import(
  "../../src/components/flashbacks/flashbacks-loader"
);

describe("flashbacks loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates the Flashback browse query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateFlashbackBrowseRows();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getFlashbackBrowseRows.key,
    );
  });
});
