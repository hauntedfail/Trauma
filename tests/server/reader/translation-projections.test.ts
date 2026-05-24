import { describe, expect, it } from "vitest";

import {
  projectFlashbacksToTranslatedReader,
  projectTranslatedSelectionToSourceReader,
} from "../../../src/server/reader/translation-projections";
import { createReaderContentHash } from "../../../src/server/store/flashback-markers";
import type { TranslationProjectionSpan } from "../../../src/server/translation/types";

const now = new Date("2026-05-23T00:00:00.000Z");

describe("reader translation projections", () => {
  it("projects exact source flashback ranges onto translated reader ranges", () => {
    const sourceText =
      "Top 5 repos defining it, the academic case for why, and who says it's wrong.";
    const translatedText =
      "それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。";

    const result = projectFlashbacksToTranslatedReader({
      flashbacks: [{
        contentHash: createReaderContentHash(sourceText),
        createdAt: now,
        endOffset: sourceText.length,
        id: "hl-1",
        prefix: "",
        startOffset: 0,
        suffix: "",
        text: sourceText,
      }],
      projectionSpans: [
        createProjectionSpan({
          sourceEnd: sourceText.length,
          translatedEnd: translatedText.length,
        }),
      ],
      translatedMarkdown: translatedText,
    });

    expect(result.markers).toEqual([
      {
        contentHash: createReaderContentHash(translatedText),
        endOffset: translatedText.length,
        id: "hl-1",
        startOffset: 0,
        text: translatedText,
      },
    ]);
    expect(result.items).toEqual([
      {
        contentHash: createReaderContentHash(translatedText),
        createdAt: now.toISOString(),
        endOffset: translatedText.length,
        id: "hl-1",
        prefix: "",
        startOffset: 0,
        suffix: "",
        text: translatedText,
      },
    ]);
  });

  it("fails closed when source flashback boundaries do not match projection spans", () => {
    const sourceText = "A longer source sentence.";
    const translatedText = "長い翻訳文。";

    const result = projectFlashbacksToTranslatedReader({
      flashbacks: [{
        contentHash: null,
        createdAt: now,
        endOffset: "longer source".length,
        id: "hl-partial",
        prefix: "A ",
        startOffset: 2,
        suffix: " sentence.",
        text: "longer source",
      }],
      projectionSpans: [
        createProjectionSpan({
          sourceEnd: sourceText.length,
          translatedEnd: translatedText.length,
        }),
      ],
      translatedMarkdown: translatedText,
    });

    expect(result.markers).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it("reverse-projects exact translated selections to source reader selections", () => {
    const sourceText = "Source sentence.";
    const translatedText = "翻訳文。";

    const result = projectTranslatedSelectionToSourceReader({
      projectionSpans: [
        createProjectionSpan({
          sourceEnd: sourceText.length,
          translatedEnd: translatedText.length,
        }),
      ],
      selection: {
        endOffset: translatedText.length,
        prefix: "",
        startOffset: 0,
        suffix: "",
        text: translatedText,
      },
      sourceMarkdown: sourceText,
      translatedMarkdown: translatedText,
    });

    expect(result).toEqual({
      endOffset: sourceText.length,
      prefix: "",
      startOffset: 0,
      suffix: "",
      text: sourceText,
    });
  });
});

function createProjectionSpan(input: {
  sourceEnd: number;
  translatedEnd: number;
}): TranslationProjectionSpan {
  return {
    blockId: "b000001",
    createdAt: now,
    jobId: "019e3906-0000-7000-8000-000000000777",
    langCode: "ja-JP",
    memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f777",
    outputHash: "sha256:output",
    segmentId: "s000001",
    sourceHash: "sha256:source",
    sourceMarkdownEnd: input.sourceEnd,
    sourceMarkdownStart: 0,
    sourceReaderEnd: input.sourceEnd,
    sourceReaderStart: 0,
    spanIndex: 0,
    translatedMarkdownEnd: input.translatedEnd,
    translatedMarkdownStart: 0,
    translatedReaderEnd: input.translatedEnd,
    translatedReaderStart: 0,
    updatedAt: now,
  };
}
