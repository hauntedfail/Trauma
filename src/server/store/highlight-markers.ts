import { createHash } from "node:crypto";

import { decodeHTML } from "entities";

const HIGHLIGHT_MARK_PAIR_PATTERN =
  /<mark\b(?=[^>]*\bdata-highlight-id\s*=)[^>]*>([\s\S]*?)<\/mark>/gi;
const HIGHLIGHT_OPEN_MARK_PATTERN =
  /<mark\b(?=[^>]*\bdata-highlight-id\s*=)[^>]*>/gi;

export interface HighlightSelectionInput {
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

export interface ResolvedHighlightSelection {
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface HighlightMarkerRange {
  id: string;
  contentHash?: string | null;
  startOffset: number;
  endOffset: number;
  text?: string;
}

interface MarkdownRange {
  startOffset: number;
  endOffset: number;
}

interface ProjectedMarkdownText {
  text: string;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  protectedOffsets: boolean[];
}

interface MarkdownProjection {
  cleanMarkdown: string;
  contentHash: string;
  projectedMarkdown: ProjectedMarkdownText;
  protectedRanges: MarkdownRange[];
}

interface MarkdownLinkProjection {
  startOffset: number;
  labelStartOffset: number;
  labelEndOffset: number;
  endOffset: number;
  preserveSourceRange?: MarkdownRange;
}

type FootnoteReferenceNumbers = ReadonlyMap<string, number>;

const HIDDEN_RAW_HTML_TAGS = new Set([
  "iframe",
  "script",
  "style",
  "textarea",
  "title",
]);
const LITERAL_RAW_HTML_BLOCK_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figcaption",
  "figure",
  "section",
]);
const PROTECTED_RAW_HTML_TAGS = new Set(["code", "pre"]);

export class HighlightMarkerError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_selection" | "unresolvable_selection" | "invalid_marker_range",
  ) {
    super(message);
    this.name = "HighlightMarkerError";
  }
}

export function stripHighlightMarkers(markdown: string): string {
  return replaceOutsideRanges(
    markdown,
    findProtectedMarkdownRanges(markdown),
    (segment) =>
      segment
        .replace(HIGHLIGHT_MARK_PAIR_PATTERN, "$1")
        .replace(HIGHLIGHT_OPEN_MARK_PATTERN, ""),
  );
}

export function readCanonicalReaderText(markdown: string): string {
  return readMarkdownProjection(markdown).projectedMarkdown.text;
}

export function createReaderContentHash(markdown: string): string {
  return createHash("sha256")
    .update(readCanonicalReaderText(markdown), "utf8")
    .digest("hex")
    .replace(/^/, "sha256:");
}

