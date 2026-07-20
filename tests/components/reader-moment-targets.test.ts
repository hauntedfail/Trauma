import { describe, expect, it } from "vitest";

import type { ReaderMomentItem } from "../../src/server/reader/page-data";
import type { ReaderTocEntry } from "../../src/server/reader/markdown-renderer";
import {
  collectResolvedReaderMomentTargetIds,
  resolveReaderMomentTarget,
} from "../../src/components/reader/reader-moment-targets";

describe("reader Moment target resolution", () => {
  it("preserves exact-anchor priority and unique-path fallback semantics", () => {
    const toc: ReaderTocEntry[] = [
      { id: "first", level: 2, path: "1/1", text: "First" },
      { id: "moved", level: 2, path: "1/2", text: "Moved" },
      { id: "duplicate-a", level: 2, path: "1/3", text: "Duplicate A" },
      { id: "duplicate-b", level: 2, path: "1/3", text: "Duplicate B" },
    ];

    expect(resolveReaderMomentTarget(moment("moved", "1/2"), toc)?.id).toBe(
      "moved",
    );
    expect(resolveReaderMomentTarget(moment("old-anchor", "1/2"), toc)?.id)
      .toBe("moved");
    expect(resolveReaderMomentTarget(moment("old-anchor", "1/3"), toc))
      .toBeUndefined();
  });

  it("resolves all active targets with linear property access growth", () => {
    const size = 1_500;
    let tocIdentityReads = 0;
    let momentIdentityReads = 0;
    const toc = Array.from({ length: size }, (_, index) => ({
      get id() {
        tocIdentityReads += 1;
        return `section-${index}`;
      },
      level: 2,
      get path() {
        tocIdentityReads += 1;
        return `1/${index}`;
      },
      text: `Section ${index}`,
    })) satisfies ReaderTocEntry[];
    const moments = Array.from({ length: size }, (_, index) => ({
      ...moment(`section-${index}`, `1/${index}`),
      get sectionAnchor() {
        momentIdentityReads += 1;
        return `section-${index}`;
      },
      get sectionPath() {
        momentIdentityReads += 1;
        return `1/${index}`;
      },
    })) satisfies ReaderMomentItem[];

    const targetIds = collectResolvedReaderMomentTargetIds(moments, toc);

    expect(targetIds.size).toBe(size);
    expect(targetIds.has("section-0")).toBe(true);
    expect(targetIds.has(`section-${size - 1}`)).toBe(true);
    expect(tocIdentityReads + momentIdentityReads).toBeLessThanOrEqual(
      4 * (toc.length + moments.length),
    );
  });
});

function moment(sectionAnchor: string, sectionPath: string): ReaderMomentItem {
  return {
    id: `moment-${sectionAnchor}`,
    sectionAnchor,
    sectionTitle: sectionAnchor,
    sectionLevel: 2,
    sectionPath,
    sectionStartOffset: null,
    sectionEndOffset: null,
    contentHash: null,
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}
