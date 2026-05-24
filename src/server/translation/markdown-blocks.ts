import type {
  ProtectedSpan,
  TranslationBlock,
  TranslationBlockType,
} from "./types";
import { readMarkdownDestinationRanges } from "./markdown-destinations";

export interface MarkdownBlockManifest {
  bodyMarkdown: string;
  blocks: TranslationBlock[];
  frontmatter: string;
}

interface ScanState {
  blocks: TranslationBlock[];
  nextBlockNumber: number;
  pendingBlank: string;
  pendingBlankStart: number | null;
  sectionPath: string[];
}

const BLOCK_LEVEL_HTML_PATTERN =
  /^\s*<(?:article|aside|blockquote|details|div|figure|figcaption|footer|header|hr|main|nav|ol|p|pre|section|table|ul)\b/i;

export function parseMarkdownTranslationBlocks(
  sourceMarkdown: string,
): MarkdownBlockManifest {
  const { bodyMarkdown, frontmatter } = splitFrontmatter(sourceMarkdown);
  const lines = splitMarkdownLines(bodyMarkdown);
  const lineStarts = readLineStartOffsets(lines);
  const state: ScanState = {
    blocks: [],
    nextBlockNumber: 1,
    pendingBlank: "",
    pendingBlankStart: null,
    sectionPath: [],
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      state.pendingBlankStart ??= lineStarts[index] ?? bodyMarkdown.length;
      state.pendingBlank += line;
      index += 1;
      continue;
    }

    const start = index;
    const type = classifyStartLine(line, state.sectionPath, lines[index + 1]);
    index = consumeBlock(lines, start, type);
    const markdown = state.pendingBlank + lines.slice(start, index).join("");
    const sourceStart = state.pendingBlankStart ?? lineStarts[start] ?? bodyMarkdown.length;
    state.pendingBlank = "";
    state.pendingBlankStart = null;
    appendBlock(state, type, markdown, sourceStart);
  }

  if (state.pendingBlank !== "") {
    appendBlock(
      state,
      "unknown_raw",
      state.pendingBlank,
      state.pendingBlankStart ?? bodyMarkdown.length - state.pendingBlank.length,
    );
  }

  return {
    bodyMarkdown,
    blocks: state.blocks,
    frontmatter,
  };
}

export function splitFrontmatter(sourceMarkdown: string): {
  bodyMarkdown: string;
  frontmatter: string;
} {
  const opening = /^---(?:\r?\n)/.exec(sourceMarkdown);
  if (opening === null) {
    return {
      bodyMarkdown: sourceMarkdown,
      frontmatter: "",
    };
  }

  const afterOpening = sourceMarkdown.slice(opening[0].length);
  const closing = /\r?\n---(?:\r?\n|$)/.exec(afterOpening);
  if (closing === null || closing.index === undefined) {
    return {
      bodyMarkdown: sourceMarkdown,
      frontmatter: "",
    };
  }

  const end = opening[0].length + closing.index + closing[0].length;
  return {
    bodyMarkdown: sourceMarkdown.slice(end),
    frontmatter: sourceMarkdown.slice(0, end),
  };
}

function splitMarkdownLines(markdown: string): string[] {
  if (markdown === "") {
    return [];
  }
  return markdown.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line !== "") ?? [];
}

function readLineStartOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length;
  }
  return offsets;
}

function classifyStartLine(
  line: string,
  sectionPath: string[],
  nextLine: string | undefined,
): TranslationBlockType {
  if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
    return "code_fence";
  }
  if (/^\s*\$\$\s*$/.test(line)) {
    return "math_block";
  }
  if (/^\s*<!--/.test(line) || BLOCK_LEVEL_HTML_PATTERN.test(line)) {
    return "html_block";
  }
  if (isThematicBreakLine(line)) {
    return "thematic_break";
  }
  if (/^\s{0,3}#{1,6}\s+\S/.test(line)) {
    return "heading";
  }
  if (isTableStartLine(line, nextLine)) {
    return "table";
  }
  if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) {
    return "list";
  }
  if (/^\s{0,3}>/.test(line)) {
    return "blockquote";
  }
  if (/^\s{0,3}\[\^[^\]]+\]:/.test(line)) {
    return "footnote";
  }
  if (isImageOrFigureLine(line)) {
    return "image_figure";
  }
  if (isBibliographyLine(line, sectionPath)) {
    return "bibliography_entry";
  }
  if (line.includes("`")) {
    return "inline_code_paragraph";
  }
  return "paragraph";
}