export function resolveHighlightSelection(
  markdown: string,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection {
  validateSelectionShape(selection);

  const { cleanMarkdown, projectedMarkdown, protectedRanges } =
    readMarkdownProjection(markdown);
  const projectedSelection = resolveProjectedSelection(
    projectedMarkdown,
    selection,
  );
  if (projectedSelection !== undefined) {
    return projectedSelection;
  }

  if (
    cleanMarkdown.slice(selection.startOffset, selection.endOffset) ===
    selection.text
  ) {
    validateSelectableSourceRange(
      protectedRanges,
      selection.startOffset,
      selection.endOffset,
    );
    return {
      text: selection.text,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
    };
  }

  const projectedCandidates = findTextCandidates(
    projectedMarkdown.text,
    selection.text,
  )
    .map((startOffset) => ({
      resolved: mapProjectedRange(projectedMarkdown, startOffset, selection),
      score: scoreCandidate(projectedMarkdown.text, selection, startOffset),
      distance: Math.abs(startOffset - selection.startOffset),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        resolved: ResolvedHighlightSelection;
        score: number;
        distance: number;
      } => candidate.resolved !== undefined,
    );
  const projectedBest = chooseBestCandidate(projectedCandidates);
  if (projectedBest !== undefined) {
    return projectedBest.resolved;
  }

  const candidates = findTextCandidates(cleanMarkdown, selection.text)
    .filter(
      (startOffset) =>
        !rangeOverlapsProtectedRanges(
          protectedRanges,
          startOffset,
          startOffset + selection.text.length,
        ),
    );
  if (candidates.length === 0) {
    throw new HighlightMarkerError(
      "Selected text could not be found in CONTENT.md",
      "unresolvable_selection",
    );
  }

  const best = chooseBestCandidate(
    candidates
      .map((startOffset) => ({
        resolved: {
          text: selection.text,
          startOffset,
          endOffset: startOffset + selection.text.length,
        },
        score: scoreCandidate(cleanMarkdown, selection, startOffset),
        distance: Math.abs(startOffset - selection.startOffset),
      })),
  );

  if (best === undefined) {
    throw new HighlightMarkerError(
      "Selected text could not be resolved in CONTENT.md",
      "unresolvable_selection",
    );
  }

  return best.resolved;
}

export function resolveCanonicalHighlightSelection(
  markdown: string,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection {
  validateSelectionShape(selection);

  const { cleanMarkdown, projectedMarkdown, protectedRanges } =
    readMarkdownProjection(markdown);
  const projectedSelection = resolveCanonicalProjectedSelection(
    projectedMarkdown,
    selection,
  );
  if (projectedSelection !== undefined) {
    return projectedSelection;
  }

  if (
    cleanMarkdown.slice(selection.startOffset, selection.endOffset) ===
    selection.text
  ) {
    validateSelectableSourceRange(
      protectedRanges,
      selection.startOffset,
      selection.endOffset,
    );
    const readerRange = mapSourceRangeToReaderRange(projectedMarkdown, {
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
    });
    return {
      text: selection.text,
      ...(readerRange ?? {
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
      }),
    };
  }

  const projectedCandidates = findTextCandidates(
    projectedMarkdown.text,
    selection.text,
  )
    .map((startOffset) => ({
      resolved: mapCanonicalProjectedRange(
        projectedMarkdown,
        startOffset,
        selection,
      ),
      score: scoreCandidate(projectedMarkdown.text, selection, startOffset),
      distance: Math.abs(startOffset - selection.startOffset),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        resolved: ResolvedHighlightSelection;
        score: number;
        distance: number;
      } => candidate.resolved !== undefined,
    );
  const projectedBest = chooseBestCandidate(projectedCandidates);
  if (projectedBest !== undefined) {
    return projectedBest.resolved;
  }

  const candidates = findTextCandidates(cleanMarkdown, selection.text)
    .filter(
      (startOffset) =>
        !rangeOverlapsProtectedRanges(
          protectedRanges,
          startOffset,
          startOffset + selection.text.length,
        ),
    );
  if (candidates.length === 0) {
    throw new HighlightMarkerError(
      "Selected text could not be found in CONTENT.md",
      "unresolvable_selection",
    );
  }

  const best = chooseBestCandidate(
    candidates
      .map((startOffset) => ({
        resolved: mapSourceRangeToReaderRange(projectedMarkdown, {
          startOffset,
          endOffset: startOffset + selection.text.length,
        }),
        score: scoreCandidate(cleanMarkdown, selection, startOffset),
        distance: Math.abs(startOffset - selection.startOffset),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          resolved: MarkdownRange;
          score: number;
          distance: number;
        } => candidate.resolved !== undefined,
      ),
  );

  if (best === undefined) {
    throw new HighlightMarkerError(
      "Selected text could not be resolved in CONTENT.md",
      "unresolvable_selection",
    );
  }

  return {
    text: selection.text,
    ...best.resolved,
  };
}

export function applyHighlightMarkers(
  markdown: string,
  highlights: HighlightMarkerRange[],
): string {
  const { cleanMarkdown, contentHash, projectedMarkdown, protectedRanges } =
    readMarkdownProjection(markdown);
  const sortedHighlights = highlights
    .flatMap((highlight) => {
      const sourceRange = resolveHighlightRenderSourceRange({
        contentHash,
        highlight,
        projectedMarkdown,
      });
      return sourceRange === undefined ? [] : [{
        id: highlight.id,
        startOffset: sourceRange.startOffset,
        endOffset: sourceRange.endOffset,
      }];
    })
    .toSorted((left, right) => left.startOffset - right.startOffset);
  let cursor = 0;
  let marked = "";

  for (const highlight of sortedHighlights) {
    validateMarkerRange(highlight, cleanMarkdown.length, cursor, protectedRanges);
    marked += cleanMarkdown.slice(cursor, highlight.startOffset);
    marked += `<mark data-highlight-id="${escapeAttribute(highlight.id)}">`;
    marked += cleanMarkdown.slice(highlight.startOffset, highlight.endOffset);
    marked += "</mark>";
    cursor = highlight.endOffset;
  }

  return marked + cleanMarkdown.slice(cursor);
}

export function readRenderedMarkdownRangeText(
  markdown: string,
  range: MarkdownRange,
): string {
  return readRenderedMarkdownRangeContext(markdown, range).text;
}

export function readCanonicalReaderRangeContext(
  markdown: string,
  range: MarkdownRange,
  contextLimit = 80,
): { text: string; prefix: string; suffix: string } {
  const text = readCanonicalReaderText(markdown);
  const prefixStartOffset = findRenderedContextStart(
    text,
    range.startOffset,
    contextLimit,
  );
  const suffixEndOffset = findRenderedContextEnd(
    text,
    range.endOffset,
    contextLimit,
  );

  return {
    text: text.slice(range.startOffset, range.endOffset),
    prefix: text.slice(prefixStartOffset, range.startOffset),
    suffix: text.slice(range.endOffset, suffixEndOffset),
  };
}

export function readRenderedMarkdownRangeContext(
  markdown: string,
  range: MarkdownRange,
  contextLimit = 80,
): { text: string; prefix: string; suffix: string } {
  const { projectedMarkdown } = readMarkdownProjection(markdown);
  const span = findProjectedSpanForSourceRange(projectedMarkdown, range);
  if (span === undefined) {
    return { text: "", prefix: "", suffix: "" };
  }
  const prefixStartOffset = findRenderedContextStart(
    projectedMarkdown.text,
    span.startOffset,
    contextLimit,
  );
  const suffixEndOffset = findRenderedContextEnd(
    projectedMarkdown.text,
    span.endOffset,
    contextLimit,
  );

  return {
    text: projectedMarkdown.text.slice(span.startOffset, span.endOffset),
    prefix: projectedMarkdown.text.slice(prefixStartOffset, span.startOffset),
    suffix: projectedMarkdown.text.slice(span.endOffset, suffixEndOffset),
  };
}

export function normalizeHighlightMarkerRanges(
  markdown: string,
  highlights: HighlightMarkerRange[],
): HighlightMarkerRange[] {
  const { contentHash, projectedMarkdown } = readMarkdownProjection(markdown);
  return highlights.flatMap((highlight) => {
    const normalized = normalizeHighlightReaderRange({
      contentHash,
      highlight,
      projectedMarkdown,
    });
    return normalized === undefined ? [] : [normalized];
  });
}

function readMarkdownProjection(markdown: string): MarkdownProjection {
  const cleanMarkdown = normalizeMarkdownLineEndings(stripHighlightMarkers(markdown));
  const protectedRanges = findProtectedMarkdownRanges(cleanMarkdown);
  const projectedMarkdown = projectMarkdownText(cleanMarkdown, protectedRanges);

  return {
    cleanMarkdown,
    contentHash: `sha256:${createHash("sha256")
      .update(projectedMarkdown.text, "utf8")
      .digest("hex")}`,
    projectedMarkdown,
    protectedRanges,
  };
}

function normalizeMarkdownLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function normalizeHighlightReaderRange(input: {
  contentHash: string;
  highlight: HighlightMarkerRange;
  projectedMarkdown: ProjectedMarkdownText;
}): HighlightMarkerRange | undefined {
  if (input.highlight.contentHash === input.contentHash) {
    if (
      !isValidReaderRange(input.projectedMarkdown, input.highlight) ||
      (
        input.highlight.text !== undefined &&
        input.projectedMarkdown.text.slice(
          input.highlight.startOffset,
          input.highlight.endOffset,
        ) !== input.highlight.text
      )
    ) {
      return undefined;
    }

    return {
      id: input.highlight.id,
      contentHash: input.highlight.contentHash,
      startOffset: input.highlight.startOffset,
      endOffset: input.highlight.endOffset,
      text: input.highlight.text,
    };
  }

  if (input.highlight.contentHash !== undefined && input.highlight.contentHash !== null) {
    return undefined;
  }

  const readerRange = mapSourceRangeToReaderRange(
    input.projectedMarkdown,
    input.highlight,
  );
  return readerRange === undefined
    ? undefined
    : {
        id: input.highlight.id,
        startOffset: readerRange.startOffset,
        endOffset: readerRange.endOffset,
        text: input.highlight.text,
      };
}

function resolveHighlightRenderSourceRange(input: {
  contentHash: string;
  highlight: HighlightMarkerRange;
  projectedMarkdown: ProjectedMarkdownText;
}): MarkdownRange | undefined {
  if (input.highlight.contentHash === input.contentHash) {
    if (
      !isValidReaderRange(input.projectedMarkdown, input.highlight) ||
      (
        input.highlight.text !== undefined &&
        input.projectedMarkdown.text.slice(
          input.highlight.startOffset,
          input.highlight.endOffset,
        ) !== input.highlight.text
      )
    ) {
      return undefined;
    }

    return mapReaderRangeToSourceRange(input.projectedMarkdown, input.highlight);
  }

  if (input.highlight.contentHash !== undefined && input.highlight.contentHash !== null) {
    return undefined;
  }

  return normalizeHighlightMarkerRange(input.projectedMarkdown, input.highlight);
}

function isValidReaderRange(
  projectedMarkdown: ProjectedMarkdownText,
  range: MarkdownRange,
): boolean {
  return (
    Number.isInteger(range.startOffset) &&
    Number.isInteger(range.endOffset) &&
    range.startOffset >= 0 &&
    range.endOffset > range.startOffset &&
    range.endOffset <= projectedMarkdown.text.length &&
    !rangeOverlapsProtectedProjection(
      projectedMarkdown,
      range.startOffset,
      range.endOffset,
    )
  );
}

function mapReaderRangeToSourceRange(
  projectedMarkdown: ProjectedMarkdownText,
  range: MarkdownRange,
): MarkdownRange | undefined {
  const sourceStartOffset = projectedMarkdown.sourceOffsets[range.startOffset];
  const sourceEndOffset = projectedMarkdown.sourceEndOffsets[range.endOffset - 1];
  if (sourceStartOffset === undefined || sourceEndOffset === undefined) {
    return undefined;
  }

  if (sourceEndOffset <= sourceStartOffset) {
    return undefined;
  }

  return {
    startOffset: sourceStartOffset,
    endOffset: sourceEndOffset,
  };
}

function mapSourceRangeToReaderRange(
  projectedMarkdown: ProjectedMarkdownText,
  range: MarkdownRange,
): MarkdownRange | undefined {
  return findProjectedSpanForSourceRange(projectedMarkdown, range);
}

function validateSelectionShape(selection: HighlightSelectionInput): void {
  if (selection.text.length === 0) {
    throw new HighlightMarkerError(
      "Selected text must be non-empty",
      "invalid_selection",
    );
  }

  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset <= selection.startOffset
  ) {
    throw new HighlightMarkerError(
      "Selection offsets must describe a non-empty range",
      "invalid_selection",
    );
  }
}

function resolveProjectedSelection(
  projectedMarkdown: ProjectedMarkdownText,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection | undefined {
  if (
    rangeOverlapsProtectedProjection(
      projectedMarkdown,
      selection.startOffset,
      selection.endOffset,
    )
  ) {
    throw new HighlightMarkerError(
      "Selected markdown code cannot be highlighted",
      "invalid_selection",
    );
  }

  if (
    projectedMarkdown.text.slice(selection.startOffset, selection.endOffset) !==
    selection.text
  ) {
    return undefined;
  }

  return mapProjectedRange(projectedMarkdown, selection.startOffset, selection);
}

function mapProjectedRange(
  projectedMarkdown: ProjectedMarkdownText,
  projectedStartOffset: number,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection | undefined {
  const projectedEndOffset = projectedStartOffset + selection.text.length;
  const sourceStartOffset =
    projectedMarkdown.sourceOffsets[projectedStartOffset];
  const sourceEndOffset =
    projectedMarkdown.sourceEndOffsets[projectedEndOffset - 1];
  if (sourceStartOffset === undefined || sourceEndOffset === undefined) {
    return undefined;
  }

  if (
    projectedMarkdown.protectedOffsets
      .slice(projectedStartOffset, projectedEndOffset)
      .some(Boolean)
  ) {
    return undefined;
  }

  if (sourceEndOffset <= sourceStartOffset) {
    return undefined;
  }

  return {
    text: selection.text,
    startOffset: sourceStartOffset,
    endOffset: sourceEndOffset,
  };
}

function resolveCanonicalProjectedSelection(
  projectedMarkdown: ProjectedMarkdownText,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection | undefined {
  if (
    rangeOverlapsProtectedProjection(
      projectedMarkdown,
      selection.startOffset,
      selection.endOffset,
    )
  ) {
    throw new HighlightMarkerError(
      "Selected markdown code cannot be highlighted",
      "invalid_selection",
    );
  }

  if (
    projectedMarkdown.text.slice(selection.startOffset, selection.endOffset) !==
    selection.text
  ) {
    return undefined;
  }

  return mapCanonicalProjectedRange(
    projectedMarkdown,
    selection.startOffset,
    selection,
  );
}

function mapCanonicalProjectedRange(
  projectedMarkdown: ProjectedMarkdownText,
  projectedStartOffset: number,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection | undefined {
  const projectedEndOffset = projectedStartOffset + selection.text.length;
  if (
    projectedStartOffset < 0 ||
    projectedEndOffset > projectedMarkdown.text.length
  ) {
    return undefined;
  }

  if (
    projectedMarkdown.protectedOffsets
      .slice(projectedStartOffset, projectedEndOffset)
      .some(Boolean)
  ) {
    return undefined;
  }

  if (
    projectedMarkdown.sourceOffsets[projectedStartOffset] === undefined ||
    projectedMarkdown.sourceEndOffsets[projectedEndOffset - 1] === undefined
  ) {
    return undefined;
  }

  return {
    text: selection.text,
    startOffset: projectedStartOffset,
    endOffset: projectedEndOffset,
  };
}

function findTextCandidates(markdown: string, text: string): number[] {
  const candidates: number[] = [];
  let cursor = 0;

  while (cursor <= markdown.length) {
    const startOffset = markdown.indexOf(text, cursor);
    if (startOffset === -1) {
      break;
    }

    candidates.push(startOffset);
    cursor = startOffset + Math.max(1, text.length);
  }

  return candidates;
}

function chooseBestCandidate<T extends { score: number; distance: number }>(
  candidates: T[],
): T | undefined {
  const [best] = candidates.toSorted((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.distance - right.distance;
  });

  return best;
}

function scoreCandidate(
  markdown: string,
  selection: HighlightSelectionInput,
  startOffset: number,
): number {
  let score = 0;
  const endOffset = startOffset + selection.text.length;

  if (startOffset === selection.startOffset) {
    score += 8;
  }

  if (
    selection.prefix.length > 0 &&
    markdown.slice(Math.max(0, startOffset - selection.prefix.length), startOffset) ===
      selection.prefix
  ) {
    score += 4;
  }

  if (
    selection.suffix.length > 0 &&
    markdown.slice(endOffset, endOffset + selection.suffix.length) ===
      selection.suffix
  ) {
    score += 4;
  }

  return score;
}

function validateMarkerRange(
  highlight: HighlightMarkerRange,
  markdownLength: number,
  minimumStartOffset: number,
  protectedRanges: MarkdownRange[],
): void {
  if (highlight.id.trim() === "") {
    throw new HighlightMarkerError(
      "Highlight marker id must be non-empty",
      "invalid_marker_range",
    );
  }

  if (
    !Number.isInteger(highlight.startOffset) ||
    !Number.isInteger(highlight.endOffset) ||
    highlight.startOffset < minimumStartOffset ||
    highlight.endOffset <= highlight.startOffset ||
    highlight.endOffset > markdownLength
  ) {
    throw new HighlightMarkerError(
      "Highlight marker ranges must be ordered, non-overlapping, and in bounds",
      "invalid_marker_range",
    );
  }

  if (
    rangeOverlapsProtectedRanges(
      protectedRanges,
      highlight.startOffset,
      highlight.endOffset,
    )
  ) {
    throw new HighlightMarkerError(
      "Highlight marker ranges cannot overlap markdown code",
      "invalid_marker_range",
    );
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function validateSelectableSourceRange(
  protectedRanges: MarkdownRange[],
  startOffset: number,
  endOffset: number,
): void {
  if (rangeOverlapsProtectedRanges(protectedRanges, startOffset, endOffset)) {
    throw new HighlightMarkerError(
      "Selected markdown code cannot be highlighted",
      "invalid_selection",
    );
  }
}

function rangeOverlapsProtectedRanges(
  protectedRanges: MarkdownRange[],
  startOffset: number,
  endOffset: number,
): boolean {
  return protectedRanges.some(
    (range) => startOffset < range.endOffset && endOffset > range.startOffset,
  );
}

function rangeOverlapsProtectedProjection(
  projectedMarkdown: ProjectedMarkdownText,
  startOffset: number,
  endOffset: number,
): boolean {
  return projectedMarkdown.protectedOffsets
    .slice(startOffset, endOffset)
    .some(Boolean);
}

function normalizeHighlightMarkerRangesForProjection(
  projectedMarkdown: ProjectedMarkdownText,
  highlights: HighlightMarkerRange[],
): HighlightMarkerRange[] {
  return highlights.flatMap((highlight) => {
    const normalized = normalizeHighlightMarkerRange(projectedMarkdown, highlight);
    return normalized === undefined ? [] : [normalized];
  });
}

function normalizeHighlightMarkerRange(
  projectedMarkdown: ProjectedMarkdownText,
  highlight: HighlightMarkerRange,
): HighlightMarkerRange | undefined {
  const span = findProjectedSpanForSourceRange(projectedMarkdown, highlight);
  if (span === undefined) {
    return undefined;
  }

  const startOffset = projectedMarkdown.sourceOffsets[span.startOffset];
  const endOffset = projectedMarkdown.sourceEndOffsets[span.endOffset - 1];
  if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) {
    return undefined;
  }

  return {
    id: highlight.id,
    startOffset,
    endOffset,
  };
}

function findProjectedSpanForSourceRange(
  projectedMarkdown: ProjectedMarkdownText,
  range: MarkdownRange,
): { startOffset: number; endOffset: number } | undefined {
  let startOffset: number | undefined;
  let endOffset: number | undefined;

  for (let index = 0; index < projectedMarkdown.text.length; index += 1) {
    const sourceStartOffset = projectedMarkdown.sourceOffsets[index];
    const sourceEndOffset = projectedMarkdown.sourceEndOffsets[index];
    if (
      sourceStartOffset === undefined ||
      sourceEndOffset === undefined ||
      sourceStartOffset < range.startOffset ||
      sourceEndOffset > range.endOffset
    ) {
      continue;
    }

    startOffset ??= index;
    endOffset = index + 1;
  }

  return startOffset === undefined || endOffset === undefined
    ? undefined
    : { startOffset, endOffset };
}

function findRenderedContextStart(
  text: string,
  rangeStartOffset: number,
  contextLimit: number,
): number {
  const lineStartOffset = text.lastIndexOf("\n", rangeStartOffset - 1) + 1;
  return Math.max(lineStartOffset, rangeStartOffset - contextLimit);
}

function findRenderedContextEnd(
  text: string,
  rangeEndOffset: number,
  contextLimit: number,
): number {
  const nextLineBreak = text.indexOf("\n", rangeEndOffset);
  const lineEndOffset = nextLineBreak === -1 ? text.length : nextLineBreak;
  return Math.min(lineEndOffset, rangeEndOffset + contextLimit);
}

function replaceOutsideRanges(
  value: string,
  ranges: MarkdownRange[],
  replace: (segment: string) => string,
): string {
  const sortedRanges = mergeRanges(ranges);
  let cursor = 0;
  let result = "";

  for (const range of sortedRanges) {
    result += replace(value.slice(cursor, range.startOffset));
    result += value.slice(range.startOffset, range.endOffset);
    cursor = range.endOffset;
  }

  return result + replace(value.slice(cursor));
}

function findProtectedMarkdownRanges(markdown: string): MarkdownRange[] {
  return mergeRanges([
    ...findFencedCodeRanges(markdown),
    ...findIndentedCodeRanges(markdown),
    ...findInlineCodeRanges(markdown),
    ...findRawHtmlCodeRanges(markdown),
  ]);
}

function findRawHtmlCodeRanges(markdown: string): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const codeBlock = readRawHtmlElementBlock(
      markdown,
      cursor,
      markdown.length,
      PROTECTED_RAW_HTML_TAGS,
    );
    if (codeBlock !== undefined) {
      ranges.push({
        startOffset: cursor,
        endOffset: codeBlock.endOffset,
      });
      cursor = codeBlock.endOffset;
      continue;
    }

    cursor += 1;
  }

  return ranges;
}

function findFencedCodeRanges(markdown: string): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  let lineStartOffset = 0;
  let openFence:
    | { startOffset: number; marker: "`" | "~"; length: number }
    | undefined;

  while (lineStartOffset <= markdown.length) {
    const lineEndOffset = readLineEndOffset(markdown, lineStartOffset);
    const line = markdown.slice(lineStartOffset, lineEndOffset);
    const fence = parseFenceLine(line);

    if (openFence === undefined && fence !== undefined) {
      openFence = {
        startOffset: lineStartOffset,
        marker: fence.marker,
        length: fence.length,
      };
    } else if (
      openFence !== undefined &&
      fence !== undefined &&
      fence.marker === openFence.marker &&
      fence.length >= openFence.length
    ) {
      ranges.push({
        startOffset: openFence.startOffset,
        endOffset: readLineEndOffsetWithBreak(markdown, lineEndOffset),
      });
      openFence = undefined;
    }

    if (lineEndOffset >= markdown.length) {
      break;
    }
    lineStartOffset = lineEndOffset + 1;
  }

  if (openFence !== undefined) {
    ranges.push({
      startOffset: openFence.startOffset,
      endOffset: markdown.length,
    });
  }

  return ranges;
}

function findIndentedCodeRanges(markdown: string): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  let lineStartOffset = 0;

  while (lineStartOffset < markdown.length) {
    const lineEndOffset = readLineEndOffset(markdown, lineStartOffset);
    const line = markdown.slice(lineStartOffset, lineEndOffset);

    if (
      /^(?: {4,}|\t)/.test(line) &&
      line.trim() !== "" &&
      !isNestedListLine(markdown, lineStartOffset, line)
    ) {
      ranges.push({
        startOffset: lineStartOffset,
        endOffset: readLineEndOffsetWithBreak(markdown, lineEndOffset),
      });
    }

    if (lineEndOffset >= markdown.length) {
      break;
    }
    lineStartOffset = lineEndOffset + 1;
  }

  return ranges;
}

function findInlineCodeRanges(markdown: string): MarkdownRange[] {
  const fencedRanges = findFencedCodeRanges(markdown);
  const ranges: MarkdownRange[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const fencedRange = fencedRanges.find(
      (range) => cursor >= range.startOffset && cursor < range.endOffset,
    );
    if (fencedRange !== undefined) {
      cursor = fencedRange.endOffset;
      continue;
    }

    if (markdown[cursor] !== "`" || isEscapedMarkdownChar(markdown, cursor)) {
      cursor += 1;
      continue;
    }

    const runLength = readBacktickRunLength(markdown, cursor);
    const closeOffset = findClosingBacktickRun(markdown, cursor, runLength);
    if (closeOffset === -1) {
      cursor += runLength;
      continue;
    }

    ranges.push({
      startOffset: cursor,
      endOffset: closeOffset + runLength,
    });
    cursor = closeOffset + runLength;
  }

  return ranges;
}

function findClosingBacktickRun(
  markdown: string,
  openOffset: number,
  runLength: number,
): number {
  const marker = "`".repeat(runLength);
  let cursor = openOffset + runLength;

  while (cursor < markdown.length) {
    const closeOffset = markdown.indexOf(marker, cursor);
    if (closeOffset === -1) {
      return -1;
    }

    if (!isEscapedMarkdownChar(markdown, closeOffset)) {
      return closeOffset;
    }

    cursor = closeOffset + runLength;
  }

  return -1;
}

function projectMarkdownText(
  markdown: string,
  protectedRanges: MarkdownRange[],
): ProjectedMarkdownText {
  const footnoteReferenceNumbers = collectFootnoteReferenceNumbers(markdown);
  const text: string[] = [];
  const sourceOffsets: number[] = [];
  const sourceEndOffsets: number[] = [];
  const protectedOffsets: boolean[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const hiddenParagraphSeparator = readHiddenParagraphSeparator(markdown, cursor);
    if (hiddenParagraphSeparator !== undefined) {
      appendProjectedText({
        protectedOffsets,
        protectedValue: false,
        sourceEndOffset: hiddenParagraphSeparator.endOffset,
        sourceOffset: cursor,
        sourceOffsets,
        sourceEndOffsets,
        text,
        value: "\n",
      });
      cursor = hiddenParagraphSeparator.endOffset;
      continue;
    }

    const setextHeadingBreak = readSetextHeadingBreak(markdown, cursor);
    if (setextHeadingBreak !== undefined) {
      cursor = setextHeadingBreak.endOffset;
      continue;
    }

    const atxHeadingOpeningMarker = readAtxHeadingOpeningMarker(markdown, cursor);
    if (atxHeadingOpeningMarker !== undefined) {
      cursor = atxHeadingOpeningMarker.endOffset;
      continue;
    }

    const thematicBreakLine = readThematicBreakLine(markdown, cursor);
    if (thematicBreakLine !== undefined) {
      cursor = thematicBreakLine.endOffset;
      continue;
    }

    const tableRow = readTableProjectionRow(markdown, cursor);
    if (tableRow !== undefined) {
      appendTableProjectionRow({
        footnoteReferenceNumbers,
        markdown,
        protectedRanges,
        protectedOffsets,
        sourceEndOffsets,
        sourceOffsets,
        tableRow,
        text,
      });
      cursor = tableRow.endOffset;
      continue;
    }

    const referenceDefinition = readReferenceDefinition(markdown, cursor);
    if (referenceDefinition !== undefined) {
      cursor = referenceDefinition.endOffset;
      continue;
    }

    const blockquoteMarker = readBlockquoteMarker(markdown, cursor);
    if (blockquoteMarker !== undefined) {
      cursor = blockquoteMarker.endOffset;
      continue;
    }

    const listMarker = readListMarker(markdown, cursor);
    if (listMarker !== undefined) {
      cursor = listMarker.endOffset;
      continue;
    }

    const taskCheckboxMarker = readTaskCheckboxMarker(markdown, cursor);
    if (taskCheckboxMarker !== undefined) {
      cursor = taskCheckboxMarker.endOffset;
      continue;
    }

    const sanitizedRawHtmlBlock = readSanitizedRawHtmlBlock(
      markdown,
      cursor,
      markdown.length,
    );
    if (sanitizedRawHtmlBlock !== undefined) {
      cursor = sanitizedRawHtmlBlock.endOffset;
      continue;
    }

    const literalRawHtmlBlock = readLiteralRawHtmlBlock(
      markdown,
      cursor,
      markdown.length,
    );
    if (literalRawHtmlBlock !== undefined) {
      appendRawHtmlTextContent({
        block: literalRawHtmlBlock,
        markdown,
        protectedOffsets,
        protectedValue: false,
        sourceOffsets,
        sourceEndOffsets,
        text,
      });
      cursor = literalRawHtmlBlock.endOffset;
      continue;
    }

    const image = parseInlineImage(markdown, cursor);
    if (image !== undefined) {
      cursor = image.endOffset;
      continue;
    }

    const escaped = readEscapedMarkdownCharacter(markdown, cursor, markdown.length);
    if (escaped !== undefined) {
      appendProjectedText({
        protectedOffsets,
        protectedValue: false,
        sourceEndOffset: escaped.endOffset,
        sourceOffset: cursor,
        sourceOffsets,
        sourceEndOffsets,
        text,
        value: escaped.value,
      });
      cursor = escaped.endOffset;
      continue;
    }

    const hardBreakMarker = readHardBreakMarker(markdown, cursor, markdown.length);
    if (hardBreakMarker !== undefined) {
      cursor = hardBreakMarker.endOffset;
      continue;
    }

    const footnoteReference = readFootnoteReference(
      markdown,
      cursor,
      footnoteReferenceNumbers,
    );
    if (footnoteReference !== undefined) {
      appendProjectedText({
        protectedOffsets,
        protectedValue: false,
        sourceEndOffset: footnoteReference.endOffset,
        sourceOffset: cursor,
        sourceOffsets,
        sourceEndOffsets,
        text,
        value: footnoteReference.value,
      });
      cursor = footnoteReference.endOffset;
      continue;
    }

    const link = parseInlineLink(markdown, cursor);
    if (
      link !== undefined &&
      !rangeOverlapsProtectedRanges(
        protectedRanges,
        link.labelStartOffset,
        link.labelEndOffset,
      )
    ) {
      appendProjectedLinkLabel({
        link,
        markdown,
        footnoteReferenceNumbers,
        protectedRanges,
        protectedValue: false,
        sourceOffsets,
        sourceEndOffsets,
        text,
        protectedOffsets,
      });
      cursor = link.endOffset;
      continue;
    }

    const autolink = parseAutolink(markdown, cursor);
    if (autolink !== undefined) {
      appendProjectedText({
        protectedOffsets,
        protectedValue: false,
        sourceEndOffset: autolink.endOffset,
        sourceOffset: cursor,
        sourceOffsets,
        sourceEndOffsets,
        text,
        value: autolink.value,
      });
      cursor = autolink.endOffset;
      continue;
    }

    if (shouldSkipMarkdownSyntax(markdown, cursor, protectedRanges)) {
      cursor += 1;
      continue;
    }

    const atxHeadingClosingMarker = readAtxHeadingClosingMarker(markdown, cursor);
    if (atxHeadingClosingMarker !== undefined) {
      cursor = atxHeadingClosingMarker.endOffset;
      continue;
    }

    const htmlToken = readInlineHtmlToken(markdown, cursor, markdown.length);
    if (htmlToken !== undefined) {
      cursor = htmlToken.endOffset;
      continue;
    }

    const protectedValue = rangeOverlapsProtectedRanges(
      protectedRanges,
      cursor,
      cursor + 1,
    );
    const entity = readHtmlEntity(markdown, cursor, markdown.length);
    if (entity !== undefined) {
      appendProjectedText({
        protectedOffsets,
        protectedValue,
        sourceEndOffset: entity.endOffset,
        sourceOffset: cursor,
        sourceOffsets,
        sourceEndOffsets,
        text,
        value: entity.value,
      });
      cursor = entity.endOffset;
      continue;
    }

    text.push(markdown[cursor] ?? "");
    sourceOffsets.push(cursor);
    sourceEndOffsets.push(cursor + 1);
    protectedOffsets.push(protectedValue);
    cursor += 1;
  }

  return {
    text: text.join(""),
    sourceOffsets,
    sourceEndOffsets,
    protectedOffsets,
  };
}

function appendTableProjectionRow(input: {
  footnoteReferenceNumbers: FootnoteReferenceNumbers;
  markdown: string;
  protectedRanges: MarkdownRange[];
  protectedOffsets: boolean[];
  sourceEndOffsets: number[];
  sourceOffsets: number[];
  tableRow: { endOffset: number; cells: MarkdownRange[]; lineEndOffset: number };
  text: string[];
}): void {
  for (const cell of input.tableRow.cells) {
    appendProjectedSlice({
      footnoteReferenceNumbers: input.footnoteReferenceNumbers,
      markdown: input.markdown,
      protectedRanges: input.protectedRanges,
      protectedValue: false,
      sourceOffsets: input.sourceOffsets,
      sourceEndOffsets: input.sourceEndOffsets,
      text: input.text,
      protectedOffsets: input.protectedOffsets,
      startOffset: cell.startOffset,
      endOffset: cell.endOffset,
    });
  }

  if (input.tableRow.endOffset > input.tableRow.lineEndOffset) {
    appendProjectedText({
      protectedOffsets: input.protectedOffsets,
      protectedValue: false,
      sourceEndOffset: input.tableRow.endOffset,
      sourceOffset: input.tableRow.lineEndOffset,
      sourceOffsets: input.sourceOffsets,
      sourceEndOffsets: input.sourceEndOffsets,
      text: input.text,
      value: "\n",
    });
  }
}

function appendProjectedSlice(input: {
  footnoteReferenceNumbers: FootnoteReferenceNumbers;
  markdown: string;
  protectedRanges: MarkdownRange[];
  protectedValue: boolean;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  text: string[];
  protectedOffsets: boolean[];
  startOffset: number;
  endOffset: number;
}): void {
  let offset = input.startOffset;
  while (offset < input.endOffset) {
    const hiddenParagraphSeparator = readHiddenParagraphSeparator(
      input.markdown,
      offset,
    );
    if (
      hiddenParagraphSeparator !== undefined &&
      hiddenParagraphSeparator.endOffset <= input.endOffset
    ) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: hiddenParagraphSeparator.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: "\n",
      });
      offset = hiddenParagraphSeparator.endOffset;
      continue;
    }

    const setextHeadingBreak = readSetextHeadingBreak(input.markdown, offset);
    if (
      setextHeadingBreak !== undefined &&
      setextHeadingBreak.endOffset <= input.endOffset
    ) {
      offset = setextHeadingBreak.endOffset;
      continue;
    }

    const atxHeadingOpeningMarker = readAtxHeadingOpeningMarker(
      input.markdown,
      offset,
    );
    if (
      atxHeadingOpeningMarker !== undefined &&
      atxHeadingOpeningMarker.endOffset <= input.endOffset
    ) {
      offset = atxHeadingOpeningMarker.endOffset;
      continue;
    }

    const listMarker = readListMarker(input.markdown, offset);
    if (
      listMarker !== undefined &&
      listMarker.endOffset <= input.endOffset
    ) {
      offset = listMarker.endOffset;
      continue;
    }

    const taskCheckboxMarker = readTaskCheckboxMarker(input.markdown, offset);
    if (
      taskCheckboxMarker !== undefined &&
      taskCheckboxMarker.endOffset <= input.endOffset
    ) {
      offset = taskCheckboxMarker.endOffset;
      continue;
    }

    const image = parseInlineImage(input.markdown, offset);
    if (image !== undefined && image.endOffset <= input.endOffset) {
      offset = image.endOffset;
      continue;
    }

    const sanitizedRawHtmlBlock = readSanitizedRawHtmlBlock(
      input.markdown,
      offset,
      input.endOffset,
    );
    if (sanitizedRawHtmlBlock !== undefined) {
      offset = sanitizedRawHtmlBlock.endOffset;
      continue;
    }

    const literalRawHtmlBlock = readLiteralRawHtmlBlock(
      input.markdown,
      offset,
      input.endOffset,
    );
    if (literalRawHtmlBlock !== undefined) {
      appendRawHtmlTextContent({
        block: literalRawHtmlBlock,
        markdown: input.markdown,
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
      });
      offset = literalRawHtmlBlock.endOffset;
      continue;
    }

    const escaped = readEscapedMarkdownCharacter(
      input.markdown,
      offset,
      input.endOffset,
    );
    if (escaped !== undefined) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: escaped.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: escaped.value,
      });
      offset = escaped.endOffset;
      continue;
    }

    const hardBreakMarker = readHardBreakMarker(
      input.markdown,
      offset,
      input.endOffset,
    );
    if (hardBreakMarker !== undefined) {
      offset = hardBreakMarker.endOffset;
      continue;
    }

    const footnoteReference = readFootnoteReference(
      input.markdown,
      offset,
      input.footnoteReferenceNumbers,
    );
    if (
      footnoteReference !== undefined &&
      footnoteReference.endOffset <= input.endOffset
    ) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: footnoteReference.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: footnoteReference.value,
      });
      offset = footnoteReference.endOffset;
      continue;
    }

    const link = parseInlineLink(input.markdown, offset);
    if (link !== undefined && link.endOffset <= input.endOffset) {
      appendProjectedLinkLabel({
        footnoteReferenceNumbers: input.footnoteReferenceNumbers,
        link,
        markdown: input.markdown,
        protectedRanges: input.protectedRanges,
        protectedValue: input.protectedValue,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        protectedOffsets: input.protectedOffsets,
      });
      offset = link.endOffset;
      continue;
    }

    const autolink = parseAutolink(input.markdown, offset);
    if (autolink !== undefined && autolink.endOffset <= input.endOffset) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: autolink.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: autolink.value,
      });
      offset = autolink.endOffset;
      continue;
    }

    if (shouldSkipMarkdownSyntax(input.markdown, offset, input.protectedRanges)) {
      offset += 1;
      continue;
    }

    const atxHeadingClosingMarker = readAtxHeadingClosingMarker(
      input.markdown,
      offset,
    );
    if (
      atxHeadingClosingMarker !== undefined &&
      atxHeadingClosingMarker.endOffset <= input.endOffset
    ) {
      offset = atxHeadingClosingMarker.endOffset;
      continue;
    }

    const htmlToken = readInlineHtmlToken(
      input.markdown,
      offset,
      input.endOffset,
    );
    if (htmlToken !== undefined) {
      offset = htmlToken.endOffset;
      continue;
    }

    const entity = readHtmlEntity(input.markdown, offset, input.endOffset);
    if (entity !== undefined) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: entity.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: entity.value,
      });
      offset = entity.endOffset;
      continue;
    }

    appendProjectedText({
      protectedOffsets: input.protectedOffsets,
      protectedValue: input.protectedValue,
      sourceEndOffset: offset + 1,
      sourceOffset: offset,
      sourceOffsets: input.sourceOffsets,
      sourceEndOffsets: input.sourceEndOffsets,
      text: input.text,
      value: input.markdown[offset] ?? "",
    });
    offset += 1;
  }
}

