import { describe, expect, it } from "vitest";

import {
  assertMarkdownStructurePreserved,
  createMarkdownStructureFingerprint,
} from "../../../src/server/translation/structure-fingerprint";
import { TranslationOutputValidationError } from "../../../src/server/translation/errors";

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

  it("diagnoses inline code value mutations without exposing full documents", () => {
    const diagnostics = readValidationDiagnostics({
      source: "Use `AGENTS.md` before running `bun test`.\n",
      translated: "使う `agents.md` before running `bun test`.\n",
      chunkIndex: 3,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        chunkIndex: 3,
        kind: "markdown_structure",
        message: expect.stringContaining("inline code"),
        sourceEntry: {
          kind: "inline_code",
          valuePreview: "AGENTS.md",
        },
        translatedEntry: {
          kind: "inline_code",
          valuePreview: "agents.md",
        },
      }),
    ]);
  });

  it("diagnoses introduced block structure with short entry previews", () => {
    const diagnostics = readValidationDiagnostics({
      source: "Read the manual before configuring hooks.\n",
      translated: "マニュアルを読む。\n\n```sh\namp hooks\n```\n",
      chunkIndex: 1,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        chunkIndex: 1,
        kind: "markdown_structure",
        message: expect.stringContaining("Unexpected translated"),
        translatedEntry: expect.objectContaining({
          kind: expect.any(String),
          valuePreview: expect.any(String),
        }),
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("Read the manual");
    expect(JSON.stringify(diagnostics)).not.toContain("マニュアルを読む");
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

function readValidationDiagnostics(input: {
  chunkIndex: number;
  source: string;
  translated: string;
}) {
  try {
    assertMarkdownStructurePreserved(input);
  } catch (error) {
    expect(error).toBeInstanceOf(TranslationOutputValidationError);
    return (error as TranslationOutputValidationError).diagnostics;
  }
  throw new Error("expected structure validation to fail");
}
