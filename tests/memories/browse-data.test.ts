import { describe, expect, it } from "vitest";

import {
  buildBrowseHref,
  buildHighlightBrowseHref,
  filterBrowseMemories,
  getMemoryDisplayHighlight,
  getMemoryReaderHighlights,
  getRecentHighlights,
  parseBrowseQuery,
  type BrowseMemory,
} from "../../src/components/memories/browse-data";
import { browseFixtureMemories } from "../../src/components/memories/browse-fixtures";

const fixtures: BrowseMemory[] = [
  {
    id: "memory-foundation",
    title: "Reader Mode Notes",
    url: "https://example.com/reader-mode",
    description: "SolidStart route data and shell architecture notes.",
    capturedAt: "2026-05-09",
    read: false,
    extractionStatus: "success",
    categories: [{ id: "research", name: "Research" }],
    tags: [{ id: "solidstart", name: "solidstart" }],
    highlights: [
      {
        id: "h-foundation",
        text: "highlight-aware results",
        prefix: "Search query can be wired to",
        suffix: "through repository fixtures.",
        createdAt: "2026-05-09T12:00:00.000Z",
      },
    ],
  },
  {
    id: "memory-ops",
    title: "Local Hosting Checklist",
    url: "https://example.com/local-hosting",
    description: "Single Bun process and persistent disk assumptions.",
    capturedAt: "2026-05-08",
    read: false,
    extractionStatus: "success",
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

  it("trims all text query values before applying filters", () => {
    const query = parseBrowseQuery("?q=%20reader%20&category=%20research%20&tag=%20%20&highlight=%20h-foundation%20");

    expect(query).toEqual({
      q: "reader",
      category: "research",
      tag: "",
      highlight: "h-foundation",
      view: "list",
    });
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

  it("builds canonical highlight shortcut hrefs without incompatible taxonomy filters", () => {
    expect(buildHighlightBrowseHref("h-foundation")).toBe("/memories?highlight=h-foundation");
  });

  it("filters memory metadata and highlight context without full body search", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=highlight-aware"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?category=operations"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&highlight=h-foundation"))).toHaveLength(
      1,
    );
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&highlight=missing"))).toHaveLength(0);
  });

  it("selects the active highlight for memory result excerpts", () => {
    const memory: BrowseMemory = {
      ...fixtures[0]!,
      highlights: [
        {
          id: "h-first",
          text: "first highlight",
          prefix: "first",
          suffix: "context",
          createdAt: "2026-05-09T10:00:00.000Z",
        },
        {
          id: "h-selected",
          text: "selected highlight",
          prefix: "selected",
          suffix: "context",
          createdAt: "2026-05-09T11:00:00.000Z",
        },
      ],
    };

    expect(getMemoryDisplayHighlight(memory, "h-selected")?.text).toBe("selected highlight");
    expect(getMemoryDisplayHighlight(memory, "")?.text).toBe("first highlight");
  });

  it("sorts recent highlight shortcuts globally by highlight creation time", () => {
    const memories: BrowseMemory[] = [
      {
        ...fixtures[0]!,
        capturedAt: "2026-05-10",
        highlights: [
          {
            id: "h-newer-memory-old-highlight",
            text: "older highlight on newer memory",
            prefix: "new memory",
            suffix: "old highlight",
            createdAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
      {
        ...fixtures[1]!,
        capturedAt: "2026-05-01",
        highlights: [
          {
            id: "h-older-memory-new-highlight",
            text: "newer highlight on older memory",
            prefix: "old memory",
            suffix: "new highlight",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
      },
    ];

    expect(getRecentHighlights(memories).map((highlight) => highlight.id)).toEqual([
      "h-older-memory-new-highlight",
      "h-newer-memory-old-highlight",
    ]);
  });

  it("exposes reader highlight anchors for memory routes", () => {
    expect(getMemoryReaderHighlights(fixtures[0]!).map((highlight) => highlight.anchorId)).toEqual(["h-foundation"]);
  });

  it("keeps browse fixtures representative of memories without highlights", () => {
    expect(browseFixtureMemories.some((memory) => memory.highlights.length === 0)).toBe(true);
    expect(getRecentHighlights(browseFixtureMemories).map((highlight) => highlight.id)).toEqual([
      "h-foundation",
      "h-ops",
      "h-shell",
    ]);
  });
});
