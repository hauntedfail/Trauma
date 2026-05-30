import { describe, expect, it } from "vitest";

import type { ReaderTocEntry } from "../../src/server/reader/markdown-renderer";
import {
  computeActiveTocRange,
  resolveActiveHeadingId,
} from "../../src/components/reader/toc-reading-range";

function entry(
  id: string,
  level: number,
  text = id,
): ReaderTocEntry {
  return { id, level, path: id, text };
}

describe("resolveActiveHeadingId", () => {
  it("returns undefined when there are no headings", () => {
    expect(resolveActiveHeadingId([], 100)).toBeUndefined();
  });

  it("returns undefined when the reading line is above the first heading", () => {
    const headings = [
      { id: "a", top: 200 },
      { id: "b", top: 400 },
    ];
    expect(resolveActiveHeadingId(headings, 100)).toBeUndefined();
  });

  it("returns the last heading that has crossed the reading line", () => {
    const headings = [
      { id: "a", top: 0 },
      { id: "b", top: 150 },
      { id: "c", top: 600 },
    ];
    expect(resolveActiveHeadingId(headings, 300)).toBe("b");
  });

  it("breaks ties toward the later heading at exact boundary offsets", () => {
    const headings = [
      { id: "a", top: 100 },
      { id: "b", top: 200 },
    ];
    expect(resolveActiveHeadingId(headings, 200)).toBe("b");
  });

  it("keeps the last heading active when scrolled past everything", () => {
    const headings = [
      { id: "a", top: -500 },
      { id: "b", top: -200 },
    ];
    expect(resolveActiveHeadingId(headings, 100)).toBe("b");
  });
});

describe("computeActiveTocRange", () => {
  const toc: ReaderTocEntry[] = [
    entry("intro", 1),
    entry("chapter-1", 1),
    entry("c1-sub-a", 2),
    entry("c1-sub-b", 2),
    entry("c1-sub-b-1", 3),
    entry("chapter-2", 1),
    entry("c2-sub-a", 2),
  ];

  it("returns an empty range when no heading is active", () => {
    const result = computeActiveTocRange(toc, undefined);
    expect(result.activeId).toBeUndefined();
    expect(result.chapterId).toBeUndefined();
    expect(result.rangeIds).toEqual([]);
  });

  it("returns an empty range for an empty toc", () => {
    expect(computeActiveTocRange([], "x").rangeIds).toEqual([]);
  });

  it("highlights the chapter and all associated subtitles for an active subtitle", () => {
    const result = computeActiveTocRange(toc, "c1-sub-b");
    expect(result.activeId).toBe("c1-sub-b");
    expect(result.chapterId).toBe("chapter-1");
    expect(result.rangeIds).toEqual([
      "chapter-1",
      "c1-sub-a",
      "c1-sub-b",
      "c1-sub-b-1",
    ]);
  });

  it("highlights the whole chapter band when the chapter heading is active", () => {
    const result = computeActiveTocRange(toc, "chapter-1");
    expect(result.chapterId).toBe("chapter-1");
    expect(result.rangeIds).toEqual([
      "chapter-1",
      "c1-sub-a",
      "c1-sub-b",
      "c1-sub-b-1",
    ]);
  });

  it("does not bleed into neighbouring chapters", () => {
    const result = computeActiveTocRange(toc, "c2-sub-a");
    expect(result.chapterId).toBe("chapter-2");
    expect(result.rangeIds).toEqual(["chapter-2", "c2-sub-a"]);
  });

  it("treats a lone top-level entry as a single-entry range", () => {
    const result = computeActiveTocRange(toc, "intro");
    expect(result.rangeIds).toEqual(["intro"]);
  });

  it("returns a single entry for a flat single-level toc", () => {
    const flat = [entry("a", 2), entry("b", 2), entry("c", 2)];
    const result = computeActiveTocRange(flat, "b");
    expect(result.chapterId).toBe("b");
    expect(result.rangeIds).toEqual(["b"]);
  });

  it("yields an empty range when the active id is not in the toc", () => {
    expect(computeActiveTocRange(toc, "missing").rangeIds).toEqual([]);
  });
});
