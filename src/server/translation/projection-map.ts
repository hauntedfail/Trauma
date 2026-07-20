import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  publishFileAtomically,
  syncDirectoryBestEffort,
} from "../files/atomic-write";
import type { SupportedLanguageCode } from "./languages";
import {
  mapMarkdownSourceRangeToReaderRange,
} from "../store/flashback-markers";
import { TranslationOutputValidationError } from "./errors";
import { projectTranslationMarkdownToReaderText } from "./source-projection";
import type {
  TranslationChunkProjectionSpan,
  TranslationProjectionSpan,
} from "./types";

export interface TranslationProjectionSidecar {
  jobId: string;
  langCode: SupportedLanguageCode;
  memoryId: string;
  outputHash: string;
  sourceHash: string;
  spans: TranslationProjectionSpan[];
  version: 1;
}

export interface TranslationProjectionChunkInput {
  chunkIndex: number;
  projectionSpansJson: string | null;
  translatedMarkdown: string | null;
}

export function buildTranslationProjectionSpans(input: {
  body: string;
  chunks: readonly TranslationProjectionChunkInput[];
  jobId: string;
  langCode: SupportedLanguageCode;
  memoryId: string;
  now: Date;
  outputHash: string;
  sourceHash: string;
}): TranslationProjectionSpan[] {
  const translatedProjection = projectTranslationMarkdownToReaderText(
    input.body,
  );
  const spans: TranslationProjectionSpan[] = [];
  let translatedChunkStart = 0;

  for (const chunk of [...input.chunks].sort((left, right) => left.chunkIndex - right.chunkIndex)) {
    if (chunk.translatedMarkdown === null) {
      throw new TranslationOutputValidationError(
        `Translated chunk ${chunk.chunkIndex} is missing Markdown.`,
      );
    }
    const chunkProjectionSpans = parseChunkProjectionSpans(chunk);
    for (const span of chunkProjectionSpans) {
      const translatedMarkdownStart = translatedChunkStart + span.translatedMarkdownStart;
      const translatedMarkdownEnd = translatedChunkStart + span.translatedMarkdownEnd;
      const translatedReaderRange = mapMarkdownSourceRangeToReaderRange(
        translatedProjection,
        {
          endOffset: translatedMarkdownEnd,
          startOffset: translatedMarkdownStart,
        },
      );
      if (translatedReaderRange === undefined) {
        throw new TranslationOutputValidationError(
          `Translated segment cannot be projected in committed output: ${span.segmentId}.`,
        );
      }
      spans.push({
        blockId: span.blockId,
        createdAt: input.now,
        jobId: input.jobId,
        langCode: input.langCode,
        memoryId: input.memoryId,
        outputHash: input.outputHash,
        segmentId: span.segmentId,
        sourceHash: input.sourceHash,
        sourceMarkdownEnd: span.sourceMarkdownEnd,
        sourceMarkdownStart: span.sourceMarkdownStart,
        sourceReaderEnd: span.sourceReaderEnd,
        sourceReaderStart: span.sourceReaderStart,
        spanIndex: spans.length,
        translatedMarkdownEnd,
        translatedMarkdownStart,
        translatedReaderEnd: translatedReaderRange.endOffset,
        translatedReaderStart: translatedReaderRange.startOffset,
        updatedAt: input.now,
      });
    }
    translatedChunkStart += chunk.translatedMarkdown.length;
  }

  return spans;
}

export function serializeTranslationProjectionSidecar(
  sidecar: TranslationProjectionSidecar,
): string {
  return `${JSON.stringify({
    ...sidecar,
    spans: [...sidecar.spans].sort(
      (left, right) => left.spanIndex - right.spanIndex,
    ),
  }, null, 2)}\n`;
}

export async function writeTranslationProjectionSidecarAtomically(
  absolutePath: string,
  sidecar: TranslationProjectionSidecar,
): Promise<void> {
  const directory = dirname(absolutePath);
  await mkdir(directory, { recursive: true });
  await syncDirectoryBestEffort(dirname(directory));
  await publishFileAtomically(
    absolutePath,
    serializeTranslationProjectionSidecar(sidecar),
  );
}

function parseChunkProjectionSpans(
  chunk: TranslationProjectionChunkInput,
): TranslationChunkProjectionSpan[] {
  if (chunk.projectionSpansJson === null) {
    throw new TranslationOutputValidationError(
      `Translated chunk ${chunk.chunkIndex} is missing projection spans.`,
    );
  }
  const parsed: unknown = JSON.parse(chunk.projectionSpansJson);
  if (!Array.isArray(parsed)) {
    throw new TranslationOutputValidationError(
      `Translated chunk ${chunk.chunkIndex} projection spans must be an array.`,
    );
  }
  return parsed.map((value, index) => readChunkProjectionSpan(value, chunk.chunkIndex, index));
}

function readChunkProjectionSpan(
  value: unknown,
  chunkIndex: number,
  index: number,
): TranslationChunkProjectionSpan {
  if (!isRecord(value)) {
    throw invalidProjectionSpanError(chunkIndex, index);
  }
  const blockId = readString(value.blockId);
  const segmentId = readString(value.segmentId);
  const sourceMarkdownEnd = readInteger(value.sourceMarkdownEnd);
  const sourceMarkdownStart = readInteger(value.sourceMarkdownStart);
  const sourceReaderEnd = readInteger(value.sourceReaderEnd);
  const sourceReaderStart = readInteger(value.sourceReaderStart);
  const translatedMarkdownEnd = readInteger(value.translatedMarkdownEnd);
  const translatedMarkdownStart = readInteger(value.translatedMarkdownStart);
  const translatedReaderEnd = readInteger(value.translatedReaderEnd);
  const translatedReaderStart = readInteger(value.translatedReaderStart);
  if (
    blockId === undefined ||
    segmentId === undefined ||
    sourceMarkdownEnd === undefined ||
    sourceMarkdownStart === undefined ||
    sourceReaderEnd === undefined ||
    sourceReaderStart === undefined ||
    translatedMarkdownEnd === undefined ||
    translatedMarkdownStart === undefined ||
    translatedReaderEnd === undefined ||
    translatedReaderStart === undefined ||
    sourceMarkdownEnd <= sourceMarkdownStart ||
    sourceReaderEnd <= sourceReaderStart ||
    translatedMarkdownEnd <= translatedMarkdownStart ||
    translatedReaderEnd <= translatedReaderStart
  ) {
    throw invalidProjectionSpanError(chunkIndex, index);
  }
  return {
    blockId,
    segmentId,
    sourceMarkdownEnd,
    sourceMarkdownStart,
    sourceReaderEnd,
    sourceReaderStart,
    translatedMarkdownEnd,
    translatedMarkdownStart,
    translatedReaderEnd,
    translatedReaderStart,
  };
}

function invalidProjectionSpanError(
  chunkIndex: number,
  spanIndex: number,
): TranslationOutputValidationError {
  return new TranslationOutputValidationError(
    `Translated chunk ${chunkIndex} projection span ${spanIndex} is invalid.`,
  );
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
