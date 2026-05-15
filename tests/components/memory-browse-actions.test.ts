import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteBrowseMemory,
  MemoryItem,
} from "../../src/components/memories/MemoryBrowse";
import type { BrowseMemory } from "../../src/components/memories/browse-data";

const memory = {
  id: "memory-1",
  title: "Imported Memory",
  url: "https://example.com/imported",
  description: "Imported description",
  capturedAt: "2026-05-14",
  read: false,
  extractionStatus: "success",
  categories: [{ id: "research", name: "Research" }],
  tags: [{ id: "sqlite", name: "sqlite" }],
  highlights: [],
} satisfies BrowseMemory;

describe("memory browse actions", () => {
  it("renders actions, read status, and attached taxonomy", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        selectedHighlightId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Memory actions for Imported Memory");
    expect(html).toContain("Unread");
    expect(html).toContain("Mark read");
    expect(html).toContain("Research");
    expect(html).toContain("sqlite");
    expect(html).toContain("Add tag");
    expect(html).not.toContain("saved");
  });

  it("renders link-only status without saved label", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory: {
          ...memory,
          extractionStatus: "link_only",
          tags: [],
        },
        selectedHighlightId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Link-only");
    expect(html).not.toContain("saved");
  });

  it("posts add-tag and add-category actions by name", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith("/tags")
            ? { tag: { id: "tag-runtime", name: "runtime" } }
            : { category: { id: "category-notes", name: "Notes" } },
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    expect(
      await attachTagToMemoryByName({
        memoryId: "memory-1",
        name: "runtime",
        fetch,
      }),
    ).toEqual({ id: "tag-runtime", name: "runtime" });
    expect(
      await attachCategoryToMemoryByName({
        memoryId: "memory-1",
        name: "Notes",
        fetch,
      }),
    ).toEqual({ id: "category-notes", name: "Notes" });
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      name: "runtime",
    });
    expect(await requests[1]?.json()).toEqual({
      memoryId: "memory-1",
      name: "Notes",
    });
  });

  it("posts memory deletion requests", async () => {
    const requests: Request[] = [];

    await deleteBrowseMemory({
      memoryId: "memory-1",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-1", "DELETE"],
    ]);
  });
});
