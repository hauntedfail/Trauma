import {
  createReaderContentHash,
  readCanonicalReaderRangeContext,
  type FlashbackMarkerRange,
  type FlashbackSelectionInput,
} from "../store/flashback-markers";
import type { TranslationProjectionSpan } from "../translation/types";
import type { ReaderFlashbackItem } from "./page-data";

interface SourceFlashbackRecord {
  id: string;
  contentHash?: string | null;
  createdAt: Date;
  endOffset: number;
  prefix: string;
  startOffset: number;
  suffix: string;
  text: string;
}

export interface ProjectedTranslatedFlashbacks {
  items: ReaderFlashbackItem[];
  markers: FlashbackMarkerRange[];
}

export function projectFlashbacksToTranslatedReader(input: {
  flashbacks: readonly SourceFlashbackRecord[];
  projectionSpans: readonly TranslationProjectionSpan[];
  sourceContentHash?: string;
  translatedMarkdown: string;
}): ProjectedTranslatedFlashbacks {
  const translatedContentHash = createReaderContentHash(input.translatedMarkdown);
  const sortedSpans = [...input.projectionSpans].sort(
    (left, right) => left.spanIndex - right.spanIndex,
  );
  const markers: FlashbackMarkerRange[] = [];
  const items: ReaderFlashbackItem[] = [];

  for (const flashback of input.flashbacks) {
    if (
      input.sourceContentHash !== undefined &&
      flashback.contentHash !== undefined &&
      flashback.contentHash !== null &&
      flashback.contentHash !== input.sourceContentHash
    ) {
      continue;
    }

    const translatedRange = projectSourceReaderRange({
      endOffset: flashback.endOffset,
      spans: sortedSpans,
      startOffset: flashback.startOffset,
    });
    if (translatedRange === undefined) {
      continue;
    }

    const context = readCanonicalReaderRangeContext(
      input.translatedMarkdown,
      translatedRange,
    );
    const marker = {
      contentHash: translatedContentHash,
      endOffset: translatedRange.endOffset,
      id: flashback.id,
      startOffset: translatedRange.startOffset,
      text: context.text,
    };
    markers.push(marker);
    items.push({
      contentHash: translatedContentHash,
      createdAt: flashback.createdAt.toISOString(),
      endOffset: translatedRange.endOffset,
      id: flashback.id,
      prefix: context.prefix,
      startOffset: translatedRange.startOffset,
      suffix: context.suffix,
      text: context.text,
    });
  }

  return { items, markers };
}

export function projectTranslatedSelectionToSourceReader(input: {
  projectionSpans: readonly TranslationProjectionSpan[];
  selection: FlashbackSelectionInput;
  sourceMarkdown: string;
  translatedMarkdown: string;
}): FlashbackSelectionInput | undefined {
  const translatedContext = readCanonicalReaderRangeContext(
    input.translatedMarkdown,
    {
      endOffset: input.selection.endOffset,
      startOffset: input.selection.startOffset,
    },
  );
  if (translatedContext.text !== input.selection.text) {
    return undefined;
  }

  const sourceRange = projectTranslatedReaderRange({
    endOffset: input.selection.endOffset,
    spans: [...input.projectionSpans].sort(
      (left, right) => left.spanIndex - right.spanIndex,
    ),
    startOffset: input.selection.startOffset,
  });
  if (sourceRange === undefined) {
    return undefined;
  }

  const sourceContext = readCanonicalReaderRangeContext(
    input.sourceMarkdown,
    sourceRange,
  );
  return {
    endOffset: sourceRange.endOffset,
    prefix: sourceContext.prefix,
    startOffset: sourceRange.startOffset,
    suffix: sourceContext.suffix,
    text: sourceContext.text,
  };
}

function projectSourceReaderRange(input: {
  endOffset: number;
  spans: readonly TranslationProjectionSpan[];
  startOffset: number;
}): { endOffset: number; startOffset: number } | undefined {
  const matchingSpans = input.spans.filter((span) =>
    span.sourceReaderStart >= input.startOffset &&
    span.sourceReaderEnd <= input.endOffset
  );
  if (matchingSpans.length === 0) {
    return undefined;
  }

  const first = matchingSpans[0];
  const last = matchingSpans.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.sourceReaderStart !== input.startOffset ||
    last.sourceReaderEnd !== input.endOffset
  ) {
    return undefined;
  }

  let expectedSourceStart = input.startOffset;
  for (const span of matchingSpans) {
    if (span.sourceReaderStart !== expectedSourceStart) {
      return undefined;
    }
    expectedSourceStart = span.sourceReaderEnd;
  }

  if (last.translatedReaderEnd <= first.translatedReaderStart) {
    return undefined;
  }

  return {
    endOffset: last.translatedReaderEnd,
    startOffset: first.translatedReaderStart,
  };
}

function projectTranslatedReaderRange(input: {
  endOffset: number;
  spans: readonly TranslationProjectionSpan[];
  startOffset: number;
}): { endOffset: number; startOffset: number } | undefined {
  const matchingSpans = input.spans.filter((span) =>
    span.translatedReaderStart >= input.startOffset &&
    span.translatedReaderEnd <= input.endOffset
  );
  if (matchingSpans.length === 0) {
    return undefined;
  }

  const first = matchingSpans[0];
  const last = matchingSpans.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.translatedReaderStart !== input.startOffset ||
    last.translatedReaderEnd !== input.endOffset
  ) {
    return undefined;
  }

  let expectedTranslatedStart = input.startOffset;
  for (const span of matchingSpans) {
    if (span.translatedReaderStart !== expectedTranslatedStart) {
      return undefined;
    }
    expectedTranslatedStart = span.translatedReaderEnd;
  }

  if (last.sourceReaderEnd <= first.sourceReaderStart) {
    return undefined;
  }

  return {
    endOffset: last.sourceReaderEnd,
    startOffset: first.sourceReaderStart,
  };
}
