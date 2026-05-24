import { describe, expect, it } from "vitest";

import {
  assertMarkdownStructurePreserved,
  createMarkdownStructureFingerprint,
} from "../../../src/server/translation/structure-fingerprint";

describe("translation structure fingerprint", () => {
  it("treats translated prose as equivalent when Markdown syntax is unchanged", () => {
    const source = "Read [docs](https://example.com/docs) and `code`.\n";
    const translated = "読む [ドキュメント](https://example.com/docs) と `code`.\n";

    expect(() => assertMarkdownStructurePreserved({ source, translated })).not.toThrow();
  });

  it("rejects changed link destinations and inline code", () => {
    expect(() =>
      assertMarkdownStructurePreserved({
        source: "Read [docs](https://example.com/docs).\n",
        translated: "読む [docs](https://wrong.example/docs).\n",
      })
    ).toThrow(/link destination/);

    expect(() =>
      assertMarkdownStructurePreserved({
        source: "Use `inlineCode`.\n",
        translated: "Use `translatedCode`.\n",
      })
    ).toThrow(/inline code/);
  });

  it("creates stable fingerprints for table shape and inline math", () => {
    const fingerprint = createMarkdownStructureFingerprint([
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "",
      "$x+y$",
    ].join("\n"));

    expect(fingerprint.entries.some((entry) => entry.kind === "table")).toBe(true);
    expect(fingerprint.entries.some((entry) => entry.kind === "inline_math")).toBe(true);
  });

  it("preserves reference definitions and footnote identifiers", () => {
    expect(() =>
      assertMarkdownStructurePreserved({
        source: "[ref]: https://example.com/ref \"Title\"\n\nRead [docs][ref].\n\n[^n]: Note body.\n",
        translated: "[ref]: https://example.com/ref \"Title\"\n\n読む [資料][ref].\n\n[^n]: 注記本文.\n",
      })
    ).not.toThrow();
  });
});
