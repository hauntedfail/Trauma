import { describe, expect, it } from "vitest";

import {
  applyHighlightMarkers,
  readRenderedMarkdownRangeText,
  resolveHighlightSelection,
  stripHighlightMarkers,
} from "../../../src/server/store/highlight-markers";

describe("highlight markdown markers", () => {
  it("resolves repeated selected text by offset and surrounding context", () => {
    const markdown = [
      "Alpha target appears in the opening paragraph.",
      "",
      "Beta target appears in the detail paragraph.",
    ].join("\n");
    const secondStart = markdown.lastIndexOf("target");

    const selection = resolveHighlightSelection(markdown, {
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

    const selection = resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
        text: "target",
        prefix: "",
        suffix: " target",
        startOffset: 0,
        endOffset: "target".length,
      }),
    ).toThrow("Selected markdown code cannot be highlighted");
  });

  it("resolves visible selections that span markdown emphasis syntax", () => {
    const markdown = "a **bold** b";

    expect(
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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

  it("projects rendered text for highlight storage", () => {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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
      resolveHighlightSelection(markdown, {
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

  it("inserts mark tags without rewriting markdown outside the selection", () => {
    const markdown = "Before **bold target** after.";
    const startOffset = markdown.indexOf("target");

    expect(
      applyHighlightMarkers(markdown, [
        {
          id: "hl-bold",
          startOffset,
          endOffset: startOffset + "target".length,
        },
      ]),
    ).toBe(
      'Before **bold <mark data-highlight-id="hl-bold">target</mark>** after.',
    );
  });

  it("rebuilds marks from canonical ranges instead of preserving stale tags", () => {
    const marked =
      'Alpha <mark data-highlight-id="stale">target</mark> and omega target.';
    const clean = stripHighlightMarkers(marked);
    const startOffset = clean.lastIndexOf("target");

    expect(
      applyHighlightMarkers(marked, [
        {
          id: "fresh",
          startOffset,
          endOffset: startOffset + "target".length,
        },
      ]),
    ).toBe('Alpha target and omega <mark data-highlight-id="fresh">target</mark>.');
  });

  it("does not strip author-provided plain mark tags", () => {
    expect(stripHighlightMarkers("<mark>plain</mark> highlight")).toBe(
      "<mark>plain</mark> highlight",
    );
  });

  it("preserves literal app mark examples in markdown code", () => {
    const markdown = [
      "Before <mark data-highlight-id=\"real\">real</mark>.",
      "",
      "```html",
      "<mark data-highlight-id=\"example\">literal</mark>",
      "```",
    ].join("\n");

    expect(stripHighlightMarkers(markdown)).toBe(
      [
        "Before real.",
        "",
        "```html",
        "<mark data-highlight-id=\"example\">literal</mark>",
        "```",
      ].join("\n"),
    );
  });

  it("rejects selections inside markdown code", () => {
    const markdown = "Before `literal` after.";
    const startOffset = markdown.indexOf("literal");

    expect(() =>
      resolveHighlightSelection(markdown, {
        text: "literal",
        prefix: "Before ",
        suffix: " after.",
        startOffset,
        endOffset: startOffset + "literal".length,
      }),
    ).toThrow("Selected markdown code cannot be highlighted");
  });
});
