import { describe, expect, it } from "vitest";

import {
  applyHighlightMarkers,
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
});