function appendProjectedLinkLabel(input: {
  footnoteReferenceNumbers: FootnoteReferenceNumbers;
  link: MarkdownLinkProjection;
  markdown: string;
  protectedRanges: MarkdownRange[];
  protectedValue: boolean;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  text: string[];
  protectedOffsets: boolean[];
}): void {
  const projectedStartIndex = input.text.length;
  appendProjectedSlice({
    footnoteReferenceNumbers: input.footnoteReferenceNumbers,
    markdown: input.markdown,
    protectedRanges: input.protectedRanges,
    protectedValue: input.protectedValue,
    sourceOffsets: input.sourceOffsets,
    sourceEndOffsets: input.sourceEndOffsets,
    text: input.text,
    protectedOffsets: input.protectedOffsets,
    startOffset: input.link.labelStartOffset,
    endOffset: input.link.labelEndOffset,
  });

  if (input.link.preserveSourceRange === undefined) {
    return;
  }

  for (let index = projectedStartIndex; index < input.text.length; index += 1) {
    input.sourceOffsets[index] = input.link.preserveSourceRange.startOffset;
    input.sourceEndOffsets[index] = input.link.preserveSourceRange.endOffset;
  }
}

function appendProjectedText(input: {
  protectedOffsets: boolean[];
  protectedValue: boolean;
  sourceEndOffset: number;
  sourceOffset: number;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  text: string[];
  value: string;
}): void {
  for (let index = 0; index < input.value.length; index += 1) {
    input.text.push(input.value[index] ?? "");
    input.sourceOffsets.push(input.sourceOffset);
    input.sourceEndOffsets.push(input.sourceEndOffset);
    input.protectedOffsets.push(input.protectedValue);
  }
}

