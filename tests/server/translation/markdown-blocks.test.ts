import { describe, expect, it } from "vitest";

import { parseMarkdownTranslationBlocks } from "../../../src/server/translation/markdown-blocks";

describe("translation Markdown block manifest", () => {
  it.todo("does not translate inline math spans");
  it.todo("treats indented code blocks as non-translatable code");
  it.todo("preserves setext heading structure");
  it.todo("preserves Markdown link titles and reference labels");
  it.todo("does not protect ordinary prose as shell commands");

  it("excludes frontmatter and creates deterministic protected blocks", () => {
    const manifest = parseMarkdownTranslationBlocks(`---
id: memory
---
# Heading

Paragraph with \`inlineCode\` and [a link](https://example.com).

---

$$
E = mc^2
$$

\`\`\`ts
const value = "do not translate";
\`\`\`

| Term | Meaning |
| --- | --- |
| API | Application interface |

[^1]: Footnote text.
`);

    expect(manifest.frontmatter).toBe("---\nid: memory\n---\n");
    expect(manifest.blocks.map((block) => `${block.id} ${block.type}`)).toEqual([
      "b000001 heading",
      "b000002 inline_code_paragraph",
      "b000003 thematic_break",
      "b000004 math_block",
      "b000005 code_fence",
      "b000006 table",
      "b000007 footnote",
    ]);
    expect(manifest.blocks[1]?.protectedSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inline_code", value: "`inlineCode`" }),
        expect.objectContaining({
          kind: "markdown_link_destination",
          value: "https://example.com",
        }),
      ]),
    );
    expect(manifest.blocks[4]?.protectedSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "code_fence" }),
        expect.objectContaining({ kind: "identifier", value: "ts" }),
        expect.objectContaining({ kind: "identifier", value: "const" }),
        expect.objectContaining({ kind: "identifier", value: "value" }),
        expect.objectContaining({ kind: "identifier", value: "do" }),
        expect.objectContaining({ kind: "identifier", value: "not" }),
        expect.objectContaining({ kind: "identifier", value: "translate" }),
      ]),
    );
  });

  it("does not classify prose slashes or URL internals as file paths", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "[![Collabora Logo - Click/tap to navigate](https://www.collabora.com/assets/images/core/Collabora_Logo.svg)](https://www.collabora.com/)",
        "",
        "Keep `src/server/translation/prompt.ts` untouched.",
      ].join("\n"),
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).not.toContainEqual(
      expect.objectContaining({ kind: "file_path", value: "Click/tap" }),
    );
    expect(spans).not.toContainEqual(
      expect.objectContaining({
        kind: "file_path",
        value: "www.collabora.com/assets/images/core/Collabora_Logo.svg",
      }),
    );
    expect(spans).toContainEqual(
      expect.objectContaining({
        kind: "file_path",
        value: "src/server/translation/prompt.ts",
      }),
    );
  });

  it("does not classify Markdown link labels as citation markers", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "[Store](https://www.raycast.com/store) [Pro](https://www.raycast.com/pro)",
        "",
        "Prior work supports this claim [Smith2020].",
      ].join("\n"),
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).not.toContainEqual(
      expect.objectContaining({ kind: "citation_marker", value: "[Store]" }),
    );
    expect(spans).not.toContainEqual(
      expect.objectContaining({ kind: "citation_marker", value: "[Pro]" }),
    );
    expect(spans).toContainEqual(
      expect.objectContaining({
        kind: "markdown_link_destination",
        value: "https://www.raycast.com/store",
      }),
    );
    expect(spans).toContainEqual(
      expect.objectContaining({
        kind: "citation_marker",
        value: "[Smith2020]",
      }),
    );
  });

  it("keeps HTML attribute URLs bounded without requiring translated text", () => {
    const manifest = parseMarkdownTranslationBlocks(
      '<a href="https://example.com">Store</a>\n',
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toContainEqual(
      expect.objectContaining({ kind: "url", value: "https://example.com" }),
    );
    expect(spans).not.toContainEqual(
      expect.objectContaining({
        kind: "url",
        value: 'https://example.com">Store</a>',
      }),
    );
  });

  it("reads Markdown destinations with angle brackets and nested image links", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "[Spec](<https://example.com/a(b)>)",
        "",
        "[![Logo](assets/logo.svg)](docs/index.md)",
      ].join("\n"),
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toContainEqual(
      expect.objectContaining({
        kind: "markdown_link_destination",
        value: "<https://example.com/a(b)>",
      }),
    );
    expect(spans).not.toContainEqual(
      expect.objectContaining({
        kind: "html_tag",
        value: "<https://example.com/a(b)>",
      }),
    );
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "markdown_link_destination",
          value: "assets/logo.svg",
        }),
        expect.objectContaining({
          kind: "markdown_link_destination",
          value: "docs/index.md",
        }),
      ]),
    );
  });

  it("reads escaped and balanced Markdown link destinations", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "[Spec](https://example.com/a(b))",
        "",
        "[Escaped](https://example.com/a\\)b)",
      ].join("\n"),
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "markdown_link_destination",
          value: "https://example.com/a(b)",
        }),
        expect.objectContaining({
          kind: "markdown_link_destination",
          value: "https://example.com/a\\)b",
        }),
      ]),
    );
  });

  it("does not classify ordinary pipe prose as a table", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "JSON Lines | Examples",
        "",
        "| Surface | Use it for |",
        "| --- | --- |",
        "| API | Calls |",
      ].join("\n"),
    );

    expect(manifest.blocks.map((block) => `${block.id} ${block.type}`)).toEqual([
      "b000001 paragraph",
      "b000002 table",
    ]);
  });

  it("classifies Markdown tables with leading indentation", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "  | Term | Meaning |",
        "  | --- | --- |",
        "  | API | Calls |",
      ].join("\n"),
    );

    expect(manifest.blocks.map((block) => `${block.id} ${block.type}`)).toEqual([
      "b000001 table",
    ]);
  });

  it("keeps longer code fences open until a matching closing fence", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "````md",
        "```",
        "inner",
        "```",
        "````",
        "",
        "After.",
      ].join("\n"),
    );

    expect(manifest.blocks.map((block) => `${block.id} ${block.type}`)).toEqual([
      "b000001 code_fence",
      "b000002 paragraph",
    ]);
    expect(manifest.blocks[0]?.markdown).toBe([
      "````md\n",
      "```\n",
      "inner\n",
      "```\n",
      "````\n",
    ].join(""));
  });

  it("protects academic citation markers", () => {
    const manifest = parseMarkdownTranslationBlocks(
      [
        "Prior work supports this [1], [1, 2], [Smith et al., 2020], and [@smith2020].",
        "",
        "[Store](https://example.com/store)",
      ].join("\n"),
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "citation_marker", value: "[1]" }),
        expect.objectContaining({ kind: "citation_marker", value: "[1, 2]" }),
        expect.objectContaining({
          kind: "citation_marker",
          value: "[Smith et al., 2020]",
        }),
        expect.objectContaining({ kind: "citation_marker", value: "[@smith2020]" }),
      ]),
    );
    expect(spans).not.toContainEqual(
      expect.objectContaining({ kind: "citation_marker", value: "[Store]" }),
    );
  });

  it("preserves URL punctuation that can be part of the URL token", () => {
    const manifest = parseMarkdownTranslationBlocks(
      "See https://example.com/search? and https://example.com/bang!.\n",
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "url",
          value: "https://example.com/search?",
        }),
        expect.objectContaining({
          kind: "url",
          value: "https://example.com/bang!",
        }),
      ]),
    );
  });

  it("captures multi-backtick inline code spans", () => {
    const manifest = parseMarkdownTranslationBlocks(
      "Use ``code with ` backtick`` and `simple` spans.\n",
    );

    const spans = manifest.blocks.flatMap((block) => block.protectedSpans);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "inline_code",
          value: "``code with ` backtick``",
        }),
        expect.objectContaining({ kind: "inline_code", value: "`simple`" }),
      ]),
    );
  });
});
