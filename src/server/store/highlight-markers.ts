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
  startOffset: number;
  endOffset: number;
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

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "\u2022",
  cent: "\u00a2",
  copy: "\u00a9",
  deg: "\u00b0",
  divide: "\u00f7",
  euro: "\u20ac",
  gt: ">",
  hellip: "\u2026",
  laquo: "\u00ab",
  ldquo: "\u201c",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  middot: "\u00b7",
  nbsp: "\u00a0",
  ndash: "\u2013",
  para: "\u00b6",
  plusmn: "\u00b1",
  pound: "\u00a3",
  quot: "\"",
  raquo: "\u00bb",
  rdquo: "\u201d",
  reg: "\u00ae",
  rsquo: "\u2019",
  sect: "\u00a7",
  times: "\u00d7",
  trade: "\u2122",
  yen: "\u00a5",
};

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

export function resolveHighlightSelection(
  markdown: string,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection {
  validateSelectionShape(selection);

  const cleanMarkdown = stripHighlightMarkers(markdown);
  const protectedRanges = findProtectedMarkdownRanges(cleanMarkdown);
  const projectedMarkdown = projectMarkdownText(cleanMarkdown, protectedRanges);
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

export function applyHighlightMarkers(
  markdown: string,
  highlights: HighlightMarkerRange[],
): string {
  const cleanMarkdown = stripHighlightMarkers(markdown);
  const protectedRanges = findProtectedMarkdownRanges(cleanMarkdown);
  const sortedHighlights = highlights.toSorted(
    (left, right) => left.startOffset - right.startOffset,
  );
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
    ...findInlineCodeRanges(markdown),
  ]);
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

    if (markdown[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const runLength = readBacktickRunLength(markdown, cursor);
    const closeOffset = markdown.indexOf("`".repeat(runLength), cursor + runLength);
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

function projectMarkdownText(
  markdown: string,
  protectedRanges: MarkdownRange[],
): ProjectedMarkdownText {
  const text: string[] = [];
  const sourceOffsets: number[] = [];
  const sourceEndOffsets: number[] = [];
  const protectedOffsets: boolean[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const link = parseInlineLink(markdown, cursor);
    if (
      link !== undefined &&
      !rangeOverlapsProtectedRanges(protectedRanges, cursor, link.endOffset)
    ) {
      appendProjectedSlice({
        markdown,
        protectedRanges,
        protectedValue: false,
        sourceOffsets,
        sourceEndOffsets,
        text,
        protectedOffsets,
        startOffset: link.labelStartOffset,
        endOffset: link.labelEndOffset,
      });
      cursor = link.endOffset;
      continue;
    }

    if (shouldSkipMarkdownSyntax(markdown, cursor, protectedRanges)) {
      cursor += 1;
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

function appendProjectedSlice(input: {
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
    if (shouldSkipMarkdownSyntax(input.markdown, offset, input.protectedRanges)) {
      offset += 1;
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

function readHtmlEntity(
  markdown: string,
  startOffset: number,
  maximumEndOffset: number,
): { value: string; endOffset: number } | undefined {
  const match = /^&(?:#([0-9]{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]+));/.exec(
    markdown.slice(startOffset, Math.min(maximumEndOffset, startOffset + 40)),
  );
  if (match === null) {
    return undefined;
  }

  const [raw, decimal, hexadecimal, named] = match;
  const value = decodeHtmlEntity({
    decimal,
    hexadecimal,
    named,
  });
  if (value === undefined) {
    return undefined;
  }

  return {
    value,
    endOffset: startOffset + raw.length,
  };
}

function decodeHtmlEntity(input: {
  decimal: string | undefined;
  hexadecimal: string | undefined;
  named: string | undefined;
}): string | undefined {
  if (input.decimal !== undefined) {
    return decodeNumericHtmlEntity(Number.parseInt(input.decimal, 10));
  }

  if (input.hexadecimal !== undefined) {
    return decodeNumericHtmlEntity(Number.parseInt(input.hexadecimal, 16));
  }

  if (input.named === undefined) {
    return undefined;
  }

  return NAMED_HTML_ENTITIES[input.named] ??
    NAMED_HTML_ENTITIES[input.named.toLowerCase()];
}

function decodeNumericHtmlEntity(codePoint: number): string | undefined {
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff
  ) {
    return undefined;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

function parseInlineLink(
  markdown: string,
  startOffset: number,
):
  | {
    labelStartOffset: number;
    labelEndOffset: number;
    endOffset: number;
  }
  | undefined {
  if (markdown[startOffset] !== "[" || markdown[startOffset - 1] === "!") {
    return undefined;
  }

  const labelEndOffset = markdown.indexOf("](", startOffset + 1);
  if (labelEndOffset === -1) {
    return undefined;
  }

  const destinationEndOffset = markdown.indexOf(")", labelEndOffset + 2);
  if (destinationEndOffset === -1) {
    return undefined;
  }

  return {
    labelStartOffset: startOffset + 1,
    labelEndOffset,
    endOffset: destinationEndOffset + 1,
  };
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
  if (char === "*" || char === "_" || char === "[" || char === "]") {
    return true;
  }

  if (char === "#" && isLinePrefixOnly(markdown, offset, "#")) {
    return true;
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
