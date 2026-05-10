export interface HighlightRange {
  id: string;
  startOffset: number;
  endOffset: number;
}

export interface HighlightSelectionRange {
  startOffset: number;
  endOffset: number;
}

interface MergeableHighlightRange extends HighlightRange {
  selected: boolean;
}

export function isRangeFullyHighlighted(
  highlights: HighlightRange[],
  selection: HighlightSelectionRange,
): boolean {
  validateSelectionRange(selection);

  let cursor = selection.startOffset;
  for (const highlight of sortRanges(highlights)) {
    if (highlight.endOffset <= cursor) {
      continue;
    }

    if (highlight.startOffset > cursor) {
      return false;
    }

    cursor = Math.max(cursor, highlight.endOffset);
    if (cursor >= selection.endOffset) {
      return true;
    }
  }

  return false;
}

export function addHighlightCoverage(
  highlights: HighlightRange[],
  selection: HighlightSelectionRange,
  generateId: () => string,
): HighlightRange[] {
  validateSelectionRange(selection);

  const selectedId = generateId();
  const ranges: MergeableHighlightRange[] = [
    ...highlights.map((highlight) => ({ ...highlight, selected: false })),
    {
      id: selectedId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      selected: true,
    },
  ].toSorted((left, right) => left.startOffset - right.startOffset);
  const merged: MergeableHighlightRange[] = [];

  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous === undefined || range.startOffset > previous.endOffset) {
      merged.push({ ...range });
      continue;
    }

    previous.endOffset = Math.max(previous.endOffset, range.endOffset);
    if (previous.selected || range.selected) {
      previous.id = selectedId;
      previous.selected = true;
    }
  }

  return merged.map(({ selected: _selected, ...range }) => range);
}

export function removeHighlightCoverage(
  highlights: HighlightRange[],
  selection: HighlightSelectionRange,
  generateId: () => string,
): HighlightRange[] {
  validateSelectionRange(selection);

  const next: HighlightRange[] = [];
  for (const highlight of sortRanges(highlights)) {
    if (
      highlight.endOffset <= selection.startOffset ||
      highlight.startOffset >= selection.endOffset
    ) {
      next.push(highlight);
      continue;
    }

    const leftEndOffset = Math.min(highlight.endOffset, selection.startOffset);
    const rightStartOffset = Math.max(highlight.startOffset, selection.endOffset);
    const hasLeft = highlight.startOffset < leftEndOffset;
    const hasRight = rightStartOffset < highlight.endOffset;

    if (hasLeft) {
      next.push({
        id: highlight.id,
        startOffset: highlight.startOffset,
        endOffset: leftEndOffset,
      });
    }

    if (hasRight) {
      next.push({
        id: hasLeft ? generateId() : highlight.id,
        startOffset: rightStartOffset,
        endOffset: highlight.endOffset,
      });
    }
  }

  return next;
}

function sortRanges(highlights: HighlightRange[]): HighlightRange[] {
  return highlights
    .filter((highlight) => highlight.endOffset > highlight.startOffset)
    .toSorted((left, right) => left.startOffset - right.startOffset);
}

function validateSelectionRange(selection: HighlightSelectionRange): void {
  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset <= selection.startOffset
  ) {
    throw new Error("Highlight selection must be a non-empty range");
  }
}
