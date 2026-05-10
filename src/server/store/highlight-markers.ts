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
  return markdown
    .replace(HIGHLIGHT_MARK_PAIR_PATTERN, "$1")
    .replace(HIGHLIGHT_OPEN_MARK_PATTERN, "");
}

export function resolveHighlightSelection(
  markdown: string,
  selection: HighlightSelectionInput,
): ResolvedHighlightSelection {
  validateSelectionShape(selection);

  const cleanMarkdown = stripHighlightMarkers(markdown);
  if (
    cleanMarkdown.slice(selection.startOffset, selection.endOffset) ===
    selection.text
  ) {
    return {
      text: selection.text,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
    };
  }

  const candidates = findTextCandidates(cleanMarkdown, selection.text);
  if (candidates.length === 0) {
    throw new HighlightMarkerError(
      "Selected text could not be found in CONTENT.md",
      "unresolvable_selection",
    );
  }

  const [best] = candidates
    .map((startOffset) => ({
      startOffset,
      score: scoreCandidate(cleanMarkdown, selection, startOffset),
      distance: Math.abs(startOffset - selection.startOffset),
    }))
    .toSorted((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.distance - right.distance;
    });

  if (best === undefined) {
    throw new HighlightMarkerError(
      "Selected text could not be resolved in CONTENT.md",
      "unresolvable_selection",
    );
  }

  return {
    text: selection.text,
    startOffset: best.startOffset,
    endOffset: best.startOffset + selection.text.length,
  };
}

export function applyHighlightMarkers(
  markdown: string,
  highlights: HighlightMarkerRange[],
): string {
  const cleanMarkdown = stripHighlightMarkers(markdown);
  const sortedHighlights = highlights.toSorted(
    (left, right) => left.startOffset - right.startOffset,
  );
  let cursor = 0;
  let marked = "";

  for (const highlight of sortedHighlights) {
    validateMarkerRange(highlight, cleanMarkdown.length, cursor);
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
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
