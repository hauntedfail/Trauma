import type { Node, Parent } from "unist";
import { visitParents } from "unist-util-visit-parents";

import { TranslationOutputValidationError } from "./errors";
import {
  mapMarkdownSourceRangeToReaderRange,
  projectMarkdownToReaderText,
  type ProjectedMarkdownText,
} from "../store/flashback-markers";
import { parseTranslationMarkdownAst } from "./markdown-parser";
import type {
  TranslationChunkProjectionSpan,
  TranslationProtectedRange,
  TranslationSegmentReplacement,
  TranslationTextSegment,
} from "./types";

export interface TranslationSegmentManifest {
  frontmatter: string;
  protectedRanges: TranslationProtectedRange[];
  segments: TranslationTextSegment[];
  sourceMarkdown: string;
}

export interface CreateTranslationSegmentManifestOptions {
  sourceDocumentOffset?: number;
  sourceReaderProjection?: ProjectedMarkdownText;
}

export interface AppliedTranslatedSegments {
  projectionSpans: TranslationChunkProjectionSpan[];
  translatedMarkdown: string;
}

interface PositionedNode extends Node {
  identifier?: string;
  lang?: string;
  meta?: string;
  title?: string | null;
  url?: string;
  value?: string;
}

export function createTranslationSegmentManifest(
  sourceMarkdown: string,
  options: CreateTranslationSegmentManifestOptions = {},
): TranslationSegmentManifest {
  const parsed = parseTranslationMarkdownAst(sourceMarkdown);
  const blockRanges = readTopLevelBlockRanges(parsed.tree, parsed.bodyOffset);
  const sourceDocumentOffset = options.sourceDocumentOffset ?? 0;
  const sourceReaderProjection =
    options.sourceReaderProjection ?? projectMarkdownToReaderText(sourceMarkdown);
  const segments: TranslationTextSegment[] = [];
  const protectedRanges: TranslationProtectedRange[] = [];

  if (parsed.frontmatter !== "") {
    protectedRanges.push({
      kind: "frontmatter",
      sourceEnd: parsed.frontmatter.length,
      sourceStart: 0,
      value: parsed.frontmatter,
    });
  }

  visitParents(parsed.tree, (node, parents) => {
    const positioned = node as PositionedNode;
    const range = readNodeRange(positioned, parsed.bodyOffset);
    if (range !== null) {
      const protectedRange = createProtectedRange(positioned, range);
      if (protectedRange !== null) {
        protectedRanges.push(protectedRange);
      }
    }

    if (node.type !== "text" || !isTranslatableTextNode(node, parents)) {
      return;
    }

    const textRange = readNodeRange(positioned, parsed.bodyOffset);
    if (textRange === null) {
      throw new TranslationOutputValidationError(
        "Markdown text segment is missing source offsets.",
      );
    }
    const text = sourceMarkdown.slice(textRange.sourceStart, textRange.sourceEnd);
    if (!hasTranslatableContent(text)) {
      return;
    }
    const blockId = findBlockId(blockRanges, textRange.sourceStart);
    for (const part of splitTranslatableTextRanges(text, textRange.sourceStart)) {
      const sourceDocumentStart = sourceDocumentOffset + part.sourceStart;
      const sourceDocumentEnd = sourceDocumentOffset + part.sourceEnd;
      const readerRange = mapMarkdownSourceRangeToReaderRange(
        sourceReaderProjection,
        {
          endOffset: sourceDocumentEnd,
          startOffset: sourceDocumentStart,
        },
      );
      segments.push({
      blockId,
      id: `s${String(segments.length + 1).padStart(6, "0")}`,
        sourceDocumentEnd,
        sourceDocumentStart,
        sourceEnd: part.sourceEnd,
        sourceReaderEnd: readerRange?.endOffset ?? -1,
        sourceReaderStart: readerRange?.startOffset ?? -1,
        sourceStart: part.sourceStart,
        text: part.text,
      });
    }
  });

  return {
    frontmatter: parsed.frontmatter,
    protectedRanges,
    segments,
    sourceMarkdown,
  };
}

export function applyTranslatedSegments(input: {
  manifest: TranslationSegmentManifest;
  translations: TranslationSegmentReplacement[];
}): string {
  return applyTranslatedSegmentsWithProjection(input).translatedMarkdown;
}

