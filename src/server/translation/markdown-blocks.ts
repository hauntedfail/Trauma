import type {
  ProtectedSpan,
  TranslationBlock,
  TranslationBlockType,
} from "./types";

export interface MarkdownBlockManifest {
  bodyMarkdown: string;
  blocks: TranslationBlock[];
  frontmatter: string;
}

interface ScanState {
  blocks: TranslationBlock[];
  nextBlockNumber: number;
  pendingBlank: string;
  sectionPath: string[];
}

const BLOCK_LEVEL_HTML_PATTERN =
  /^\s*<(?:article|aside|blockquote|details|div|figure|figcaption|footer|header|hr|main|nav|ol|p|pre|section|table|ul)\b/i;

export function parseMarkdownTranslationBlocks(
  sourceMarkdown: string,
): MarkdownBlockManifest {
  const { bodyMarkdown, frontmatter } = splitFrontmatter(sourceMarkdown);
  const lines = splitMarkdownLines(bodyMarkdown);
  const state: ScanState = {
    blocks: [],
    nextBlockNumber: 1,
    pendingBlank: "",
    sectionPath: [],
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      state.pendingBlank += line;
      index += 1;
      continue;
    }

    const start = index;
    const type = classifyStartLine(line, state.sectionPath);
    index = consumeBlock(lines, start, type);
    const markdown = state.pendingBlank + lines.slice(start, index).join("");
    state.pendingBlank = "";
    appendBlock(state, type, markdown);
  }

  if (state.pendingBlank !== "") {
    appendBlock(state, "unknown_raw", state.pendingBlank);
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

function classifyStartLine(
  line: string,
  sectionPath: string[],
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
  if (isTableLine(line)) {
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
  delimiter: string,
): number {
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      delimiter === "$$"
        ? /^\s*\$\$\s*$/.test(line)
        : line.trimStart().startsWith(delimiter)
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

function readFenceDelimiter(line: string): string {
  const trimmed = line.trimStart();
  return trimmed.startsWith("~~~") ? "~~~" : "```";
}

function isTableLine(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
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
  collectMatches(spans, markdown, blockId, /`[^`\n]+`/g, "inline_code");
  collectMatches(spans, markdown, blockId, /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "markdown_link_destination", 1);
  collectMatches(spans, markdown, blockId, /https?:\/\/[^\s)]+/g, "url");
  collectMatches(spans, markdown, blockId, /\[[A-Za-z][A-Za-z0-9-]*(?:[,;]\s*[A-Za-z][A-Za-z0-9-]*)*\]/g, "citation_marker");
  collectMatches(spans, markdown, blockId, /\[\^[^\]]+\]/g, "footnote_marker");
  collectMatches(spans, markdown, blockId, /<\/?[A-Za-z][^>]*>/g, "html_tag");
  collectMatches(spans, markdown, blockId, /\b(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\b/g, "file_path");
  collectMatches(spans, markdown, blockId, /\b(?:bun|npm|pnpm|yarn|git|mise|codex)\s+[^\n]+/g, "command");
  collectMatches(spans, markdown, blockId, /\{[A-Za-z0-9_.-]+\}/g, "placeholder");
  if (type === "code_fence") {
    collectMatches(spans, markdown, blockId, /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, "identifier");
  }
  return spans;
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