function appendRawHtmlTextContent(input: {
  block: {
    contentStartOffset: number;
    contentEndOffset: number;
  };
  markdown: string;
  protectedOffsets: boolean[];
  protectedValue: boolean;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  text: string[];
}): void {
  let offset = input.block.contentStartOffset;

  while (offset < input.block.contentEndOffset) {
    const htmlToken = readInlineHtmlToken(
      input.markdown,
      offset,
      input.block.contentEndOffset,
    );
    if (htmlToken !== undefined) {
      offset = htmlToken.endOffset;
      continue;
    }

    const entity = readHtmlEntity(
      input.markdown,
      offset,
      input.block.contentEndOffset,
    );
    if (entity !== undefined) {
      appendProjectedText({
        protectedOffsets: input.protectedOffsets,
        protectedValue: input.protectedValue,
        sourceEndOffset: entity.endOffset,
        sourceOffset: offset,
        sourceOffsets: input.sourceOffsets,
        sourceEndOffsets: input.sourceEndOffsets,
        text: input.text,
        value: entity.value,
      });
      offset = entity.endOffset;
      continue;
    }

    appendProjectedText({
      protectedOffsets: input.protectedOffsets,
      protectedValue: input.protectedValue,
      sourceEndOffset: offset + 1,
      sourceOffset: offset,
      sourceOffsets: input.sourceOffsets,
      sourceEndOffsets: input.sourceEndOffsets,
      text: input.text,
      value: input.markdown[offset] ?? "",
    });
    offset += 1;
  }
}

