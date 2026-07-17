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
vi.mock("~/server/moments/browse", () => ({
  loadMomentBrowsePage: vi.fn(),
  loadMomentBrowseRows: vi.fn(),
}));

const {
  revalidateMomentBrowsePage,
} = await import("../../src/components/moments/moments-loader");

describe("moments loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates only the requested page cursor for an in-place retry", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateMomentBrowsePage(null);

    expect(routerMocks.revalidate).toHaveBeenCalledOnce();
    expect(routerMocks.revalidate).toHaveBeenCalledWith(
      'moment-browse-page:[{"cursor":null}]',
    );
  });
});
