import { describe, expect, it } from "vitest";

import {
  PSYCHIATRIST_TRANSCRIPT_MAX_VISIBLE_PAIRS,
  PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE,
  movePsychiatristTranscriptWindowNewer,
  movePsychiatristTranscriptWindowOlder,
  projectPsychiatristTranscriptWindow,
} from "../../src/components/reader/psychiatrist-transcript-window";
import type {
  PsychiatristTranscriptPair,
} from "../../src/components/reader/psychiatrist-transcript";

describe("Psychiatrist transcript window", () => {
  it("shows the most recent 24 pairs from a 1,000-pair thread", () => {
    const pairs = transcriptPairs(1_000);

    const projection = projectPsychiatristTranscriptWindow({
      endExclusive: pairs.length,
      pairs,
    });

    expect(PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE).toBe(24);
    expect(projection.pairs.map((pair) => pair.pairId)).toEqual(
      range(976, 1_000).map((index) => `pair-${index}`),
    );
    expect(projection).toMatchObject({
      endExclusive: 1_000,
      hasNewer: false,
      hasOlder: true,
      rangeLabel: "Showing 977–1000 of 1000.",
      startIndex: 976,
      total: 1_000,
    });
  });

  it("replaces pages in fixed 24-pair steps instead of accumulating DOM rows", () => {
    const pairs = transcriptPairs(1_000);
    let endExclusive = pairs.length;

    for (let page = 0; page < 42; page += 1) {
      const projection = projectPsychiatristTranscriptWindow({ endExclusive, pairs });
      expect(projection.pairs.length).toBeLessThanOrEqual(
        PSYCHIATRIST_TRANSCRIPT_WINDOW_SIZE,
      );
      const nextEnd = movePsychiatristTranscriptWindowOlder(
        projection.endExclusive,
        pairs.length,
      );
      if (nextEnd === endExclusive) {
        break;
      }
      endExclusive = nextEnd;
    }

    const oldest = projectPsychiatristTranscriptWindow({ endExclusive, pairs });
    expect(oldest.startIndex).toBe(0);
    expect(oldest.hasOlder).toBe(false);
    expect(oldest.pairs.length).toBe(16);

    const newerEnd = movePsychiatristTranscriptWindowNewer(
      oldest.endExclusive,
      pairs.length,
    );
    const newer = projectPsychiatristTranscriptWindow({
      endExclusive: newerEnd,
      pairs,
    });
    expect(newer.pairs.map((pair) => pair.pairId)).toEqual(
      range(16, 40).map((index) => `pair-${index}`),
    );
  });

  it("pins the active and latest actionable retry pairs in chronological order", () => {
    const pairs = transcriptPairs(1_000);
    pairs[100] = {
      ...pairs[100]!,
      retryAction: "allow_web_sources",
    };

    const projection = projectPsychiatristTranscriptWindow({
      activePairId: "pair-900",
      endExclusive: pairs.length,
      pairs,
      retryPairId: "pair-100",
    });

    expect(PSYCHIATRIST_TRANSCRIPT_MAX_VISIBLE_PAIRS).toBe(26);
    expect(projection.pairs.map((pair) => pair.pairId)).toEqual([
      "pair-100",
      "pair-900",
      ...range(976, 1_000).map((index) => `pair-${index}`),
    ]);
    expect(projection.pairs).toHaveLength(26);
  });

  it("deduplicates pins already inside the page or pointing to the same pair", () => {
    const pairs = transcriptPairs(30);

    const projection = projectPsychiatristTranscriptWindow({
      activePairId: "pair-29",
      endExclusive: pairs.length,
      pairs,
      retryPairId: "pair-29",
    });

    expect(projection.pairs).toHaveLength(24);
    expect(new Set(projection.pairs.map((pair) => pair.pairId)).size).toBe(24);
  });

  it("clamps stale bounds when a thread is replaced or shortened", () => {
    const projection = projectPsychiatristTranscriptWindow({
      endExclusive: 1_000,
      pairs: transcriptPairs(10),
    });

    expect(projection).toMatchObject({
      endExclusive: 10,
      hasNewer: false,
      hasOlder: false,
      rangeLabel: "Showing 1–10 of 10.",
      startIndex: 0,
    });
  });

  it("returns an empty bounded projection for an empty thread", () => {
    expect(projectPsychiatristTranscriptWindow({
      endExclusive: 0,
      pairs: [],
    })).toEqual({
      endExclusive: 0,
      hasNewer: false,
      hasOlder: false,
      pairs: [],
      rangeLabel: "Showing 0–0 of 0.",
      startIndex: 0,
      total: 0,
    });
  });
});

function transcriptPairs(count: number): PsychiatristTranscriptPair[] {
  return range(0, count).map((index) => ({
    answer: `Answer ${index}`,
    citations: [],
    pairId: `pair-${index}`,
    process: [],
    status: "completed",
    turnId: `turn-${index}`,
    userPrompt: `Prompt ${index}`,
  }));
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, index) => start + index);
}