function readInlineHtmlToken(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { endOffset: number } | undefined {
  if (markdown.startsWith("<!--", startOffset)) {
    const commentEndOffset = markdown.indexOf("-->", startOffset + 4);
    if (
      commentEndOffset !== -1 &&
      commentEndOffset + "-->".length <= maximumEndOffset
    ) {
      return { endOffset: commentEndOffset + "-->".length };
    }
  }

  if (markdown[startOffset] !== "<") {
    return undefined;
  }

  const closeOffset = markdown.indexOf(">", startOffset + 1);
  if (closeOffset === -1 || closeOffset + 1 > maximumEndOffset) {
    return undefined;
  }

  const token = markdown.slice(startOffset, closeOffset + 1);
  if (!/^<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?\/?>$/.test(token)) {
    return undefined;
  }

  return { endOffset: closeOffset + 1 };
}

function readSanitizedRawHtmlBlock(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { endOffset: number } | undefined {
  return readRawHtmlElementBlock(
    markdown,
    startOffset,
    maximumEndOffset,
    HIDDEN_RAW_HTML_TAGS,
  );
}

function readLiteralRawHtmlBlock(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
):
  | { contentStartOffset: number; contentEndOffset: number; endOffset: number }
  | undefined {
  return readRawHtmlElementBlockWithContent(
    markdown,
    startOffset,
    maximumEndOffset,
    LITERAL_RAW_HTML_BLOCK_TAGS,
  );
}

function readRawHtmlElementBlock(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
  tagNames: ReadonlySet<string>,
): { endOffset: number } | undefined {
  const block = readRawHtmlElementBlockWithContent(
    markdown,
    startOffset,
    maximumEndOffset,
    tagNames,
  );
  return block === undefined ? undefined : { endOffset: block.endOffset };
}

function readRawHtmlElementBlockWithContent(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
  tagNames: ReadonlySet<string>,
):
  | { contentStartOffset: number; contentEndOffset: number; endOffset: number }
  | undefined {
  if (markdown[startOffset] !== "<") {
    return undefined;
  }

  const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*)?\/?>/i.exec(
    markdown.slice(startOffset, Math.min(maximumEndOffset, startOffset + 120)),
  );
  const tagName = openMatch?.[1]?.toLowerCase();
  if (
    openMatch === null ||
    tagName === undefined ||
    !tagNames.has(tagName)
  ) {
    return undefined;
  }

  const openEndOffset = startOffset + openMatch[0].length;
  if (openMatch[0].endsWith("/>")) {
    return {
      contentStartOffset: openEndOffset,
      contentEndOffset: openEndOffset,
      endOffset: openEndOffset,
    };
  }

  const closePattern = new RegExp(`</${tagName}\\s*>`, "i");
  const closeMatch = closePattern.exec(markdown.slice(openEndOffset, maximumEndOffset));
  const contentEndOffset = closeMatch === null
    ? openEndOffset
    : openEndOffset + closeMatch.index;
  return {
    contentStartOffset: openEndOffset,
    contentEndOffset,
    endOffset: closeMatch === null
      ? openEndOffset
      : contentEndOffset + closeMatch[0].length,
  };
}

function readHardBreakMarker(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { endOffset: number } | undefined {
  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  if (lineEndOffset > maximumEndOffset) {
    return undefined;
  }

  if (markdown[startOffset] === "\\" && startOffset + 1 === lineEndOffset) {
    return { endOffset: lineEndOffset };
  }

  if (markdown[startOffset] !== " ") {
    return undefined;
  }

  const trailing = markdown.slice(startOffset, lineEndOffset);
  return /^ {2,}$/.test(trailing) ? { endOffset: lineEndOffset } : undefined;
}

function readEscapedMarkdownCharacter(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { value: string; endOffset: number } | undefined {
  if (markdown[startOffset] !== "\\" || startOffset + 2 > maximumEndOffset) {
    return undefined;
  }

  const escaped = markdown[startOffset + 1];
  if (escaped === undefined || !/^[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]$/.test(escaped)) {
    return undefined;
  }

  return {
    value: escaped,
    endOffset: startOffset + 2,
  };
}

function readHtmlEntity(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { value: string; endOffset: number } | undefined {
  const match = /^&(?:#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]+);/.exec(
    markdown.slice(startOffset, Math.min(maximumEndOffset, startOffset + 40)),
  );
  if (match === null) {
    return undefined;
  }

  const [raw] = match;
  const value = decodeHTML(raw);
  if (value === raw) {
    return undefined;
  }

  return {
    value,
    endOffset: startOffset + raw.length,
  };
}

function parseAutolink(
  markdown: string,
  startOffset: number,
): { value: string; endOffset: number } | undefined {
  if (markdown[startOffset] !== "<") {
    return undefined;
  }

  const closeOffset = markdown.indexOf(">", startOffset + 1);
  if (closeOffset === -1) {
    return undefined;
  }

  const value = markdown.slice(startOffset + 1, closeOffset);
  if (
    /^(?:https?:\/\/|mailto:)[^\s<>]+$/i.test(value) ||
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  ) {
    return {
      value,
      endOffset: closeOffset + 1,
    };
  }

  return undefined;
}

function parseInlineLink(
  markdown: string,
  startOffset: number,
): MarkdownLinkProjection | undefined {
  if (markdown[startOffset] !== "[" || markdown[startOffset - 1] === "!") {
    return undefined;
  }

  return parseMarkdownLink(markdown, startOffset);
}

function parseInlineImage(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  if (markdown[startOffset] !== "!" || markdown[startOffset + 1] !== "[") {
    return undefined;
  }

  const link = parseMarkdownLink(markdown, startOffset + 1);
  return link === undefined ? undefined : { endOffset: link.endOffset };
}

function parseMarkdownLink(
  markdown: string,
  startOffset: number,
): MarkdownLinkProjection | undefined {
  if (markdown[startOffset] !== "[") {
    return undefined;
  }

  const labelEndOffset = findLinkLabelEndOffset(markdown, startOffset);
  if (labelEndOffset === -1) {
    return undefined;
  }
  const label = markdown.slice(startOffset + 1, labelEndOffset);
  if (label.startsWith("^")) {
    return undefined;
  }

  if (markdown.slice(labelEndOffset, labelEndOffset + 2) === "](") {
    const destinationEndOffset = findLinkDestinationEndOffset(
      markdown,
      labelEndOffset + 2,
    );
    if (destinationEndOffset === -1) {
      return undefined;
    }

    return {
      startOffset,
      labelStartOffset: startOffset + 1,
      labelEndOffset,
      endOffset: destinationEndOffset + 1,
    };
  }

  if (markdown[labelEndOffset + 1] === "[") {
    const referenceEndOffset = markdown.indexOf("]", labelEndOffset + 2);
    if (referenceEndOffset === -1) {
      return undefined;
    }
    const referenceLabel = markdown.slice(labelEndOffset + 2, referenceEndOffset);
    const effectiveReferenceLabel = referenceLabel === "" ? label : referenceLabel;
    if (!hasReferenceDefinition(markdown, effectiveReferenceLabel)) {
      return undefined;
    }

    return {
      startOffset,
      labelStartOffset: startOffset + 1,
      labelEndOffset,
      endOffset: referenceEndOffset + 1,
      ...(referenceLabel === ""
        ? {
            preserveSourceRange: {
              startOffset,
              endOffset: referenceEndOffset + 1,
            },
          }
        : {}),
    };
  }

  if (hasReferenceDefinition(markdown, label)) {
    return {
      startOffset,
      labelStartOffset: startOffset + 1,
      labelEndOffset,
      endOffset: labelEndOffset + 1,
      preserveSourceRange: {
        startOffset,
        endOffset: labelEndOffset + 1,
      },
    };
  }

  return undefined;
}

function findLinkLabelEndOffset(markdown: string, startOffset: number): number {
  let cursor = startOffset + 1;
  let bracketDepth = 0;

  while (cursor < markdown.length) {
    const char = markdown[cursor];
    if (char === undefined || char === "\n") {
      return -1;
    }

    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      cursor += 1;
      continue;
    }

    if (char === "]") {
      if (bracketDepth === 0) {
        return cursor;
      }

      bracketDepth -= 1;
    }

    cursor += 1;
  }

  return -1;
}

function findLinkDestinationEndOffset(
  markdown: string,
  startOffset: number,
): number {
  let cursor = startOffset;
  let parenthesisDepth = 0;

  while (cursor < markdown.length) {
    const char = markdown[cursor];
    if (char === undefined || char === "\n") {
      return -1;
    }

    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === "(") {
      parenthesisDepth += 1;
      cursor += 1;
      continue;
    }

    if (char === ")") {
      if (parenthesisDepth === 0) {
        return cursor;
      }

      parenthesisDepth -= 1;
    }

    cursor += 1;
  }

  return -1;
}

function shouldSkipMarkdownSyntax(
  markdown: string,
  offset: number,
  protectedRanges: MarkdownRange[],
): boolean {
  if (rangeOverlapsProtectedRanges(protectedRanges, offset, offset + 1)) {
    return markdown[offset] === "`";
  }

  const char = markdown[offset];
  if (char === "*" || char === "_") {
    return true;
  }

  if (
    char === "~" &&
    (markdown[offset - 1] === "~" || markdown[offset + 1] === "~")
  ) {
    return true;
  }

  if (char === "#" && isLinePrefixOnly(markdown, offset, "#")) {
    return true;
  }

  return false;
}

function readThematicBreakLine(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (lineStartOffset !== startOffset) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  const thematicBreak = /^(?: {0,3})(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    line,
  );
  return thematicBreak
    ? { endOffset: readLineEndOffsetWithBreak(markdown, lineEndOffset) }
    : undefined;
}

function readHiddenParagraphSeparator(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  if (markdown[startOffset] !== "\n" || markdown[startOffset + 1] !== "\n") {
    return undefined;
  }

  let endOffset = startOffset + 2;
  while (markdown[endOffset] === "\n") {
    endOffset += 1;
  }

  return { endOffset };
}

function readSetextHeadingBreak(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  if (markdown[startOffset] !== "\n") {
    return undefined;
  }

  const underlineStartOffset = startOffset + 1;
  const underlineEndOffset = readLineEndOffset(markdown, underlineStartOffset);
  const underline = markdown.slice(underlineStartOffset, underlineEndOffset);
  if (!isSetextHeadingUnderlineLine(underline)) {
    return undefined;
  }

  const previousLine = readPreviousLine(markdown, underlineStartOffset);
  if (previousLine === undefined || previousLine.line.trim() === "") {
    return undefined;
  }

  return {
    endOffset: readLineEndOffsetWithBreak(markdown, underlineEndOffset),
  };
}

function readAtxHeadingOpeningMarker(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (lineStartOffset !== startOffset) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  const match = /^(?: {0,3})#{1,6}[ \t]+/.exec(line);
  return match === null
    ? undefined
    : { endOffset: startOffset + match[0].length };
}

function readAtxHeadingClosingMarker(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(lineStartOffset, lineEndOffset);
  if (!/^(?: {0,3})#{1,6}(?:[ \t]+|$)/.test(line)) {
    return undefined;
  }

  const closing = /[ \t]+#{1,}[ \t]*$/.exec(line);
  if (closing === null) {
    return undefined;
  }

  const closingStartOffset = lineStartOffset + closing.index;
  return closingStartOffset === startOffset
    ? { endOffset: lineEndOffset }
    : undefined;
}

function isSetextHeadingUnderlineLine(line: string): boolean {
  return /^(?: {0,3})(?:=+|-+)[ \t]*$/.test(line);
}

function readReferenceDefinition(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (lineStartOffset !== startOffset) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  const match = /^(?: {0,3})\[(\^?[^\]\n]+)\]:[^\n]*$/.exec(line);
  if (match === null) {
    return undefined;
  }

  const firstLineEndOffset = readLineEndOffsetWithBreak(markdown, lineEndOffset);
  return {
    endOffset: match[1]?.startsWith("^") === true
      ? readFootnoteDefinitionEndOffset(markdown, firstLineEndOffset)
      : readLinkReferenceDefinitionEndOffset(markdown, firstLineEndOffset),
  };
}

function readLinkReferenceDefinitionEndOffset(
  markdown: string,
  startOffset: number,
): number {
  let endOffset = startOffset;
  let cursor = startOffset;

  while (cursor < markdown.length) {
    const lineEndOffset = readLineEndOffset(markdown, cursor);
    const line = markdown.slice(cursor, lineEndOffset);
    if (!isReferenceTitleContinuationLine(line)) {
      break;
    }

    endOffset = readLineEndOffsetWithBreak(markdown, lineEndOffset);
    cursor = endOffset;
  }

  return endOffset;
}

function readFootnoteDefinitionEndOffset(
  markdown: string,
  startOffset: number,
): number {
  let endOffset = startOffset;
  let cursor = startOffset;
  let pendingBlankEndOffset: number | undefined;

  while (cursor < markdown.length) {
    const lineEndOffset = readLineEndOffset(markdown, cursor);
    const line = markdown.slice(cursor, lineEndOffset);
    const lineEndOffsetWithBreak = readLineEndOffsetWithBreak(markdown, lineEndOffset);

    if (line.trim() === "") {
      pendingBlankEndOffset = lineEndOffsetWithBreak;
      cursor = lineEndOffsetWithBreak;
      continue;
    }

    if (/^(?: {4,}|\t)/.test(line)) {
      endOffset = lineEndOffsetWithBreak;
      pendingBlankEndOffset = undefined;
      cursor = lineEndOffsetWithBreak;
      continue;
    }

    break;
  }

  return pendingBlankEndOffset ?? endOffset;
}

function isReferenceTitleContinuationLine(line: string): boolean {
  return /^ {1,3}(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*$/.test(line);
}

function readBlockquoteMarker(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (lineStartOffset !== startOffset) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  const match = /^(?: {0,3}>[ \t]?)+/.exec(line);
  return match === null
    ? undefined
    : { endOffset: startOffset + match[0].length };
}

function readListMarker(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (!isContainerPrefix(markdown.slice(lineStartOffset, startOffset))) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  const match = readListMarkerMatch(markdown, startOffset, line);
  return match === null
    ? undefined
    : { endOffset: startOffset + match.endOffset };
}

function readTaskCheckboxMarker(
  markdown: string,
  startOffset: number,
): { endOffset: number } | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  const prefix = markdown.slice(lineStartOffset, startOffset);
  if (!isListMarkerPrefix(markdown, lineStartOffset, prefix)) {
    return undefined;
  }

  const match = /^\[[ xX]\][ \t]+/.exec(markdown.slice(startOffset));
  return match === null
    ? undefined
    : { endOffset: startOffset + match[0].length };
}

function isListMarkerPrefix(
  markdown: string,
  lineStartOffset: number,
  prefix: string,
): boolean {
  const containerPrefix = readContainerPrefix(prefix);
  if (containerPrefix === undefined) {
    return false;
  }

  const markerPrefix = prefix.slice(containerPrefix.length);
  const listMarker = readListMarkerMatch(
    markdown,
    lineStartOffset + containerPrefix.length,
    markerPrefix,
  );
  return listMarker !== null && listMarker.endOffset === markerPrefix.length;
}

function isContainerPrefix(prefix: string): boolean {
  return readContainerPrefix(prefix) === prefix;
}

function readContainerPrefix(prefix: string): string | undefined {
  const match = /^(?:(?: {0,3}>[ \t]?)+)?/.exec(prefix);
  return match === null ? undefined : match[0];
}

function readListMarkerMatch(
  markdown: string,
  lineStartOffset: number,
  line: string,
): { endOffset: number; indentWidth: number } | null {
  const match = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line);
  if (match === null) {
    return null;
  }

  const indent = match[1] ?? "";
  const indentWidth = readIndentWidth(indent);
  if (indentWidth <= 3 || isNestedListLine(markdown, lineStartOffset, line)) {
    return {
      endOffset: match[0].length,
      indentWidth,
    };
  }

  return null;
}