export function applyTranslatedSegmentsWithProjection(input: {
  manifest: TranslationSegmentManifest;
  translations: TranslationSegmentReplacement[];
}): AppliedTranslatedSegments {
  const replacements = validateSegmentReplacements(input);
  const projectionSpans: TranslationChunkProjectionSpan[] = [];
  const sortedSegments = [...input.manifest.segments].sort(
    (left, right) => left.sourceStart - right.sourceStart,
  );
  let cursor = 0;
  let translatedMarkdown = "";

  for (const segment of sortedSegments) {
    if (segment.sourceStart < cursor) {
      throw new TranslationOutputValidationError(
        `Markdown text segment overlaps a previous segment: ${segment.id}.`,
      );
    }
    const replacement = replacements.get(segment.id);
    if (replacement === undefined) {
      throw new TranslationOutputValidationError(
        `Codex output segment id is missing: ${segment.id}.`,
      );
    }
    translatedMarkdown += input.manifest.sourceMarkdown.slice(cursor, segment.sourceStart);
    const translatedMarkdownStart = translatedMarkdown.length;
    translatedMarkdown += replacement;
    const translatedMarkdownEnd = translatedMarkdown.length;
    if (segment.sourceReaderStart >= 0 && segment.sourceReaderEnd > segment.sourceReaderStart) {
      projectionSpans.push({
        blockId: segment.blockId,
        segmentId: segment.id,
        sourceMarkdownEnd: segment.sourceDocumentEnd,
        sourceMarkdownStart: segment.sourceDocumentStart,
        sourceReaderEnd: segment.sourceReaderEnd,
        sourceReaderStart: segment.sourceReaderStart,
        translatedMarkdownEnd,
        translatedMarkdownStart,
        translatedReaderEnd: -1,
        translatedReaderStart: -1,
      });
    }
    cursor = segment.sourceEnd;
  }

  translatedMarkdown += input.manifest.sourceMarkdown.slice(cursor);
  const translatedProjection = projectMarkdownToReaderText(translatedMarkdown);

  return {
    projectionSpans: projectionSpans.map((span) => {
      const translatedReaderRange = mapMarkdownSourceRangeToReaderRange(
        translatedProjection,
        {
          endOffset: span.translatedMarkdownEnd,
          startOffset: span.translatedMarkdownStart,
        },
      );
      if (translatedReaderRange === undefined) {
        throw new TranslationOutputValidationError(
          `Translated segment cannot be projected to reader offsets: ${span.segmentId}.`,
        );
      }
      return {
        ...span,
        translatedReaderEnd: translatedReaderRange.endOffset,
        translatedReaderStart: translatedReaderRange.startOffset,
      };
    }),
    translatedMarkdown,
  };
}

function validateSegmentReplacements(input: {
  manifest: TranslationSegmentManifest;
  translations: TranslationSegmentReplacement[];
}): Map<string, string> {
  const expectedIds = new Set(input.manifest.segments.map((segment) => segment.id));
  const replacements = new Map<string, string>();

  for (const translation of input.translations) {
    if (!expectedIds.has(translation.segmentId)) {
      throw new TranslationOutputValidationError(
        `Codex output segment id is unknown: ${translation.segmentId}.`,
      );
    }
    if (replacements.has(translation.segmentId)) {
      throw new TranslationOutputValidationError(
        `Codex output segment id is duplicated: ${translation.segmentId}.`,
      );
    }
    if (translation.translatedText.trim() === "") {
      throw new TranslationOutputValidationError(
        `Codex output segment ${translation.segmentId} translated_text is empty.`,
      );
    }
    replacements.set(translation.segmentId, translation.translatedText);
  }

  if (replacements.size !== expectedIds.size) {
    const missing = [...expectedIds].find((id) => !replacements.has(id));
    throw new TranslationOutputValidationError(
      `Codex output segment id is missing: ${missing ?? "unknown"}.`,
    );
  }

  return replacements;
}

function readTopLevelBlockRanges(
  root: Parent,
  bodyOffset: number,
): Array<{ id: string; sourceEnd: number; sourceStart: number }> {
  return (root.children ?? []).flatMap((node, index) => {
    const range = readNodeRange(node as PositionedNode, bodyOffset);
    if (range === null) {
      return [];
    }
    return [{
      id: `b${String(index + 1).padStart(6, "0")}`,
      sourceEnd: range.sourceEnd,
      sourceStart: range.sourceStart,
    }];
  });
}

function findBlockId(
  blockRanges: Array<{ id: string; sourceEnd: number; sourceStart: number }>,
  sourceStart: number,
): string {
  return blockRanges.find((range) =>
    sourceStart >= range.sourceStart && sourceStart < range.sourceEnd
  )?.id ?? "b000000";
}

function readNodeRange(
  node: PositionedNode,
  bodyOffset: number,
): { sourceEnd: number; sourceStart: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return null;
  }
  return {
    sourceEnd: bodyOffset + end,
    sourceStart: bodyOffset + start,
  };
}

