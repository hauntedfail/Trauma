import type { PsychiatristTranscriptPair } from "./psychiatrist-transcript";

export const PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE = 24;
export const PSYCHIATRIST_TRANSCRIPT_MAX_VISIBLE_PAIRS =
  PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE + 2;

export type PsychiatristTranscriptPinReason = "active" | "web_source_retry";

export interface PsychiatristTranscriptPinnedPair {
  pairId: string;
  reasons: PsychiatristTranscriptPinReason[];
  transcriptNumber: number;
}

export interface PsychiatristTranscriptWindowProjection {
  endExclusive: number;
  hasNewer: boolean;
  hasOlder: boolean;
  pairs: PsychiatristTranscriptPair[];
  pinnedPairs: PsychiatristTranscriptPinnedPair[];
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
  const pinnedReasonsByIndex = new Map<number, PsychiatristTranscriptPinReason[]>();
  addPinnedPairIndex(
    visibleIndices,
    pinnedReasonsByIndex,
    input.pairs,
    input.activePairId,
    "active",
    startIndex,
    endExclusive,
  );
  addPinnedPairIndex(
    visibleIndices,
    pinnedReasonsByIndex,
    input.pairs,
    input.retryPairId,
    "web_source_retry",
    startIndex,
    endExclusive,
  );
  const pinnedPairs = [...pinnedReasonsByIndex]
    .sort(([left], [right]) => left - right)
    .map(([index, reasons]) => ({
      pairId: input.pairs[index]!.pairId,
      reasons,
      transcriptNumber: index + 1,
    }));

  return {
    endExclusive,
    hasNewer: endExclusive < total,
    hasOlder: startIndex > 0,
    pairs: [...visibleIndices]
      .sort((left, right) => left - right)
      .map((index) => input.pairs[index]!),
    pinnedPairs,
    rangeLabel: formatTranscriptRangeLabel({
      endExclusive,
      pinnedPairs,
      startIndex,
      total,
    }),
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
  pinnedReasonsByIndex: Map<number, PsychiatristTranscriptPinReason[]>,
  pairs: readonly PsychiatristTranscriptPair[],
  pairId: string | undefined,
  reason: PsychiatristTranscriptPinReason,
  startIndex: number,
  endExclusive: number,
): void {
  if (pairId === undefined || pairId === "") {
    return;
  }
  const index = pairs.findIndex((pair) => pair.pairId === pairId);
  if (index >= 0) {
    visibleIndices.add(index);
    if (index < startIndex || index >= endExclusive) {
      const reasons = pinnedReasonsByIndex.get(index) ?? [];
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
      pinnedReasonsByIndex.set(index, reasons);
    }
  }
}

function formatTranscriptRangeLabel(input: {
  endExclusive: number;
  pinnedPairs: readonly PsychiatristTranscriptPinnedPair[];
  startIndex: number;
  total: number;
}): string {
  const visibleRange = input.total === 0
    ? "Showing 0–0 of 0"
    : `Showing ${input.startIndex + 1}–${input.endExclusive} of ${input.total}`;
  if (input.pinnedPairs.length === 0) {
    return `${visibleRange}.`;
  }
  const descriptions = input.pinnedPairs.map((pair) =>
    `pair ${pair.transcriptNumber} (${formatPinReasons(pair.reasons)})`
  );
  return `${visibleRange}; ${input.pinnedPairs.length} pinned ${
    input.pinnedPairs.length === 1 ? "pair" : "pairs"
  } also shown: ${descriptions.join(", ")}.`;
}

function formatPinReasons(
  reasons: readonly PsychiatristTranscriptPinReason[],
): string {
  if (reasons.length === 2) {
    return "active and web-source retry";
  }
  return reasons[0] === "active" ? "active" : "web-source retry";
}
