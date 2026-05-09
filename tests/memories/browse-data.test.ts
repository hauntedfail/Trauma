import { describe, expect, it } from "vitest";

import {
  buildBrowseHref,
  filterBrowseMemories,
  parseBrowseQuery,
  type BrowseMemory,
} from "../../src/components/memories/browse-data";

const fixtures: BrowseMemory[] = [
  {
    id: "memory-foundation",
    title: "Reader Mode Notes",
    url: "https://example.com/reader-mode",
    description: "SolidStart route data and shell architecture notes.",
    capturedAt: "2026-05-09",
    categories: [{ id: "research", name: "Research" }],
    tags: [{ id: "solidstart", name: "solidstart" }],
    highlights: [
      {
        id: "h-foundation",
        text: "highlight-aware results",
        prefix: "Search query can be wired to",
        suffix: "through repository fixtures.",
      },
    ],
  },
  {
    id: "memory-ops",
    title: "Local Hosting Checklist",
    url: "https://example.com/local-hosting",
    description: "Single Bun process and persistent disk assumptions.",
    capturedAt: "2026-05-08",
    categories: [{ id: "operations", name: "Operations" }],
    tags: [{ id: "sqlite", name: "sqlite" }],
    highlights: [],
  },
];

describe("browse query state", () => {
  it("parses supported query state and falls back to list view", () => {
    const query = parseBrowseQuery("?q=reader&category=research&tag=solidstart&highlight=h-foundation&view=grid");

    expect(query).toEqual({
      q: "reader",
      category: "research",
      tag: "solidstart",
      highlight: "h-foundation",
      view: "grid",
    });

    expect(parseBrowseQuery("?view=table").view).toBe("list");
  });

  it("builds canonical memories hrefs while preserving unrelated filters", () => {
    const href = buildBrowseHref(
      {
        q: "reader mode",
        category: "research",
        tag: "",
        highlight: "",
        view: "list",
      },
      { tag: "solidstart", view: "grid" },
    );

    expect(href).toBe("/memories?q=reader+mode&category=research&tag=solidstart&view=grid");
  });

  it("filters memory metadata and highlight context without full body search", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=highlight-aware"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?category=operations"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&highlight=h-foundation"))).toHaveLength(
      1,
    );
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&highlight=missing"))).toHaveLength(0);
  });
});
