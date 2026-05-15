import { createSignal, type JSX } from "solid-js";
import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  attachReaderCategoryByName,
  deleteReaderMemory,
  MemoryReader,
} from "../../src/components/reader/MemoryReader";
import { RightRailContentContext } from "../../src/components/shell/right-rail-context";
import type { ReaderMemoryResult } from "../../src/server/reader/page-data";

const readyResult = {
  status: "ready",
  memory: {
    id: "memory-reader",
    url: "https://example.com/reader",
    title: "Reader Memory",
    description: "Reader description",
    faviconUrl: null,
    extractionStatus: "success",
    contentPath: "memories/memory-reader/CONTENT.md",
    read: true,
    categories: [{ id: "category-reader", name: "Reader" }],
    flashbacks: [],
    tags: [{ id: "tag-solid", name: "solid" }],
    highlights: [
      {
        id: "highlight-1",
        text: "highlight",
        prefix: "A ",
        suffix: ".",
        startOffset: 2,
        endOffset: 11,
        createdAt: "2026-05-09T00:00:00.000Z",
      },
    ],
    createdAt: new Date("2026-05-09T00:00:00.000Z"),
    updatedAt: new Date("2026-05-09T00:00:00.000Z"),
  },
  content: {
    relativePath: "memories/memory-reader/CONTENT.md",
  },
  rendered: {
    html: '<h1 id="reader-memory">Reader Memory</h1><p>A <mark data-highlight-id="highlight-1" id="highlight-1">highlight</mark>.</p>',
    toc: [{ id: "reader-memory", level: 1, path: "1", text: "Reader Memory" }],
  },
} satisfies ReaderMemoryResult;

describe("memory reader actions", () => {
  it("renders shared actions, read status, attached taxonomy, and existing highlights", () => {
    const html = renderReader(readyResult);

    expect(html).toContain("Memory actions for Reader Memory");
    expect(html).toContain("Read");
    expect(html).toContain("Mark unread");
    expect(html).toContain("Reader");
    expect(html).toContain("solid");
    expect(html).toContain('data-highlight-id="highlight-1"');
    expect(html).not.toContain("Global category");
    expect(html).not.toContain("#global");
  });

  it("does not render empty attached taxonomy sections", () => {
    const html = renderReader({
      ...readyResult,
      memory: {
        ...readyResult.memory,
        categories: [],
        highlights: [],
        tags: [],
      },
    });

    expect(html).not.toContain("No categories");
    expect(html).not.toContain("No tags");
  });

  it("deletes the active memory and navigates back to memories", async () => {
    const requests: Request[] = [];
    const navigations: string[] = [];

    await deleteReaderMemory({
      memoryId: "memory-reader",
      navigate: (path) => navigations.push(path),
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-reader", "DELETE"],
    ]);
    expect(navigations).toEqual(["/memories"]);
  });

  it("keeps the reader on the current page when delete fails", async () => {
    const navigations: string[] = [];

    await expect(
      deleteReaderMemory({
        memoryId: "memory-reader",
        navigate: (path) => navigations.push(path),
        fetch: async () => new Response(null, { status: 500 }),
      }),
    ).rejects.toThrow("failed to delete memory");

    expect(navigations).toEqual([]);
  });

  it("attaches a category by name through the memory category API", async () => {
    const requests: Request[] = [];

    const category = await attachReaderCategoryByName({
      memoryId: "memory-reader",
      name: "Research",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(
          JSON.stringify({
            category: { id: "category-research", name: "Research" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(category).toEqual({ id: "category-research", name: "Research" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/categories", "POST"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-reader",
      name: "Research",
    });
  });
});

function renderReader(result: ReaderMemoryResult): string {
  return renderToString(() => {
    const [rightRailContent, setRightRailContent] =
      createSignal<JSX.Element | undefined>();

    return createComponent(RightRailContentContext.Provider, {
      value: {
        rightRailContent,
        setRightRailContent,
      },
      get children() {
        return createComponent(MemoryReader, {
          highlightRows: [],
          navigate: () => {},
          result,
        });
      },
    });
  });
}
