import { describe, expect, it } from "vitest";

import {
  buildBrowseHref,
  buildFlashbackBrowseHref,
  filterBrowseMemories,
  getBrowseReadStateFilter,
  getBrowseSearchFieldValues,
  getMemoryDisplayFlashback,
  getMemoryReaderFlashbacks,
  getRecentFlashbacks,
  parseBrowseQuery,
  setBrowseReadStateFilter,
  toggleBrowseSearchFieldFilter,
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
    tags: [
      { id: "solidstart", name: "solidstart" },
      { id: "reader", name: "reader" },
    ],
    flashbacks: [
      {
        id: "h-foundation",
        memoryId: "memory-foundation",
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
    read: true,
    extractionStatus: "success",
    categories: [{ id: "operations", name: "Operations" }],
    tags: [{ id: "sqlite", name: "sqlite" }],
    flashbacks: [],
  },
];

describe("browse query state", () => {
  it("parses supported query state and ignores legacy view state", () => {
    const query = parseBrowseQuery("?q=reader&category=research&tag=solidstart&flashback=h-foundation&view=grid");

    expect(query).toEqual({
      q: "reader",
      category: "research",
      tag: "solidstart",
      flashback: "h-foundation",
      view: "list",
    });

    expect(parseBrowseQuery("?view=table").view).toBe("list");
  });

  it("preserves raw search text while trimming explicit filter values", () => {
    const query = parseBrowseQuery("?q=%20reader%20&category=%20research%20&tag=%20%20&flashback=%20h-foundation%20");

    expect(query).toEqual({
      q: " reader ",
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

  it("builds canonical memories hrefs while ignoring legacy view filters", () => {
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

    expect(href).toBe("/memories?q=reader+mode&category=research&tag=solidstart");
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

  it("filters fielded search terms inside the q parameter", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=title:{Reader Mode}")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=url:{local-hosting}")).map((memory) => memory.id)).toEqual([
      "memory-ops",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=tag:sqlite")).map((memory) => memory.id)).toEqual([
      "memory-ops",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=category:{Research}")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=flashback:{repository fixtures}")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
  });

  it("filters fielded search terms with equals syntax and ampersand value conjunctions", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=tag=sqlite")).map((memory) => memory.id)).toEqual([
      "memory-ops",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=tag=solidstart%26reader")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=tag=solidstart%26sqlite"))).toHaveLength(0);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=category=Research")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
  });

  it("updates search text filters without merging adjacent query text", () => {
    expect(
      toggleBrowseSearchFieldFilter("test tag=test", {
        field: "tag",
        value: "kebab",
      }),
    ).toBe("test tag=test&kebab");
    expect(
      toggleBrowseSearchFieldFilter("test tag=test", {
        field: "category",
        value: "music",
      }),
    ).toBe("test tag=test category=music");
    expect(
      toggleBrowseSearchFieldFilter("test tag=test&kebab", {
        field: "tag",
        value: "test",
      }),
    ).toBe("test tag=kebab");
  });

  it("exposes field values from search text for active right-rail filter state", () => {
    expect(getBrowseSearchFieldValues("test tag=test&kebab category=music", "tag")).toEqual([
      "test",
      "kebab",
    ]);
    expect(getBrowseSearchFieldValues("test tag=test&kebab category=music", "category")).toEqual([
      "music",
    ]);
  });

  it("filters read state tokens and treats mutually exclusive states as empty", () => {
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=read")).map((memory) => memory.id)).toEqual([
      "memory-ops",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=unread")).map((memory) => memory.id)).toEqual([
      "memory-foundation",
    ]);
    expect(filterBrowseMemories(fixtures, parseBrowseQuery("?q=read+unread"))).toHaveLength(0);
  });

  it("derives read-state tab state from readable search tokens", () => {
    expect(getBrowseReadStateFilter("")).toBe("all");
    expect(getBrowseReadStateFilter("reader read")).toBe("read");
    expect(getBrowseReadStateFilter("reader unread")).toBe("unread");
    expect(getBrowseReadStateFilter("reader read unread")).toBe("all");
  });

  it("updates read-state tokens without disturbing other search filters", () => {
    expect(setBrowseReadStateFilter("reader tag=solidstart unread", "read")).toBe(
      "reader tag=solidstart read",
    );
    expect(setBrowseReadStateFilter("reader read tag=sqlite", "all")).toBe(
      "reader tag=sqlite",
    );
    expect(setBrowseReadStateFilter("title:{Read later} unread", "all")).toBe(
      "title:{Read later}",
    );
    expect(setBrowseReadStateFilter("reader", "unread")).toBe("reader unread");
  });

  it("combines free-text, fielded search, and explicit right-rail filters with AND semantics", () => {
    expect(
      filterBrowseMemories(fixtures, parseBrowseQuery("?q=route+tag:solidstart&category=research"))
        .map((memory) => memory.id),
    ).toEqual(["memory-foundation"]);
    expect(
      filterBrowseMemories(fixtures, parseBrowseQuery("?q=route+tag:sqlite&category=research")),
    ).toHaveLength(0);
  });

  it("selects the active flashback for memory result excerpts", () => {
    const memory: BrowseMemory = {
      ...fixtures[0]!,
      flashbacks: [
        {
          id: "h-first",
          memoryId: "memory-foundation",
          text: "first flashback",
          prefix: "first",
          suffix: "context",
          createdAt: "2026-05-09T10:00:00.000Z",
        },
        {
          id: "h-selected",
          memoryId: "memory-foundation",
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
            memoryId: "memory-foundation",
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
            memoryId: "memory-ops",
            text: "newer flashback on older memory",
            prefix: "old memory",
            suffix: "new flashback",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
      },
    ];

    expect(getRecentFlashbacks(memories).map((flashback) => [flashback.id, flashback.memoryId])).toEqual([
      ["h-older-memory-new-flashback", "memory-ops"],
      ["h-newer-memory-old-flashback", "memory-foundation"],
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
