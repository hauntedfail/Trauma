import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";

export interface HeadingPosition {
  id: string;
  top: number;
}

export interface ActiveTocRange {
  activeId: string | undefined;
  chapterId: string | undefined;
  rangeIds: string[];
}

export const emptyActiveTocRange: ActiveTocRange = {
  activeId: undefined,
  chapterId: undefined,
  rangeIds: [],
};

/**
 * Returns the id of the last heading whose top has crossed the reading line.
 *
 * The reading line is a viewport-relative anchor (for example one third down
 * the viewport). Headings are expected in document order. Ties at an exact
 * boundary resolve toward the later (lower-in-document) heading. When no
 * heading has crossed the line yet, the result is `undefined`.
 */
export function resolveActiveHeadingId(
  headings: readonly HeadingPosition[],
  readingLineY: number,
): string | undefined {
  let activeId: string | undefined;
  for (const heading of headings) {
    if (heading.top <= readingLineY) {
      activeId = heading.id;
    }
  }

  return activeId;
}

/**
 * Computes the contiguous reading range to highlight in the TOC for the given
 * active entry. The range covers the active entry's chapter and its associated
 * subtitles, where a chapter is the nearest preceding entry at the minimum
 * heading level present in the TOC. The range is always a single contiguous
 * slice of the TOC ordering.
 */
export function computeActiveTocRange(
  toc: readonly ReaderTocEntry[],
  activeId: string | undefined,
): ActiveTocRange {
  if (activeId === undefined || toc.length === 0) {
    return emptyActiveTocRange;
  }

  const activeIndex = toc.findIndex((entry) => entry.id === activeId);
  if (activeIndex === -1) {
    return emptyActiveTocRange;
  }

  const chapterLevel = toc.reduce(
    (minLevel, entry) => Math.min(minLevel, entry.level),
    Number.POSITIVE_INFINITY,
  );

  let chapterIndex = activeIndex;
  while (chapterIndex > 0 && toc[chapterIndex]!.level > chapterLevel) {
    chapterIndex -= 1;
  }

  let endIndex = chapterIndex + 1;
  while (endIndex < toc.length && toc[endIndex]!.level > chapterLevel) {
    endIndex += 1;
  }

  const rangeIds = toc.slice(chapterIndex, endIndex).map((entry) => entry.id);

  return {
    activeId,
    chapterId: toc[chapterIndex]!.id,
    rangeIds,
  };
}
