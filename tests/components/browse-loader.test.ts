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
vi.mock("~/server/memories/browse", () => ({
  loadBrowseMemories: vi.fn(),
}));
vi.mock("~/server/taxonomy/browse", () => ({
  loadBrowseTaxonomy: vi.fn(),
}));

const {
  getBrowseMemories,
  getBrowseTaxonomy,
  revalidateBrowseMemories,
  revalidateBrowseMemoryWorkspace,
  revalidateBrowseTaxonomy,
} = await import(
  "../../src/components/memories/browse-loader"
);

describe("browse loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates the browse memories query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBrowseMemories();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getBrowseMemories.key,
    );
  });

  it("revalidates the taxonomy query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBrowseTaxonomy();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getBrowseTaxonomy.key,
    );
  });

  it("revalidates the browse workspace caches together", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBrowseMemoryWorkspace();

    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseMemories.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseTaxonomy.key);
  });
});