function consumeBlock(
  lines: string[],
  start: number,
  type: TranslationBlockType,
): number {
  switch (type) {
    case "code_fence":
      return consumeDelimitedBlock(lines, start, readFenceDelimiter(lines[start] ?? ""));
    case "math_block":
      return consumeDelimitedBlock(lines, start, "$$");
    case "html_block":
      return consumeUntilBlank(lines, start);
    case "table":
      return consumeWhile(lines, start, isTableLine);
    case "list":
      return consumeWhile(lines, start, (line, index) =>
        index === start ||
        line.trim() === "" ||
        /^\s{2,}\S/.test(line) ||
        /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
      );
    case "blockquote":
      return consumeWhile(lines, start, (line) =>
        line.trim() === "" || /^\s{0,3}>/.test(line)
      );
    case "footnote":
      return consumeWhile(lines, start, (line, index) =>
        index === start || /^\s{2,}\S/.test(line)
      );
    case "image_figure":
      return consumeImageWithCaption(lines, start);
    case "thematic_break":
      return start + 1;
    case "paragraph":
    case "inline_code_paragraph":
    case "bibliography_entry":
    case "caption":
    case "unknown_raw":
      return consumeUntilBlank(lines, start);
    case "heading":
      return start + 1;
  }
}

function appendBlock(
  state: ScanState,
  type: TranslationBlockType,
  markdown: string,
  sourceStart: number,
): void {
  if (type === "heading") {
    updateSectionPath(state, markdown);
  }

  const id = `b${String(state.nextBlockNumber).padStart(6, "0")}`;
  state.nextBlockNumber += 1;
  state.blocks.push({
    id,
    markdown,
    metadata: {},
    protectedSpans: extractProtectedSpans(markdown, id, type),
    sectionPath: [...state.sectionPath],
    sourceEnd: sourceStart + markdown.length,
    sourceStart,
    type,
  });
}

function updateSectionPath(state: ScanState, markdown: string): void {
  const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/m.exec(markdown);
  if (heading === null || heading[1] === undefined || heading[2] === undefined) {
    return;
  }
  const level = heading[1].length;
  const title = heading[2].trim();
  state.sectionPath = [
    ...state.sectionPath.slice(0, level - 1),
    title,
  ];
}

function consumeDelimitedBlock(
  lines: string[],
  start: number,
  delimiter: FenceDelimiter | "$$",
): number {
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      delimiter === "$$"
        ? /^\s*\$\$\s*$/.test(line)
        : isClosingFenceLine(line, delimiter)
    ) {
      return index + 1;
    }
  }
  return lines.length;
}

function consumeUntilBlank(lines: string[], start: number): number {
  return consumeWhile(lines, start, (line, index) =>
    index === start || line.trim() !== ""
  );
}

function consumeWhile(
  lines: string[],
  start: number,
  predicate: (line: string, index: number) => boolean,
): number {
  let index = start;
  while (index < lines.length && predicate(lines[index] ?? "", index)) {
    index += 1;
  }
  return index;
}

function consumeImageWithCaption(lines: string[], start: number): number {
  const afterImage = start + 1;
  const nextLine = lines[afterImage];
  if (nextLine !== undefined && nextLine.trim() !== "" && !looksLikeBlockStart(nextLine)) {
    return afterImage + 1;
  }
  return afterImage;
}

interface FenceDelimiter {
  char: "`" | "~";
  length: number;
}

function readFenceDelimiter(line: string): FenceDelimiter {
  const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "```";
  const char = marker.startsWith("~") ? "~" : "`";
  return {
    char,
    length: marker.length,
  };
}

function isClosingFenceLine(line: string, delimiter: FenceDelimiter): boolean {
  const trimmed = line.trimStart();
  if (trimmed.charAt(0) !== delimiter.char) {
    return false;
  }
  const length = countRun(trimmed, 0, delimiter.char);
  return length >= delimiter.length && trimmed.slice(length).trim() === "";
}

function isTableLine(line: string): boolean {
  return isPotentialTableRow(line);
}

function isTableStartLine(line: string, nextLine: string | undefined): boolean {
  return isPotentialTableRow(line) &&
    nextLine !== undefined &&
    isTableDelimiterLine(nextLine);
}

function isPotentialTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function isTableDelimiterLine(line: string): boolean {
  return /^\s{0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isThematicBreakLine(line: string): boolean {
  return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isImageOrFigureLine(line: string): boolean {
  return /^\s{0,3}(?:!\[[^\]]*\]\([^)]+\)|\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\))/.test(line) ||
    /^\s*<figure\b/i.test(line);
}

function isBibliographyLine(
  line: string,
  sectionPath: string[],
): boolean {
  const section = sectionPath.at(-1)?.toLowerCase() ?? "";
  return /^(references|bibliography|works cited)$/.test(section) &&
    /^\s{0,3}(?:[-*]|\[\d+\]|\d+[.)])\s+/.test(line);
}

