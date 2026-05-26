import { describe, expect, it } from "vitest";

import {
  applyTranslatedSegmentsWithProjection,
  applyTranslatedSegments,
  createTranslationSegmentManifest,
} from "../../../src/server/translation/translation-segments";
import {
  projectMarkdownToReaderText,
  readCanonicalReaderText,
} from "../../../src/server/store/flashback-markers";

describe("translation segment manifest", () => {
  it("extracts only translatable text while preserving syntax ranges", () => {
    const manifest = createTranslationSegmentManifest([
      "# Source Title",
      "",
      "Read [the docs](https://example.com/docs \"Docs\") and `inlineCode`.",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
    ].join("\n"));

    expect(manifest.segments.map((segment) => segment.text)).toEqual([
      "Source Title",
      "Read ",
      "the docs",
      " and ",
    ]);
    expect(manifest.segments.some((segment) => segment.text.includes("inlineCode"))).toBe(false);
    expect(manifest.protectedRanges.some((range) => range.kind === "math")).toBe(true);
  });

  it("reassembles translated text into the original Markdown syntax", () => {
    const source = "Read [the docs](https://example.com/docs \"Docs\") and `inlineCode`.\n";
    const manifest = createTranslationSegmentManifest(source);
    const output = applyTranslatedSegments({
      manifest,
      translations: [
        { segmentId: "s000001", translatedText: "読んでください " },
        { segmentId: "s000002", translatedText: "ドキュメント" },
        { segmentId: "s000003", translatedText: " と " },
      ],
    });

    expect(output).toBe("読んでください [ドキュメント](https://example.com/docs \"Docs\") と `inlineCode`.\n");
  });

  it("records document and reader offsets for projected translated segments", () => {
    const fullSource = "Intro.\n\nHello world.\n";
    const chunkMarkdown = "Hello world.\n";
    const sourceDocumentOffset = fullSource.indexOf(chunkMarkdown);
    const manifest = createTranslationSegmentManifest(chunkMarkdown, {
      sourceDocumentOffset,
      sourceReaderProjection: projectMarkdownToReaderText(fullSource),
    });

    expect(manifest.segments).toHaveLength(1);
    expect(manifest.segments[0]).toMatchObject({
      sourceDocumentEnd: sourceDocumentOffset + "Hello world.".length,
      sourceDocumentStart: sourceDocumentOffset,
      sourceEnd: "Hello world.".length,
      sourceReaderStart: readCanonicalReaderText(fullSource).indexOf("Hello world."),
      sourceStart: 0,
    });

    const output = applyTranslatedSegmentsWithProjection({
      manifest,
      translations: [
        { segmentId: "s000001", translatedText: "こんにちは世界。" },
      ],
    });

    expect(output.translatedMarkdown).toBe("こんにちは世界。\n");
    expect(output.projectionSpans).toEqual([
      expect.objectContaining({
        blockId: "b000001",
        segmentId: "s000001",
        sourceMarkdownEnd: sourceDocumentOffset + "Hello world.".length,
        sourceMarkdownStart: sourceDocumentOffset,
        translatedMarkdownEnd: "こんにちは世界。".length,
        translatedMarkdownStart: 0,
        translatedReaderEnd: "こんにちは世界。".length,
        translatedReaderStart: 0,
      }),
    ]);
  });

  it("excludes bare and angle autolink URL text from translation segments", () => {
    const manifest = createTranslationSegmentManifest(
      "Visit https://example.com and <https://example.org>.\n",
    );

    expect(manifest.segments.map((segment) => segment.text)).toEqual([
      "Visit ",
      " and ",
    ]);
  });

  it("translates prose around inline HTML without translating tags", () => {
    const manifest = createTranslationSegmentManifest(
      "Open <span class=\"x\">the door</span> now.\n",
    );

    expect(manifest.segments.map((segment) => segment.text)).toEqual([
      "Open ",
      "the door",
      " now.",
    ]);
    expect(manifest.protectedRanges.some((range) => range.kind === "html")).toBe(true);
  });
});
