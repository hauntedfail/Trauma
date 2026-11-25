import { describe, expect, it } from "vitest";

import {
  markdownToSearchText,
  stripFrontmatter,
} from "../../../src/server/search/markdown-text";

describe("markdownToSearchText", () => {
  it("strips leading YAML frontmatter from CONTENT.md", () => {
    const raw = [
      "---",
      'id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001"',
      'url: "https://example.com/article"',
      'title: "Example"',
      'captured_at: "2026-05-09T00:00:00.000Z"',
      'extraction_status: "success"',
      "---",
      "# Actual Body Heading",
      "",
      "Body paragraph text.",
    ].join("\n");

    expect(stripFrontmatter(raw)).toBe("# Actual Body Heading\n\nBody paragraph text.");
    expect(markdownToSearchText(raw)).toBe("Actual Body Heading Body paragraph text.");
  });

  it("strips markdown syntax while keeping searchable prose, code, and link labels", () => {
    const markdown = [
      "# Main Heading",
      "",
      "<!-- hidden html comment -->",
      "Read **bold**, *italic*, ~~strike~~, and `inline_code` with snake_case_identifier.",
      "",
      "> Quoted insight with [link label](https://example.com/path \"Title\") and ![diagram alt](https://example.com/img.png).",
      "",
      "- [x] First task item",
      "- [ ] Second task item",
      "1. Numbered item",
      "",
      "```ts",
      "const value = computeScore(42);",
      "```",
      "",
      "| Col A | Col B |",
      "| --- | :---: |",
      "| Alpha | Beta |",
      "",
      "---",
      "",
      "<div>HTML wrapped text</div>",
    ].join("\n");

    const plain = markdownToSearchText(markdown);

    expect(plain).not.toContain("hidden html comment");
    expect(plain).not.toContain("https://example.com");
    expect(plain).not.toContain("```");
    expect(plain).not.toContain("<div>");
    expect(plain).toContain("Main Heading");
    expect(plain).toContain("bold");
    expect(plain).toContain("italic");
    expect(plain).toContain("strike");
    expect(plain).toContain("inline_code");
    expect(plain).toContain("snake_case_identifier");
    expect(plain).toContain("link label");
    expect(plain).toContain("diagram alt");
    expect(plain).toContain("First task item");
    expect(plain).toContain("const value = computeScore(42);");
    expect(plain).toContain("Alpha Beta");
    expect(plain).toContain("HTML wrapped text");
  });

  it("preserves Japanese text alongside English markdown", () => {
    const markdown = [
      "---",
      'id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f002"',
      "---",
      "## 東京のカフェ巡り",
      "",
      "今日は**東京都渋谷区**で[スペシャルティコーヒー](https://example.jp/coffee)を飲みました。",
    ].join("\n");

    expect(markdownToSearchText(markdown)).toBe(
      "東京のカフェ巡り 今日は東京都渋谷区で スペシャルティコーヒー を飲みました。",
    );
  });
});
