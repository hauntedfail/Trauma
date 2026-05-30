export interface HeadingPosition {
  id: string;
  top: number;
}

export interface ActiveTocRange {
  /**
   * Ids of every TOC entry whose section is currently rendered on screen, in
   * document order. Always a contiguous slice of the TOC ordering.
   */
  rangeIds: string[];
  /**
   * The topmost visible entry, used only as the `aria-current` location hint.
   */
  leadId: string | undefined;
}

export const emptyActiveTocRange: ActiveTocRange = {
  rangeIds: [],
  leadId: undefined,
};

/**
 * Computes the TOC entries whose sections are currently rendered within the
 * viewport.
 *
 * Each heading owns the section that runs from its own top down to the next
 * heading's top; the final heading's section extends to the end of the
 * document. A section counts as on screen when that span overlaps the visible
 * viewport `[0, viewportHeight]`. The spy therefore tracks whatever range the
 * reader currently sees rather than locking onto a single chapter: if the
 * sections for chapters 2 and 3 are both visible, both are returned.
 *
 * `headings` are expected in document order. The returned `rangeIds` are a
 * contiguous slice of that order, and `leadId` is the topmost visible entry.
 */
export function computeVisibleTocRange(
  headings: readonly HeadingPosition[],
  viewportHeight: number,
): ActiveTocRange {
  const rangeIds: string[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const sectionTop = headings[index]!.top;
    const nextHeading = headings[index + 1];
    const sectionBottom = nextHeading === undefined
      ? Number.POSITIVE_INFINITY
      : nextHeading.top;
    const isOnScreen = sectionTop < viewportHeight && sectionBottom > 0;

    if (isOnScreen) {
      rangeIds.push(headings[index]!.id);
    }
  }

  return {
    rangeIds,
    leadId: rangeIds[0],
  };
}
