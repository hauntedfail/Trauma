import { describe, expect, it } from "vitest";

import { createTranslationChunks } from "../../../src/server/translation/chunker";
import { parseMarkdownTranslationBlocks } from "../../../src/server/translation/markdown-blocks";
import type { TranslationSourceSnapshot } from "../../../src/server/translation/types";

describe("translation chunker", () => {
  it("groups contiguous block ids and hashes each chunk", () => {
    const manifest = parseMarkdownTranslationBlocks(
      "# One\n\nSmall body.\n\n# Two\n\nSecond body.",
    );
    const source = {
      byteSize: 48,
      documentType: "article",
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f903",
      roughTokenEstimate: 12,
      sourceHash: "sha256:source",
      sourceMarkdown: "# One\n\nSmall body.\n\n# Two\n\nSecond body.",
      sourcePath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f903/CONTENT.md",
      sourceUrl: "https://example.com",
      title: "One",
    } satisfies TranslationSourceSnapshot;

    const chunks = createTranslationChunks({
      blocks: manifest.blocks,
      jobId: "job-1",
      langCode: "ja-JP",
      memoryId: source.memoryId,
      source,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      blockIds: ["b000001", "b000002", "b000003", "b000004"],
      chunkCount: 1,
      chunkIndex: 0,
      sourceChunkHash: expect.stringMatching(/^sha256:/),
    });
  });
});
