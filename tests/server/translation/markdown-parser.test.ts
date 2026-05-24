import { describe, expect, it } from "vitest";

import {
  parseTranslationMarkdownAst,
  splitMarkdownFrontmatter,
} from "../../../src/server/translation/markdown-parser";

describe("translation Markdown parser adapter", () => {
  it("preserves raw frontmatter separately from the Markdown body", () => {
    const parsed = splitMarkdownFrontmatter("---\nid: memory\n---\n# Title\n");

    expect(parsed.frontmatter).toBe("---\nid: memory\n---\n");
    expect(parsed.bodyMarkdown).toBe("# Title\n");
    expect(parsed.bodyOffset).toBe("---\nid: memory\n---\n".length);
  });

  it("parses GFM tables, footnotes, math, and indented code with positions", () => {
    const parsed = parseTranslationMarkdownAst([
      "# Title",
      "",
      "Paragraph with $x+y$ and [docs](https://example.com).",
      "",
      "    const value = 1;",
      "",
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "",
      "[^1]: Footnote text.",
      "",
    ].join("\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.tree.type).toBe("root");
    expect(parsed.bodyMarkdown).toContain("| A | B |");
    expect(parsed.tree.children.some((node) => node.type === "table")).toBe(true);
    expect(parsed.tree.children.some((node) => node.type === "code")).toBe(true);
    expect(JSON.stringify(parsed.tree)).toContain("\"position\"");
  });
});