function looksLikeBlockStart(line: string): boolean {
  return isThematicBreakLine(line) ||
    /^\s{0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>|```|~~~|\$\$|\|)/.test(line) ||
    isImageOrFigureLine(line) ||
    BLOCK_LEVEL_HTML_PATTERN.test(line);
}

function extractProtectedSpans(
  markdown: string,
  blockId: string,
  type: TranslationBlockType,
): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  if (type === "code_fence") {
    spans.push({ blockId, kind: "code_fence", value: markdown });
  }
  if (type === "math_block") {
    spans.push({ blockId, kind: "math", value: markdown });
  }
  collectInlineCodeSpans(spans, markdown, blockId);
  collectMarkdownLinkDestinations(spans, markdown, blockId);
  collectUrls(spans, markdown, blockId);
  collectCitationMarkers(spans, markdown, blockId);
  collectMatches(spans, markdown, blockId, /\[\^[^\]]+\]/g, "footnote_marker");
  collectHtmlTags(spans, markdown, blockId);
  collectMatches(
    spans,
    markdown,
    blockId,
    /(^|[\s([`])((?:\.{1,2}\/|~\/|\/)[A-Za-z0-9._~+@%/-]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9._-]+)(?=$|[\s)\],.;:!?`])/g,
    "file_path",
    2,
  );
  collectMatches(spans, markdown, blockId, /\b(?:bun|npm|pnpm|yarn|git|mise|codex)\s+[^\n]+/g, "command");
  collectMatches(spans, markdown, blockId, /\{[A-Za-z0-9_.-]+\}/g, "placeholder");
  if (type === "code_fence") {
    collectMatches(spans, markdown, blockId, /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, "identifier");
  }
  return spans;
}

function collectInlineCodeSpans(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
): void {
  let index = 0;
  while (index < markdown.length) {
    if (markdown.charAt(index) !== "`") {
      index += 1;
      continue;
    }

    const delimiterLength = countRun(markdown, index, "`");
    const closing = findBacktickRun(markdown, index + delimiterLength, delimiterLength);
    if (closing === -1) {
      index += delimiterLength;
      continue;
    }

    spans.push({
      blockId,
      kind: "inline_code",
      value: markdown.slice(index, closing + delimiterLength),
    });
    index = closing + delimiterLength;
  }
}

function countRun(markdown: string, start: number, char: string): number {
  let index = start;
  while (markdown.charAt(index) === char) {
    index += 1;
  }
  return index - start;
}

function findBacktickRun(
  markdown: string,
  start: number,
  delimiterLength: number,
): number {
  const delimiter = "`".repeat(delimiterLength);
  let index = start;
  while (index < markdown.length) {
    const next = markdown.indexOf(delimiter, index);
    if (next === -1) {
      return -1;
    }
    if (countRun(markdown, next, "`") === delimiterLength) {
      return next;
    }
    index = next + delimiterLength;
  }
  return -1;
}

function collectMarkdownLinkDestinations(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
): void {
  for (const range of readMarkdownDestinationRanges(markdown)) {
    spans.push({
      blockId,
      kind: "markdown_link_destination",
      value: range.destination,
    });
  }
}

function collectUrls(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
): void {
  const pattern = /https?:\/\//g;
  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    const value = readUrlToken(markdown, match.index);
    if (value !== "") {
      spans.push({ blockId, kind: "url", value });
    }
  }
}

function readUrlToken(markdown: string, start: number): string {
  let end = start;
  while (end < markdown.length && !isUrlTerminator(markdown.charAt(end))) {
    end += 1;
  }
  return trimUrlToken(markdown.slice(start, end));
}

function isUrlTerminator(char: string): boolean {
  return char === "" ||
    /\s/.test(char) ||
    char === "<" ||
    char === ">" ||
    char === "\"" ||
    char === "'";
}

function trimUrlToken(value: string): string {
  let trimmed = value;
  while (/[.,;:]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  while (trimmed.endsWith(")") && countLiteralOccurrences(trimmed, ")") > countLiteralOccurrences(trimmed, "(")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function countLiteralOccurrences(text: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(value, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + value.length;
  }
  return count;
}

function collectCitationMarkers(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
): void {
  const pattern = /\[(?:\d+(?:\s*(?:,|;|-|–)\s*\d+)*|@[A-Za-z0-9_:.#/$%&?+~=-]+(?:\s*[;,]\s*@[A-Za-z0-9_:.#/$%&?+~=-]+)*|[A-Za-z][^\]\n]*(?:\d{4}|et al\.)[^\]\n]*)\]/g;
  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined || isInlineMarkdownLinkLabel(markdown, match)) {
      continue;
    }
    const value = match[0];
    if (value.trim() !== "") {
      spans.push({ blockId, kind: "citation_marker", value });
    }
  }
}

function isInlineMarkdownLinkLabel(
  markdown: string,
  match: RegExpMatchArray,
): boolean {
  const matchStart = match.index ?? 0;
  const matchEnd = matchStart + (match[0]?.length ?? 0);
  return markdown.charAt(matchEnd) === "(";
}

function collectHtmlTags(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
): void {
  collectMatches(
    spans,
    markdown,
    blockId,
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>/g,
    "html_tag",
  );
}

function collectMatches(
  spans: ProtectedSpan[],
  markdown: string,
  blockId: string,
  pattern: RegExp,
  kind: ProtectedSpan["kind"],
  group = 0,
): void {
  for (const match of markdown.matchAll(pattern)) {
    const value = match[group];
    if (value !== undefined && value.trim() !== "") {
      spans.push({ blockId, kind, value });
    }
  }
}
