import { describe, expect, it } from "vitest";

import {
  projectMarkdownToReaderText,
  readCanonicalReaderText,
} from "../../../src/server/store/flashback-markers";
import {
  projectTranslationMarkdownToReaderText,
} from "../../../src/server/translation/source-projection";

describe("translation source projection", () => {
  it.each([
    ["LF", "First sentence.\nSecond sentence."],
    ["CRLF", "First sentence.\r\nSecond sentence."],
    ["lone CR", "First sentence.\rSecond sentence."],
    ["LF hidden paragraph separators", "First sentence.\n\nSecond sentence."],
    ["CRLF hidden paragraph separators", "First sentence.\r\n\r\nSecond sentence."],
    ["entities", "Fish &amp; chips &copy; 2026."],
    [
      "Markdown",
      "# Heading\r\n\r\nRead [the docs](https://example.com) and `code`.\r\n",
    ],
  ])("preserves canonical reader text and protection for %s", (_, markdown) => {
    const canonical = projectMarkdownToReaderText(markdown);
    const projected = projectTranslationMarkdownToReaderText(markdown);

    expect(projected.text).toBe(readCanonicalReaderText(markdown));
    expect(projected.text).toBe(canonical.text);
    expect(projected.protectedOffsets).toEqual(canonical.protectedOffsets);
    expect(projected.sourceOffsets).toHaveLength(canonical.text.length);
    expect(projected.sourceEndOffsets).toHaveLength(canonical.text.length);
  });

  it("keeps a representative multi-megabyte CRLF source aligned to raw offsets", {
    timeout: 15_000,
  }, () => {
    const rawLine = "Large source line.\r\n";
    const readerLine = "Large source line.\n";
    const lineCount = 131_072;
    const markdown = rawLine.repeat(lineCount);

    const projected = projectTranslationMarkdownToReaderText(markdown);

    expect(projected.text).toBe(readerLine.repeat(lineCount));
    expect(projected.sourceOffsets).toHaveLength(projected.text.length);
    expect(projected.sourceEndOffsets).toHaveLength(projected.text.length);
    expect(projected.sourceOffsets[readerLine.length]).toBe(rawLine.length);
    expect(projected.sourceOffsets.at(-1)).toBe(markdown.length - 2);
    expect(projected.sourceEndOffsets.at(-1)).toBe(markdown.length);
  });
});