function isNestedListLine(
  markdown: string,
  lineStartOffset: number,
  line: string,
): boolean {
  const currentMarker = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line);
  const currentIndentWidth = readIndentWidth(currentMarker?.[1] ?? "");
  if (currentMarker === null || currentIndentWidth <= 3) {
    return false;
  }

  let previousLine = readPreviousLine(markdown, lineStartOffset);
  while (previousLine !== undefined) {
    if (previousLine.line.trim() === "") {
      return false;
    }

    const previousMarker = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(
      previousLine.line,
    );
    if (
      previousMarker !== null &&
      readIndentWidth(previousMarker[1] ?? "") < currentIndentWidth
    ) {
      return true;
    }

    previousLine = readPreviousLine(markdown, previousLine.startOffset);
  }

  return false;
}

function readIndentWidth(indent: string): number {
  let width = 0;
  for (const char of indent) {
    width += char === "\t" ? 4 : 1;
  }

  return width;
}

function collectFootnoteReferenceNumbers(
  markdown: string,
): FootnoteReferenceNumbers {
  const numbers = new Map<string, number>();
  let cursor = 0;

  while (cursor < markdown.length) {
    const startOffset = markdown.indexOf("[^", cursor);
    if (startOffset === -1) {
      break;
    }

    const endOffset = markdown.indexOf("]", startOffset + 2);
    if (endOffset === -1) {
      break;
    }

    const label = markdown.slice(startOffset + 2, endOffset);
    const normalizedLabel = normalizeReferenceLabel(label);
    if (
      normalizedLabel !== "" &&
      !isFootnoteDefinitionAt(markdown, startOffset, endOffset) &&
      hasFootnoteDefinition(markdown, label) &&
      !numbers.has(normalizedLabel)
    ) {
      numbers.set(normalizedLabel, numbers.size + 1);
    }

    cursor = endOffset + 1;
  }

  return numbers;
}

