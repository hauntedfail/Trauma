import { describe, expect, it } from "vitest";

import { parseMarkdownTranslationBlocks } from "../../../src/server/translation/markdown-blocks";

describe("translation Markdown block manifest", () => {
  it("excludes frontmatter and creates deterministic protected blocks", () => {
    const manifest = parseMarkdownTranslationBlocks(`---
id: memory
---
# Heading

Paragraph with \`inlineCode\` and [a link](https://example.com).

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
      "b000003 math_block",
      "b000004 code_fence",
      "b000005 table",
      "b000006 footnote",
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
    expect(manifest.blocks[3]?.protectedSpans).toEqual(
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
});
