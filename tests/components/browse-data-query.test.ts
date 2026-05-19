import { describe, expect, it } from "vitest";

import {
  filterBrowseMemories,
  getBrowseSearchFieldValues,
  toggleBrowseSearchFieldFilter,
  type BrowseMemory,
} from "../../src/components/memories/browse-data";

const baseMemory = {
  id: "memory-1",
  title: "Reader Mode Notes",
  url: "https://example.com/reader",
  description: "Reader description",
  capturedAt: "2026-05-18T00:00:00.000Z",
  read: false,
  extractionStatus: "success",
  categories: [],
  tags: [],
  flashbacks: [],
} satisfies BrowseMemory;

describe("browse fielded query filters", () => {
  it("toggles later multi-word taxonomy tokens instead of preserving them", () => {
    expect(
      toggleBrowseSearchFieldFilter(
        "tag={Research Notes} tag={Product Ideas}",
        {
          field: "tag",
          value: "Product Ideas",
        },
      ),
    ).toBe("tag={Research Notes}");
  });

  it("keeps ampersands inside braced taxonomy values", () => {
    expect(getBrowseSearchFieldValues("tag={R&D}", "tag")).toEqual(["R&D"]);
    expect(
      toggleBrowseSearchFieldFilter("tag={R&D}", {
        field: "tag",
        value: "R&D",
      }),
    ).toBe("");
  });

  it("escapes closing braces inside braced taxonomy values", () => {
    expect(
      toggleBrowseSearchFieldFilter("reader", {
        field: "tag",
        value: "A}B",
      }),
    ).toBe("reader tag={A\\}B}");
    expect(getBrowseSearchFieldValues("reader tag={A\\}B}", "tag")).toEqual([
      "A}B",
    ]);
    expect(
      toggleBrowseSearchFieldFilter("reader tag={A\\}B}", {
        field: "tag",
        value: "A}B",
      }),
    ).toBe("reader");
  });

  it("matches fielded taxonomy filters exactly", () => {
    const memories = [
      {
        ...baseMemory,
        id: "research",
        categories: [{ id: "category-research", name: "Research" }],
      },
      {
        ...baseMemory,
        id: "research-notes",
        categories: [{ id: "category-research-notes", name: "Research Notes" }],
      },
    ] satisfies BrowseMemory[];

    expect(
      filterBrowseMemories(memories, {
        q: "category=Research",
        category: "",
        tag: "",
        flashback: "",
        view: "list",
      }).map((memory) => memory.id),
    ).toEqual(["research"]);
  });

  it("parses field operators with locale-invariant casing", () => {
    expect(
      filterBrowseMemories([baseMemory], {
        q: "TITLE:{Reader Mode}",
        category: "",
        tag: "",
        flashback: "",
        view: "list",
      }).map((memory) => memory.id),
    ).toEqual(["memory-1"]);
  });
});
