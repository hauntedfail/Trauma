import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface ParsedTranslationMarkdown {
  bodyMarkdown: string;
  bodyOffset: number;
  diagnostics: string[];
  frontmatter: string;
  tree: Root;
}

export function splitMarkdownFrontmatter(sourceMarkdown: string): {
  bodyMarkdown: string;
  bodyOffset: number;
  frontmatter: string;
} {
  const opening = /^---(?:\r?\n)/.exec(sourceMarkdown);
  if (opening === null) {
    return { bodyMarkdown: sourceMarkdown, bodyOffset: 0, frontmatter: "" };
  }

  const afterOpening = sourceMarkdown.slice(opening[0].length);
  const closing = /\r?\n---(?:\r?\n|$)/.exec(afterOpening);
  if (closing === null || closing.index === undefined) {
    return { bodyMarkdown: sourceMarkdown, bodyOffset: 0, frontmatter: "" };
  }

  const end = opening[0].length + closing.index + closing[0].length;
  return {
    bodyMarkdown: sourceMarkdown.slice(end),
    bodyOffset: end,
    frontmatter: sourceMarkdown.slice(0, end),
  };
}

export function parseTranslationMarkdownAst(
  sourceMarkdown: string,
): ParsedTranslationMarkdown {
  const split = splitMarkdownFrontmatter(sourceMarkdown);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);
  const tree = processor.parse(split.bodyMarkdown) as Root;

  return {
    bodyMarkdown: split.bodyMarkdown,
    bodyOffset: split.bodyOffset,
    diagnostics: [],
    frontmatter: split.frontmatter,
    tree,
  };
}
