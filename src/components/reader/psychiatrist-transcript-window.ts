import type { PsychiatristTranscriptPair } from "./psychiatrist-transcript";

export const PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE = 24;
export const PSYCHIATRIST_TRANSCRIPT_MAX_VISIBLE_PAIRS =
  PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE + 2;

export interface PsychiatristTranscriptWindowProjection {
  endExclusive: number;
  hasNewer: boolean;
  hasOlder: boolean;
  pairs: PsychiatristTranscriptPair[];
  rangeLabel: string;
  startIndex: number;
  total: number;
}

export function projectPsychiatristTranscriptWindow(input: {
  activePairId?: string;
  endExclusive: number;
  pairs: readonly PsychiatristTranscriptPair[];
  retryPairId?: string;
}): PsychiatristTranscriptWindowProjection {
  const total = input.pairs.length;
  const endExclusive = normalizeWindowEnd(input.endExclusive, total);
  const startIndex = Math.max(
    0,
    endExclusive - PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE,
  );
  const visibleIndices = new Set<number>();
  for (let index = startIndex; index < endExclusive; index += 1) {
    visibleIndices.add(index);
  }
  addPinnedPairIndex(visibleIndices, input.pairs, input.activePairId);
  addPinnedPairIndex(visibleIndices, input.pairs, input.retryPairId);

  return {
    endExclusive,
    hasNewer: endExclusive < total,
    hasOlder: startIndex > 0,
    pairs: [...visibleIndices]
      .sort((left, right) => left - right)
      .map((index) => input.pairs[index]!),
    rangeLabel: total === 0
      ? "Showing 0–0 of 0."
      : `Showing ${startIndex + 1}–${endExclusive} of ${total}.`,
    startIndex,
    total,
  };
}

export function movePsychiatristTranscriptWindowOlder(
  endExclusive: number,
  total: number,
): number {
  const normalizedEnd = normalizeWindowEnd(endExclusive, total);
  const startIndex = Math.max(
    0,
    normalizedEnd - PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE,
  );
  return startIndex === 0 ? normalizedEnd : startIndex;
}

export function movePsychiatristTranscriptWindowNewer(
  endExclusive: number,
  total: number,
): number {
  const normalizedEnd = normalizeWindowEnd(endExclusive, total);
  return Math.min(total, normalizedEnd + PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE);
}

function normalizeWindowEnd(endExclusive: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  if (!Number.isFinite(endExclusive)) {
    return total;
  }
  const normalized = Math.trunc(endExclusive);
  if (normalized <= 0) {
    return Math.min(total, PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE);
  }
  return Math.min(total, normalized);
}

function addPinnedPairIndex(
  visibleIndices: Set<number>,
  pairs: readonly PsychiatristTranscriptPair[],
  pairId: string | undefined,
): void {
  if (pairId === undefined || pairId === "") {
    return;
  }
  const index = pairs.findIndex((pair) => pair.pairId === pairId);
  if (index >= 0) {
    visibleIndices.add(index);
  }
}
