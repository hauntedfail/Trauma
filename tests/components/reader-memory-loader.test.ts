import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: (memoryId: string) => `${name}:${memoryId}`,
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);
vi.mock("~/server/reader/page-data", () => ({
  loadReaderMemory: vi.fn(),
}));

const { getReaderMemory, revalidateReaderMemory } = await import(
  "../../src/components/reader/reader-memory-loader"
);

describe("reader memory loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates one reader cache entry when a memory id is provided", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateReaderMemory("memory-1");

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getReaderMemory.keyFor("memory-1"),
    );
  });

  it("revalidates the whole reader query cache when no id is provided", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateReaderMemory();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getReaderMemory.key,
    );
  });
});
