import { describe, expect, it } from "vitest";

import {
  addFlashbackCoverage,
  isRangeFullyFlashbacked,
  removeFlashbackCoverage,
} from "../../../src/server/flashbacks/ranges";

describe("flashback range toggles", () => {
  it("detects whether a selection is fully flashbacked across adjacent ranges", () => {
    expect(
      isRangeFullyFlashbacked(
        [
          { id: "left", startOffset: 5, endOffset: 10 },
          { id: "right", startOffset: 10, endOffset: 16 },
        ],
        { startOffset: 6, endOffset: 15 },
      ),
    ).toBe(true);
  });

  it("adds unflashbacked coverage as a non-overlapping canonical range", () => {
    expect(
      addFlashbackCoverage(
        [{ id: "existing", startOffset: 5, endOffset: 10 }],
        { startOffset: 8, endOffset: 16 },
        () => "merged",
      ),
    ).toEqual([{ id: "merged", startOffset: 5, endOffset: 16 }]);
  });

  it("removes an exact existing flashback", () => {
    expect(
      removeFlashbackCoverage(
        [
          { id: "before", startOffset: 0, endOffset: 4 },
          { id: "selected", startOffset: 6, endOffset: 14 },
        ],
        { startOffset: 6, endOffset: 14 },
        () => "unused",
      ),
    ).toEqual([{ id: "before", startOffset: 0, endOffset: 4 }]);
  });

  it("splits a larger flashback around a selected subset", () => {
    expect(
      removeFlashbackCoverage(
        [{ id: "whole", startOffset: 10, endOffset: 30 }],
        { startOffset: 16, endOffset: 22 },
        () => "right-split",
      ),
    ).toEqual([
      { id: "whole", startOffset: 10, endOffset: 16 },
      { id: "right-split", startOffset: 22, endOffset: 30 },
    ]);
  });

  it("removes only selected overlaps across multiple flashbacks", () => {
    expect(
      removeFlashbackCoverage(
        [
          { id: "first", startOffset: 4, endOffset: 12 },
          { id: "second", startOffset: 16, endOffset: 24 },
        ],
        { startOffset: 8, endOffset: 20 },
        () => "unused",
      ),
    ).toEqual([
      { id: "first", startOffset: 4, endOffset: 8 },
      { id: "second", startOffset: 20, endOffset: 24 },
    ]);
  });
});
