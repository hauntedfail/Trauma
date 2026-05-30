import type { ActiveTocRange, HeadingPosition } from "./toc-reading-range";

const SECTION_ANCHOR_ATTRIBUTE = "data-reader-section-anchor";

/**
 * The reading-line anchor sits one third down the viewport so the active
 * chapter matches the content the reader is actually looking at rather than the
 * very top edge of the viewport.
 */
export function readingLineOffset(viewportHeight: number): number {
  return viewportHeight / 3;
}

/**
 * Reads the viewport-relative top of every rendered section heading inside the
 * reader root. The measurement step is injectable so the seam can be unit
 * tested without a real layout engine.
 */
export function readReaderHeadingPositions(
  root: ParentNode | undefined,
  getTop: (element: Element) => number = (element) =>
    element.getBoundingClientRect().top,
): HeadingPosition[] {
  if (root === undefined) {
    return [];
  }

  const positions: HeadingPosition[] = [];
  for (
    const element of root.querySelectorAll(`[${SECTION_ANCHOR_ATTRIBUTE}]`)
  ) {
    const id = element.getAttribute(SECTION_ANCHOR_ATTRIBUTE);
    if (id === null || id.length === 0) {
      continue;
    }

    positions.push({ id, top: getTop(element) });
  }

  return positions;
}

/**
 * Structural equality for active ranges so reactive consumers can avoid
 * redundant updates when the resolved range has not changed.
 */
export function isSameActiveTocRange(
  a: ActiveTocRange,
  b: ActiveTocRange,
): boolean {
  return (
    a.activeId === b.activeId &&
    a.chapterId === b.chapterId &&
    a.rangeIds.length === b.rangeIds.length &&
    a.rangeIds.every((id, index) => id === b.rangeIds[index])
  );
}
