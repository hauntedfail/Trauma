import { describe, expect, it } from "vitest";

import {
  computeVisibleTocRange,
  type HeadingPosition,
} from "../../src/components/reader/toc-reading-range";

function headings(
  ...entries: ReadonlyArray<[id: string, top: number]>
): HeadingPosition[] {
  return entries.map(([id, top]) => ({ id, top }));
}

describe("computeVisibleTocRange", () => {
  const viewport = 800;

  it("returns an empty range when there are no headings", () => {
    const result = computeVisibleTocRange([], viewport);
    expect(result.rangeIds).toEqual([]);
    expect(result.leadId).toBeUndefined();
  });

  it("treats the only heading's section as visible while it owns the screen", () => {
    const result = computeVisibleTocRange(headings(["intro", 0]), viewport);
    expect(result.rangeIds).toEqual(["intro"]);
    expect(result.leadId).toBe("intro");
  });

  it("tracks every section currently rendered on screen, not one chapter", () => {
    // c1 has scrolled fully above the viewport (its section ends at -100);
    // c2 and c3 are both on screen.
    const result = computeVisibleTocRange(
      headings(["c1", -500], ["c2", -100], ["c3", 300]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["c2", "c3"]);
    expect(result.leadId).toBe("c2");
  });

  it("excludes a chapter whose section has scrolled off the top", () => {
    const result = computeVisibleTocRange(
      headings(["c1", -900], ["c2", -200], ["c3", 50]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["c2", "c3"]);
  });

  it("includes a chapter still partly visible at the top edge", () => {
    // c1's section spans [-50, 200): its tail is still on screen.
    const result = computeVisibleTocRange(
      headings(["c1", -50], ["c2", 200], ["c3", 600]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["c1", "c2", "c3"]);
    expect(result.leadId).toBe("c1");
  });

  it("excludes a heading that starts below the viewport", () => {
    const result = computeVisibleTocRange(
      headings(["c1", 100], ["c2", 900]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["c1"]);
  });

  it("treats the bottom edge as exclusive", () => {
    const result = computeVisibleTocRange(
      headings(["c1", 0], ["c2", 800]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["c1"]);
  });

  it("returns a contiguous range with the topmost entry as lead", () => {
    const result = computeVisibleTocRange(
      headings(["a", 50], ["b", 250], ["c", 500]),
      viewport,
    );
    expect(result.rangeIds).toEqual(["a", "b", "c"]);
    expect(result.leadId).toBe("a");
  });
});
