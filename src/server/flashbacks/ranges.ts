export interface FlashbackRange {
  id: string;
  startOffset: number;
  endOffset: number;
}

export interface FlashbackSelectionRange {
  startOffset: number;
  endOffset: number;
}

interface MergeableFlashbackRange extends FlashbackRange {
  selected: boolean;
}

export function isRangeFullyFlashbacked(
  flashbacks: FlashbackRange[],
  selection: FlashbackSelectionRange,
): boolean {
  validateSelectionRange(selection);

  let cursor = selection.startOffset;
  for (const flashback of sortRanges(flashbacks)) {
    if (flashback.endOffset <= cursor) {
      continue;
    }

    if (flashback.startOffset > cursor) {
      return false;
    }

    cursor = Math.max(cursor, flashback.endOffset);
    if (cursor >= selection.endOffset) {
      return true;
    }
  }

  return false;
}

export function addFlashbackCoverage(
  flashbacks: FlashbackRange[],
  selection: FlashbackSelectionRange,
  generateId: () => string,
): FlashbackRange[] {
  validateSelectionRange(selection);

  const selectedId = generateId();
  const ranges: MergeableFlashbackRange[] = [
    ...flashbacks.map((flashback) => ({ ...flashback, selected: false })),
    {
      id: selectedId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      selected: true,
    },
  ].toSorted((left, right) => left.startOffset - right.startOffset);
  const merged: MergeableFlashbackRange[] = [];

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

export function removeFlashbackCoverage(
  flashbacks: FlashbackRange[],
  selection: FlashbackSelectionRange,
  generateId: () => string,
): FlashbackRange[] {
  validateSelectionRange(selection);

  const next: FlashbackRange[] = [];
  for (const flashback of sortRanges(flashbacks)) {
    if (
      flashback.endOffset <= selection.startOffset ||
      flashback.startOffset >= selection.endOffset
    ) {
      next.push(flashback);
      continue;
    }

    const leftEndOffset = Math.min(flashback.endOffset, selection.startOffset);
    const rightStartOffset = Math.max(flashback.startOffset, selection.endOffset);
    const hasLeft = flashback.startOffset < leftEndOffset;
    const hasRight = rightStartOffset < flashback.endOffset;

    if (hasLeft) {
      next.push({
        id: flashback.id,
        startOffset: flashback.startOffset,
        endOffset: leftEndOffset,
      });
    }

    if (hasRight) {
      next.push({
        id: hasLeft ? generateId() : flashback.id,
        startOffset: rightStartOffset,
        endOffset: flashback.endOffset,
      });
    }
  }

  return next;
}

function sortRanges(flashbacks: FlashbackRange[]): FlashbackRange[] {
  return flashbacks
    .filter((flashback) => flashback.endOffset > flashback.startOffset)
    .toSorted((left, right) => left.startOffset - right.startOffset);
}

function validateSelectionRange(selection: FlashbackSelectionRange): void {
  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset <= selection.startOffset
  ) {
    throw new Error("Flashback selection must be a non-empty range");
  }
}