function splitTranslatableTextRanges(
  text: string,
  sourceStart: number,
): Array<{ sourceEnd: number; sourceStart: number; text: string }> {
  return splitSentenceLikeRanges(text)
    .map((range) => ({
      sourceEnd: sourceStart + range.endOffset,
      sourceStart: sourceStart + range.startOffset,
      text: text.slice(range.startOffset, range.endOffset),
    }))
    .filter((range) => hasTranslatableContent(range.text));
}

function splitSentenceLikeRanges(
  text: string,
): Array<{ endOffset: number; startOffset: number }> {
  const segmenter = readSentenceSegmenter();
  if (segmenter !== undefined) {
    const ranges = [...segmenter.segment(text)]
      .map((segment) => ({
        endOffset: segment.index + segment.segment.length,
        startOffset: segment.index,
      }))
      .filter((range) =>
        range.endOffset > range.startOffset &&
        hasTranslatableContent(text.slice(range.startOffset, range.endOffset))
      );
    if (ranges.length > 0) {
      return ranges;
    }
  }

  return fallbackSentenceLikeRanges(text);
}

interface SentenceSegment {
  index: number;
  segment: string;
}

interface SentenceSegmenter {
  segment: (input: string) => Iterable<SentenceSegment>;
}

function readSentenceSegmenter(): SentenceSegmenter | undefined {
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (
      locale: string | undefined,
      options: { granularity: "sentence" },
    ) => SentenceSegmenter;
  };
  return intlWithSegmenter.Segmenter === undefined
    ? undefined
    : new intlWithSegmenter.Segmenter(undefined, { granularity: "sentence" });
}

function fallbackSentenceLikeRanges(
  text: string,
): Array<{ endOffset: number; startOffset: number }> {
  const ranges: Array<{ endOffset: number; startOffset: number }> = [];
  let startOffset = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const char = text.charAt(cursor);
    if (/[.!?。！？]/u.test(char)) {
      let endOffset = cursor + 1;
      while (/["')\]\s]/u.test(text.charAt(endOffset))) {
        endOffset += 1;
      }
      const value = text.slice(startOffset, endOffset);
      if (hasTranslatableContent(value)) {
        ranges.push({ endOffset, startOffset });
      }
      startOffset = endOffset;
      cursor = endOffset;
      continue;
    }
    cursor += 1;
  }

  if (startOffset < text.length) {
    const value = text.slice(startOffset);
    if (hasTranslatableContent(value)) {
      ranges.push({ endOffset: text.length, startOffset });
    }
  }

  return ranges.length > 0 ? ranges : [{ endOffset: text.length, startOffset: 0 }];
}

function createProtectedRange(
  node: PositionedNode,
  range: { sourceEnd: number; sourceStart: number },
): TranslationProtectedRange | null {
  if (node.type === "code") {
    return { ...range, kind: "code", value: node.value ?? "" };
  }
  if (node.type === "inlineCode") {
    return { ...range, kind: "inline_code", value: node.value ?? "" };
  }
  if (node.type === "math") {
    return { ...range, kind: "math", value: node.value ?? "" };
  }
  if (node.type === "inlineMath") {
    return { ...range, kind: "inline_math", value: node.value ?? "" };
  }
  if (node.type === "html") {
    return { ...range, kind: "html", value: node.value ?? "" };
  }
  if (node.type === "link" && typeof node.url === "string") {
    return { ...range, kind: "link_destination", value: node.url };
  }
  if (node.type === "image" && typeof node.url === "string") {
    return { ...range, kind: "image_destination", value: node.url };
  }
  if (node.type === "footnoteDefinition" && typeof node.identifier === "string") {
    return { ...range, kind: "footnote_label", value: node.identifier };
  }
  return null;
}

function isTranslatableTextNode(node: Node, parents: Parent[]): boolean {
  const blockedAncestor = parents.some((parent) =>
    parent.type === "code" ||
    parent.type === "inlineCode" ||
    parent.type === "math" ||
    parent.type === "inlineMath" ||
    parent.type === "html" ||
    parent.type === "yaml" ||
    parent.type === "definition" ||
    parent.type === "footnoteReference" ||
    parent.type === "image" ||
    parent.type === "imageReference"
  );
  if (blockedAncestor || node.type !== "text") {
    return false;
  }
  const directParent = parents.at(-1) as PositionedNode | undefined;
  const value = (node as PositionedNode).value;
  if (
    directParent?.type === "link" &&
    typeof directParent.url === "string" &&
    typeof value === "string" &&
    directParent.url === value
  ) {
    return false;
  }
  return true;
}

function hasTranslatableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
