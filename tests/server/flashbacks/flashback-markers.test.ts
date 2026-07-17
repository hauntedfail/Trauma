import { describe, expect, it } from "vitest";

import {
  applyFlashbackMarkers,
  projectMarkdownToReaderText,
  readRenderedMarkdownRangeText,
  resolveFlashbackSelection,
  stripFlashbackMarkers,
} from "../../../src/server/store/flashback-markers";

describe("flashback markdown markers", () => {
  it("resolves repeated selected text by offset and surrounding context", () => {
    const markdown = [
      "Alpha target appears in the opening paragraph.",
      "",
      "Beta target appears in the detail paragraph.",
    ].join("\n");
    const secondStart = markdown.lastIndexOf("target");

    const selection = resolveFlashbackSelection(markdown, {
      text: "target",
      prefix: "Beta ",
      suffix: " appears",
      startOffset: secondStart,
      endOffset: secondStart + "target".length,
    });

    expect(selection).toEqual({
      text: "target",
      startOffset: secondStart,
      endOffset: secondStart + "target".length,
    });
  });

  it("resolves repeated rendered text through markdown link syntax", () => {
    const markdown = "[target](https://very-long.example/path) target";
    const renderedOffset = "target ".length;

    const selection = resolveFlashbackSelection(markdown, {
      text: "target",
      prefix: "target ",
      suffix: "",
      startOffset: renderedOffset,
      endOffset: renderedOffset + "target".length,
    });

    expect(selection).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("rejects protected rendered selections before checking duplicate text", () => {
    const markdown = "`target` target";

    expect(() =>
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: " target",
        startOffset: 0,
        endOffset: "target".length,
      }),
    ).toThrow("Selected markdown code cannot be flashbacked");
  });

  it("resolves visible selections that span markdown emphasis syntax", () => {
    const markdown = "a **bold** b";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "a bold b",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "a bold b".length,
      }),
    ).toEqual({
      text: "a bold b",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("resolves visible selections that span markdown link syntax", () => {
    const markdown = "a [linked](https://example.test) b";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "a linked b",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "a linked b".length,
      }),
    ).toEqual({
      text: "a linked b",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("resolves decoded rendered entities back to encoded markdown", () => {
    const markdown = "Tom &amp; Jerry";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "Tom & Jerry",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "Tom & Jerry".length,
      }),
    ).toEqual({
      text: "Tom & Jerry",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("resolves common named entities back to encoded markdown", () => {
    const markdown = "Tom &rarr; Jerry";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "Tom \u2192 Jerry",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "Tom \u2192 Jerry".length,
      }),
    ).toEqual({
      text: "Tom \u2192 Jerry",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("skips inline HTML tags when resolving rendered text", () => {
    const markdown = "Alpha <span>target</span> omega";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "Alpha target omega",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "Alpha target omega".length,
      }),
    ).toEqual({
      text: "Alpha target omega",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("projects rendered text for flashback storage", () => {
    const markdown = "a **bold** and <span>linked</span>";

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("a bold and linked");
  });

  it("projects list markers out before resolving duplicate text", () => {
    const markdown = ["- target", "", "target"].join("\n");

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.indexOf("target"),
      endOffset: markdown.indexOf("target") + "target".length,
    });
  });

  it("treats escaped backticks as literal text", () => {
    const markdown = "\\`target\\` target";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "`target`",
        prefix: "",
        suffix: " target",
        startOffset: 0,
        endOffset: "`target`".length,
      }),
    ).toEqual({
      text: "`target`",
      startOffset: 0,
      endOffset: "\\`target\\`".length,
    });
  });

  it("skips image markdown when resolving rendered text", () => {
    const markdown = "![target](https://example.test/image.png) target";
    const renderedOffset = " ".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("resolves visible selections that span reference link syntax", () => {
    const markdown = [
      "a [linked][ref] b",
      "",
      "[ref]: https://example.test",
    ].join("\n");

    expect(
      resolveFlashbackSelection(markdown, {
        text: "a linked b",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "a linked b".length,
      }),
    ).toEqual({
      text: "a linked b",
      startOffset: 0,
      endOffset: "a [linked][ref] b".length,
    });
  });

  it("projects table syntax out before resolving duplicate text", () => {
    const markdown = [
      "target",
      "",
      "| Label |",
      "| --- |",
      "| target |",
    ].join("\n");
    const renderedOffset = "target\n\nLabel\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "Label\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("projects strikethrough delimiters out before resolving visible text", () => {
    const markdown = "a ~~old~~ b";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "a old b",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "a old b".length,
      }),
    ).toEqual({
      text: "a old b",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("skips hidden paragraph separators before scoring duplicate text", () => {
    const markdown = ["target", "", "target", "", "target"].join("\n");
    const renderedOffset = "target\ntarget\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target\ntarget\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("decodes all CommonMark ASCII punctuation escapes", () => {
    const markdown = "foo\\:bar target";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "foo:bar target",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "foo:bar target".length,
      }),
    ).toEqual({
      text: "foo:bar target",
      startOffset: 0,
      endOffset: markdown.length,
    });
  });

  it("projects task-list checkbox markers out before resolving duplicate text", () => {
    const markdown = ["- [x] target", "- [ ] target"].join("\n");
    const renderedOffset = "target\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("stores rendered task-list text without checkbox source markers", () => {
    const markdown = "- [x] target";

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("target");
  });

  it("rejects selections inside indented markdown code", () => {
    const markdown = ["Before target", "", "    target"].join("\n");

    expect(() =>
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "\n",
        suffix: "",
        startOffset: "Before target\n\n".length,
        endOffset: "Before target\n\ntarget".length,
      }),
    ).toThrow("Selected markdown code cannot be flashbacked");
  });

  it("does not treat nested list items as indented code", () => {
    const markdown = ["- parent", "    - child target", "", "target"].join("\n");
    const renderedOffset = "parent\n".length;
    const childStartOffset = markdown.indexOf("child target");

    expect(
      resolveFlashbackSelection(markdown, {
        text: "child target",
        prefix: "parent\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "child target".length,
      }),
    ).toEqual({
      text: "child target",
      startOffset: childStartOffset,
      endOffset: childStartOffset + "child target".length,
    });
  });

  it("projects blockquote markers out before resolving duplicate text", () => {
    const markdown = ["target", "", "> target"].join("\n");
    const renderedOffset = "target\n\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "\n\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("projects list markers after blockquote prefixes out of reader text", () => {
    const markdown = "> - target";

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("target");
  });

  it("rejects selections inside blockquoted fenced code", () => {
    const markdown = ["> ```", "> target", "> ```", "", "target"].join("\n");

    expect(() =>
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "target".length,
      }),
    ).toThrow("Selected markdown code cannot be flashbacked");
  });

  it("stores rendered blockquote text without quote source markers", () => {
    const markdown = "> target";

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("target");
  });

  it("parses balanced parentheses in inline link destinations", () => {
    const markdown = "[target](https://example.test/a_(b)) target";
    const renderedOffset = "target ".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target ",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("does not let link-destination backticks disable link projection", () => {
    const markdown = "[target](https://example.test/`v`) target";
    const renderedOffset = "target ".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target ",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("stores rendered link text without balanced destination remnants", () => {
    const markdown = "[target](https://example.test/a_(b)) target";

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("target target");
  });

  it("maps rendered autolinks to the full source autolink before marking", () => {
    const markdown = "<https://example.test>";

    const selection = resolveFlashbackSelection(markdown, {
      text: "https://example.test",
      prefix: "",
      suffix: "",
      startOffset: 0,
      endOffset: "https://example.test".length,
    });

    expect(selection).toEqual({
      text: "https://example.test",
      startOffset: 0,
      endOffset: markdown.length,
    });
    expect(applyFlashbackMarkers(markdown, [{ id: "hl-link", ...selection }]))
      .toBe('<mark data-flashback-id="hl-link"><https://example.test></mark>');
  });

  it("preserves literal markdown inside raw HTML blocks", () => {
    const markdown = "<div>**target**</div> target";
    const renderedOffset = "**target** ".length;

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: "<div>**target**</div>".length,
      }),
    ).toBe("**target**");
    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "**target** ",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("maps shortcut reference link labels to the full source label", () => {
    const markdown = ["[target]", "", "[target]: https://example.test"].join("\n");

    const selection = resolveFlashbackSelection(markdown, {
      text: "target",
      prefix: "",
      suffix: "",
      startOffset: 0,
      endOffset: "target".length,
    });

    expect(selection).toEqual({
      text: "target",
      startOffset: 0,
      endOffset: "[target]".length,
    });
    expect(applyFlashbackMarkers(markdown, [{ id: "hl-shortcut", ...selection }]))
      .toBe(
        [
          '<mark data-flashback-id="hl-shortcut">[target]</mark>',
          "",
          "[target]: https://example.test",
        ].join("\n"),
      );
  });

  it("maps collapsed reference link labels to the full source label", () => {
    const markdown = [
      "[target][] target",
      "",
      "[target]: https://example.test",
    ].join("\n");

    const selection = resolveFlashbackSelection(markdown, {
      text: "target",
      prefix: "",
      suffix: " target",
      startOffset: 0,
      endOffset: "target".length,
    });

    expect(selection).toEqual({
      text: "target",
      startOffset: 0,
      endOffset: "[target][]".length,
    });
    expect(applyFlashbackMarkers(markdown, [{ id: "hl-collapsed", ...selection }]))
      .toBe(
        [
          '<mark data-flashback-id="hl-collapsed">[target][]</mark> target',
          "",
          "[target]: https://example.test",
        ].join("\n"),
      );
  });

  it("keeps unresolved reference syntax in the reader projection", () => {
    const markdown = "[target][missing] target";
    const renderedOffset = "[target][missing] ".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "[target][missing] ",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("[target][missing] target");
  });

  it("parses nested brackets in link labels", () => {
    const markdown = "[see [target] details](https://long.example) target";
    const renderedOffset = "see [target] details ".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "details ",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe("see [target] details target");
  });

  it("projects hard-break source markers out of visible selections", () => {
    const hardBreakWithSpaces = "line  \ntarget";
    const hardBreakWithBackslash = "line\\\ntarget";

    expect(
      resolveFlashbackSelection(hardBreakWithSpaces, {
        text: "line\ntarget",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "line\ntarget".length,
      }),
    ).toEqual({
      text: "line\ntarget",
      startOffset: 0,
      endOffset: hardBreakWithSpaces.length,
    });
    expect(
      readRenderedMarkdownRangeText(hardBreakWithBackslash, {
        startOffset: 0,
        endOffset: hardBreakWithBackslash.length,
      }),
    ).toBe("line\ntarget");
  });

  it.each([
    ["an ordinary space", "alpha beta", "alpha beta"],
    ["a single trailing space", "line \nnext", "line \nnext"],
    ["two spaces inside a line", "alpha  beta", "alpha  beta"],
    [
      "a long non-trailing space run",
      `alpha${" ".repeat(4_096)}beta`,
      `alpha${" ".repeat(4_096)}beta`,
    ],
    ["two trailing spaces before LF", "line  \nnext", "line\nnext"],
    ["three trailing spaces before CRLF", "line   \r\nnext", "line\nnext"],
    ["two trailing spaces at EOF", "line  ", "line"],
    ["a backslash break before LF", "line\\\nnext", "line\nnext"],
    ["a backslash break before CRLF", "line\\\r\nnext", "line\nnext"],
  ])("preserves reader projection semantics for %s", (_, markdown, expected) => {
    expect(projectMarkdownToReaderText(markdown).text).toBe(expected);
  });

  it("skips sanitized raw HTML block contents before resolving duplicate text", () => {
    const markdown = "<script>target</script> target";

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: " ",
        suffix: "",
        startOffset: 1,
        endOffset: 1 + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("rejects selections inside raw HTML code elements", () => {
    for (const markdown of [
      "<code>target</code> target",
      "<pre><code>target</code></pre> target",
    ]) {
      expect(() =>
        resolveFlashbackSelection(markdown, {
          text: "target",
          prefix: "",
          suffix: " target",
          startOffset: 0,
          endOffset: "target".length,
        }),
      ).toThrow("Selected markdown code cannot be flashbacked");
    }
  });

  it("skips iframe fallback contents before resolving duplicate text", () => {
    const markdown =
      '<iframe src="https://www.youtube.com/embed/demo">target</iframe> target';

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: " ",
        suffix: "",
        startOffset: 1,
        endOffset: 1 + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: markdown.length,
      }),
    ).toBe(" target");
  });

  it("projects footnote references as rendered reference numbers", () => {
    const markdown = [
      "alpha[^long-note] omega",
      "",
      "[^long-note]: hidden note",
    ].join("\n");

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: "alpha[^long-note] omega".length,
      }),
    ).toBe("alpha[1] omega");
    expect(
      resolveFlashbackSelection(markdown, {
        text: "alpha[1] omega",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "alpha[1] omega".length,
      }),
    ).toEqual({
      text: "alpha[1] omega",
      startOffset: 0,
      endOffset: "alpha[^long-note] omega".length,
    });
  });

  it("skips footnote definitions before resolving duplicate text", () => {
    const markdown = [
      "target",
      "",
      "[^long-note]: hidden target",
      "    continuation target",
      "",
      "target",
    ].join("\n");
    const renderedOffset = "target\n\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "\n\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("consumes full multiline reference definitions", () => {
    const markdown = [
      "[ref]: https://example.test",
      '  "title target"',
      "",
      "target",
    ].join("\n");

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("projects thematic break lines out before resolving duplicate text", () => {
    const markdown = ["target", "", "---", "", "target"].join("\n");
    const renderedOffset = "target\n\n".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "\n\n",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("projects heading marker syntax out of reader text", () => {
    const markdown = ["# target #", "", "target"].join("\n");
    const renderedOffset = "target".length;

    expect(
      readRenderedMarkdownRangeText(markdown, {
        startOffset: 0,
        endOffset: "# target #".length,
      }),
    ).toBe("target");
    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("skips setext heading underline markers", () => {
    const markdown = ["target", "===", "", "target"].join("\n");
    const renderedOffset = "target".length;

    expect(
      resolveFlashbackSelection(markdown, {
        text: "target",
        prefix: "target",
        suffix: "",
        startOffset: renderedOffset,
        endOffset: renderedOffset + "target".length,
      }),
    ).toEqual({
      text: "target",
      startOffset: markdown.lastIndexOf("target"),
      endOffset: markdown.lastIndexOf("target") + "target".length,
    });
  });

  it("trims syntax-only edges from stored flashback ranges", () => {
    const markdown = "a [linked](url) b";
    const fullFlashback = resolveFlashbackSelection(markdown, {
      text: "a linked b",
      prefix: "",
      suffix: "",
      startOffset: 0,
      endOffset: "a linked b".length,
    });
    const linkedSelection = resolveFlashbackSelection(markdown, {
      text: "linked",
      prefix: "a ",
      suffix: " b",
      startOffset: "a ".length,
      endOffset: "a linked".length,
    });

    expect(
      applyFlashbackMarkers(markdown, [
        {
          id: "left",
          startOffset: fullFlashback.startOffset,
          endOffset: linkedSelection.startOffset,
        },
        {
          id: "right",
          startOffset: linkedSelection.endOffset,
          endOffset: fullFlashback.endOffset,
        },
      ]),
    ).toBe(
      '<mark data-flashback-id="left">a </mark>[linked](url)<mark data-flashback-id="right"> b</mark>',
    );
  });

  it("inserts mark tags without rewriting markdown outside the selection", () => {
    const markdown = "Before **bold target** after.";
    const startOffset = markdown.indexOf("target");

    expect(
      applyFlashbackMarkers(markdown, [
        {
          id: "hl-bold",
          startOffset,
          endOffset: startOffset + "target".length,
        },
      ]),
    ).toBe(
      'Before **bold <mark data-flashback-id="hl-bold">target</mark>** after.',
    );
  });

  it("rebuilds marks from canonical ranges instead of preserving stale tags", () => {
    const marked =
      'Alpha <mark data-flashback-id="stale">target</mark> and omega target.';
    const clean = stripFlashbackMarkers(marked);
    const startOffset = clean.lastIndexOf("target");

    expect(
      applyFlashbackMarkers(marked, [
        {
          id: "fresh",
          startOffset,
          endOffset: startOffset + "target".length,
        },
      ]),
    ).toBe('Alpha target and omega <mark data-flashback-id="fresh">target</mark>.');
  });

  it("strips legacy highlight marks before resolving Flashback ranges", () => {
    const marked =
      'Alpha <mark data-highlight-id="legacy-highlight">target</mark> and omega.';

    expect(stripFlashbackMarkers(marked)).toBe("Alpha target and omega.");
  });

  it("does not render hashed canonical ranges against changed reader text", () => {
    expect(
      applyFlashbackMarkers("Alpha target.", [
        {
          id: "stale-hash",
          text: "target",
          startOffset: "Alpha ".length,
          endOffset: "Alpha target".length,
          contentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      ]),
    ).toBe("Alpha target.");
  });

  it("does not strip author-provided plain mark tags", () => {
    expect(stripFlashbackMarkers("<mark>plain</mark> flashback")).toBe(
      "<mark>plain</mark> flashback",
    );
  });

  it("preserves literal app mark examples in markdown code", () => {
    const markdown = [
      "Before <mark data-flashback-id=\"real\">real</mark>.",
      "",
      "```html",
      "<mark data-flashback-id=\"example\">literal</mark>",
      "```",
    ].join("\n");

    expect(stripFlashbackMarkers(markdown)).toBe(
      [
        "Before real.",
        "",
        "```html",
        "<mark data-flashback-id=\"example\">literal</mark>",
        "```",
      ].join("\n"),
    );
  });

  it("rejects selections inside markdown code", () => {
    const markdown = "Before `literal` after.";
    const startOffset = markdown.indexOf("literal");

    expect(() =>
      resolveFlashbackSelection(markdown, {
        text: "literal",
        prefix: "Before ",
        suffix: " after.",
        startOffset,
        endOffset: startOffset + "literal".length,
      }),
    ).toThrow("Selected markdown code cannot be flashbacked");
  });
});
