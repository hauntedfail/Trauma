import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: vi.fn((input: unknown) => `${name}:${JSON.stringify(input)}`),
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);
vi.mock("~/server/memories/browse", () => ({
  loadBrowseMemoryPage: vi.fn(),
}));
vi.mock("~/server/taxonomy/browse", () => ({
  loadBrowseTaxonomy: vi.fn(),
}));

const browseLoader = await import(
  "../../src/components/memories/browse-loader"
);
const {
  getBrowseMemoryPage,
  getBrowseTaxonomy,
  revalidateBrowseMemoryFirstPage,
  revalidateBrowseMemoryPages,
  revalidateBrowseMemoryWorkspace,
  revalidateBrowseTaxonomy,
} = browseLoader;

describe("browse loader", () => {
  const getBrowseMemoryPageKeyFor = getBrowseMemoryPage.keyFor as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerMocks.revalidate.mockReset();
    getBrowseMemoryPageKeyFor.mockClear();
  });

  it("does not expose the retired unbounded browse memories query", () => {
    expect("getBrowseMemories" in browseLoader).toBe(false);
    expect("revalidateBrowseMemories" in browseLoader).toBe(false);
  });

  it("revalidates the browse memory page query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBrowseMemoryPages();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getBrowseMemoryPage.key,
    );
  });

  it("revalidates the first browse memory page query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBrowseMemoryFirstPage();

    expect(getBrowseMemoryPageKeyFor).toHaveBeenCalledExactlyOnceWith({
      query: {
        q: "",
        category: "",
        tag: "",
        flashback: "",
        view: "list",
      },
      cursor: null,
      limit: 30,
    });
    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      'browse-memory-page:{"query":{"q":"","category":"","tag":"","flashback":"","view":"list"},"cursor":null,"limit":30}',
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

    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseMemoryPage.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(getBrowseTaxonomy.key);
    expect(routerMocks.revalidate).toHaveBeenCalledTimes(2);
  });
});