function readFootnoteReference(
  markdown: string,
  startOffset: number,
  footnoteReferenceNumbers: FootnoteReferenceNumbers,
): { value: string; endOffset: number } | undefined {
  if (!markdown.startsWith("[^", startOffset)) {
    return undefined;
  }

  const endOffset = markdown.indexOf("]", startOffset + 2);
  if (
    endOffset === -1 ||
    markdown.slice(startOffset + 2, endOffset).includes("\n") ||
    isFootnoteDefinitionAt(markdown, startOffset, endOffset)
  ) {
    return undefined;
  }

  const normalizedLabel = normalizeReferenceLabel(
    markdown.slice(startOffset + 2, endOffset),
  );
  const number = footnoteReferenceNumbers.get(normalizedLabel);
  return number === undefined
    ? undefined
    : {
        value: `[${number}]`,
        endOffset: endOffset + 1,
      };
}

function hasFootnoteDefinition(markdown: string, label: string): boolean {
  return hasDefinitionMatching(markdown, label, { footnote: true });
}

function hasReferenceDefinition(markdown: string, label: string): boolean {
  return hasDefinitionMatching(markdown, label, { footnote: false });
}

function hasDefinitionMatching(
  markdown: string,
  label: string,
  options: { footnote: boolean },
): boolean {
  const normalizedLabel = normalizeReferenceLabel(label);
  if (normalizedLabel === "" || normalizedLabel.startsWith("^")) {
    return false;
  }

  let lineStartOffset = 0;
  while (lineStartOffset <= markdown.length) {
    const lineEndOffset = readLineEndOffset(markdown, lineStartOffset);
    const line = markdown.slice(lineStartOffset, lineEndOffset);
    const match = /^(?: {0,3})\[(\^?)([^\]\n]+)\]:/.exec(line);
    const isFootnote = match?.[1] === "^";
    if (
      match?.[2] !== undefined &&
      isFootnote === options.footnote &&
      normalizeReferenceLabel(match[2]) === normalizedLabel
    ) {
      return true;
    }

    if (lineEndOffset >= markdown.length) {
      break;
    }
    lineStartOffset = lineEndOffset + 1;
  }

  return false;
}

