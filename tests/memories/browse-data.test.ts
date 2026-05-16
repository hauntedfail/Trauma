import { describe, expect, it } from "vitest";

import {
  buildBrowseHref,
  buildFlashbackBrowseHref,
  filterBrowseMemories,
  getMemoryDisplayFlashback,
  getMemoryReaderFlashbacks,
  getRecentFlashbacks,
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
    flashbacks: [
      {
        id: "h-foundation",
        text: "flashback-aware results",
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
    flashbacks: [],
  },
];

describe("browse query state", () => {
  it("parses supported query state and falls back to list view", () => {
    const query = parseBrowseQuery("?q=reader&category=research&tag=solidstart&flashback=h-foundation&view=grid");

    expect(query).toEqual({
      q: "reader",
      category: "research",
      tag: "solidstart",
      flashback: "h-foundation",
      view: "grid",
    });

    expect(parseBrowseQuery("?view=table").view).toBe("list");
  });

  it("trims all text query values before applying filters", () => {
    const query = parseBrowseQuery("?q=%20reader%20&category=%20research%20&tag=%20%20&flashback=%20h-foundation%20");

    expect(query).toEqual({
      q: "reader",
      category: "research",
      tag: "",
      flashback: "h-foundation",
      view: "list",
    });
  });

  it("preserves legacy highlight filters as flashback filters", () => {
    expect(parseBrowseQuery("?highlight=h-foundation").flashback).toBe("h-foundation");
    expect(parseBrowseQuery("?highlight=old&flashback=h-foundation").flashback).toBe("h-foundation");
  });

  it("builds canonical memories hrefs while preserving unrelated filters", () => {
    const href = buildBrowseHref(
      {
        q: "reader mode",
        category: "research",
        tag: "",
        flashback: "",
        view: "list",
      },
      { tag: "solidstart", view: "grid" },
    );

    expect(href).toBe("/memories?q=reader+mode&category=research&tag=solidstart&view=grid");
  });

  it("builds canonical flashback shortcut hrefs without incompatible taxonomy filters", () => {
    expect(buildFlashbackBrowseHref("h-foundation")).toBe("/memories?flashback=h-foundation");
  });

  it("filters memory metadata and flashback context without full body search", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=flashback-aware"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?category=operations"))).toHaveLength(1);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&flashback=h-foundation"))).toHaveLength(
      1,
    );
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?tag=solidstart&flashback=missing"))).toHaveLength(0);
  });

  it("selects the active flashback for memory result excerpts", () => {
    const memory: BrowseMemory = {
      ...fixtures[0]!,
      flashbacks: [
        {
          id: "h-first",
          text: "first flashback",
          prefix: "first",
          suffix: "context",
          createdAt: "2026-05-09T10:00:00.000Z",
        },
        {
          id: "h-selected",
          text: "selected flashback",
          prefix: "selected",
          suffix: "context",
          createdAt: "2026-05-09T11:00:00.000Z",
        },
      ],
    };

    expect(getMemoryDisplayFlashback(memory, "h-selected")?.text).toBe("selected flashback");
    expect(getMemoryDisplayFlashback(memory, "")?.text).toBe("first flashback");
  });

  it("sorts recent flashback shortcuts globally by flashback creation time", () => {
    const memories: BrowseMemory[] = [
      {
        ...fixtures[0]!,
        capturedAt: "2026-05-10",
        flashbacks: [
          {
            id: "h-newer-memory-old-flashback",
            text: "older flashback on newer memory",
            prefix: "new memory",
            suffix: "old flashback",
            createdAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
      {
        ...fixtures[1]!,
        capturedAt: "2026-05-01",
        flashbacks: [
          {
            id: "h-older-memory-new-flashback",
            text: "newer flashback on older memory",
            prefix: "old memory",
            suffix: "new flashback",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
      },
    ];

    expect(getRecentFlashbacks(memories).map((flashback) => flashback.id)).toEqual([
      "h-older-memory-new-flashback",
      "h-newer-memory-old-flashback",
    ]);
  });

  it("exposes reader flashback anchors for memory routes", () => {
    expect(getMemoryReaderFlashbacks(fixtures[0]!).map((flashback) => flashback.anchorId)).toEqual(["h-foundation"]);
  });

  it("keeps browse fixtures representative of memories without flashbacks", () => {
    expect(browseFixtureMemories.some((memory) => memory.flashbacks.length === 0)).toBe(true);
    expect(getRecentFlashbacks(browseFixtureMemories).map((flashback) => flashback.id)).toEqual([
      "h-foundation",
      "h-ops",
      "h-shell",
    ]);
  });
});