function isFootnoteDefinitionAt(
  markdown: string,
  startOffset: number,
  endOffset: number,
): boolean {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  return (
    /^(?: {0,3})$/.test(markdown.slice(lineStartOffset, startOffset)) &&
    markdown[startOffset] === "[" &&
    markdown[startOffset + 1] === "^" &&
    markdown[endOffset + 1] === ":"
  );
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function readTableProjectionRow(
  markdown: string,
  startOffset: number,
):
  | { endOffset: number; cells: MarkdownRange[]; lineEndOffset: number }
  | undefined {
  const lineStartOffset = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  if (lineStartOffset !== startOffset) {
    return undefined;
  }

  const lineEndOffset = readLineEndOffset(markdown, startOffset);
  const line = markdown.slice(startOffset, lineEndOffset);
  if (isTableDelimiterLine(line) && hasPreviousTableDataRow(markdown, startOffset)) {
    return {
      cells: [],
      endOffset: readLineEndOffsetWithBreak(markdown, lineEndOffset),
      lineEndOffset,
    };
  }

  if (!isTableDataRow(line) || !isLineInMarkdownTable(markdown, startOffset, lineEndOffset)) {
    return undefined;
  }

  return {
    cells: readTableCellRanges(markdown, startOffset, lineEndOffset),
    endOffset: readLineEndOffsetWithBreak(markdown, lineEndOffset),
    lineEndOffset,
  };
}

function isLineInMarkdownTable(
  markdown: string,
  lineStartOffset: number,
  lineEndOffset: number,
): boolean {
  const nextLineStartOffset = lineEndOffset + 1;
  if (nextLineStartOffset < markdown.length) {
    const nextLineEndOffset = readLineEndOffset(markdown, nextLineStartOffset);
    if (isTableDelimiterLine(markdown.slice(nextLineStartOffset, nextLineEndOffset))) {
      return true;
    }
  }

  return hasPreviousTableDelimiter(markdown, lineStartOffset);
}

function hasPreviousTableDataRow(
  markdown: string,
  lineStartOffset: number,
): boolean {
  const previousLine = readPreviousLine(markdown, lineStartOffset);
  return previousLine !== undefined && isTableDataRow(previousLine.line);
}

function hasPreviousTableDelimiter(
  markdown: string,
  lineStartOffset: number,
): boolean {
  let previousLine = readPreviousLine(markdown, lineStartOffset);
  while (previousLine !== undefined) {
    if (isTableDelimiterLine(previousLine.line)) {
      return true;
    }

    if (!isTableDataRow(previousLine.line)) {
      return false;
    }

    previousLine = readPreviousLine(markdown, previousLine.startOffset);
  }

  return false;
}

function readPreviousLine(
  markdown: string,
  lineStartOffset: number,
): { line: string; startOffset: number } | undefined {
  if (lineStartOffset === 0) {
    return undefined;
  }

  const previousLineEndOffset = lineStartOffset - 1;
  const previousLineStartOffset =
    markdown.lastIndexOf("\n", previousLineEndOffset - 1) + 1;
  return {
    line: markdown.slice(previousLineStartOffset, previousLineEndOffset),
    startOffset: previousLineStartOffset,
  };
}

function isTableDataRow(line: string): boolean {
  return hasUnescapedPipe(line) && !isTableDelimiterLine(line);
}

function isTableDelimiterLine(line: string): boolean {
  const cells = splitTableLine(line)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function readTableCellRanges(
  markdown: string,
  lineStartOffset: number,
  lineEndOffset: number,
): MarkdownRange[] {
  let contentStartOffset = lineStartOffset;
  let contentEndOffset = lineEndOffset;

  if (markdown[contentStartOffset] === "|") {
    contentStartOffset += 1;
  }

  if (markdown[contentEndOffset - 1] === "|") {
    contentEndOffset -= 1;
  }

  const ranges: MarkdownRange[] = [];
  let cellStartOffset = contentStartOffset;
  let cursor = contentStartOffset;
  while (cursor <= contentEndOffset) {
    if (
      cursor === contentEndOffset ||
      (markdown[cursor] === "|" && !isEscapedMarkdownChar(markdown, cursor))
    ) {
      const range = trimTableCellRange(markdown, cellStartOffset, cursor);
      if (range.endOffset > range.startOffset) {
        ranges.push(range);
      }
      cellStartOffset = cursor + 1;
    }

    cursor += 1;
  }

  return ranges;
}

function trimTableCellRange(
  markdown: string,
  startOffset: number,
  endOffset: number,
): MarkdownRange {
  let trimmedStartOffset = startOffset;
  let trimmedEndOffset = endOffset;

  while (
    trimmedStartOffset < trimmedEndOffset &&
    /[ \t]/.test(markdown[trimmedStartOffset] ?? "")
  ) {
    trimmedStartOffset += 1;
  }

  while (
    trimmedEndOffset > trimmedStartOffset &&
    /[ \t]/.test(markdown[trimmedEndOffset - 1] ?? "")
  ) {
    trimmedEndOffset -= 1;
  }

  return {
    startOffset: trimmedStartOffset,
    endOffset: trimmedEndOffset,
  };
}

function splitTableLine(line: string): string[] {
  let content = line.trim();
  if (content.startsWith("|")) {
    content = content.slice(1);
  }
  if (content.endsWith("|")) {
    content = content.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "|" && !isEscapedMarkdownChar(content, index)) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char ?? "";
  }
  cells.push(cell);

  return cells;
}

function hasUnescapedPipe(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscapedMarkdownChar(line, index)) {
      return true;
    }
  }

  return false;
}

function isLinePrefixOnly(
  markdown: string,
  offset: number,
  marker: string,
): boolean {
  const lineStartOffset = markdown.lastIndexOf("\n", offset - 1) + 1;
  if (markdown.slice(lineStartOffset, offset).trim() !== "") {
    return false;
  }

  return markdown[offset] === marker;
}

function isEscapedMarkdownChar(markdown: string, offset: number): boolean {
  let backslashCount = 0;
  let cursor = offset - 1;

  while (cursor >= 0 && markdown[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
}

function mergeRanges(ranges: MarkdownRange[]): MarkdownRange[] {
  const sortedRanges = ranges
    .filter((range) => range.endOffset > range.startOffset)
    .toSorted((left, right) => left.startOffset - right.startOffset);
  const merged: MarkdownRange[] = [];

  for (const range of sortedRanges) {
    const previous = merged.at(-1);
    if (previous === undefined || range.startOffset > previous.endOffset) {
      merged.push({ ...range });
      continue;
    }

    previous.endOffset = Math.max(previous.endOffset, range.endOffset);
  }

  return merged;
}

function parseFenceLine(line: string):
  | { marker: "`" | "~"; length: number }
  | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  const fence = match?.[1];
  if (fence === undefined) {
    return undefined;
  }

  return {
    marker: fence[0] as "`" | "~",
    length: fence.length,
  };
}

function readLineEndOffset(markdown: string, lineStartOffset: number): number {
  const lineEndOffset = markdown.indexOf("\n", lineStartOffset);
  return lineEndOffset === -1 ? markdown.length : lineEndOffset;
}

function readLineEndOffsetWithBreak(
  markdown: string,
  lineEndOffset: number,
): number {
  return lineEndOffset < markdown.length ? lineEndOffset + 1 : lineEndOffset;
}

function readBacktickRunLength(markdown: string, startOffset: number): number {
  let cursor = startOffset;
  while (markdown[cursor] === "`") {
    cursor += 1;
  }

  return cursor - startOffset;
}
