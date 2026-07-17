import { describe, expect, it } from "vitest";

import {
  createTranslationChunks,
  DEFAULT_TRANSLATION_CHUNK_CONFIG,
} from "../../../src/server/translation/chunker";
import { estimateRoughTokens } from "../../../src/server/translation/hash";
import { parseMarkdownTranslationBlocks } from "../../../src/server/translation/markdown-blocks";
import {
  BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES,
  buildTranslationPrompt,
} from "../../../src/server/translation/prompt";
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
    expect(chunks[0]?.segments.map((segment) => segment.id)).toEqual([
      "s000001",
      "s000002",
      "s000003",
      "s000004",
    ]);
  });

  it.each([
    ["paragraph", `# Large paragraph\n\n${"Translatable sentence. ".repeat(700)}`],
    [
      "paragraph with inline code",
      `# Large protected paragraph\n\n${"Translate around `stable_id` safely. ".repeat(700)}`,
    ],
    [
      "list",
      `# Large list\n\n${Array.from(
        { length: 700 },
        (_, index) => `- Ordered item ${index} remains in place.\n`,
      ).join("")}`,
    ],
  ])("splits one oversized %s block into stable hard-bounded chunks", (_, markdown) => {
    const source = translationSource(markdown);
    const chunks = createTranslationChunks({
      blocks: parseMarkdownTranslationBlocks(markdown).blocks,
      jobId: "job-large",
      langCode: "ja-JP",
      memoryId: source.memoryId,
      source,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.sourceMarkdown).join(""))
      .toBe(parseMarkdownTranslationBlocks(markdown).bodyMarkdown);
    expect(
      chunks.every((chunk) =>
        estimateRoughTokens(chunk.sourceMarkdown) <=
          DEFAULT_TRANSLATION_CHUNK_CONFIG.maxRoughTokens
      ),
    ).toBe(true);
    expect(
      chunks.every((chunk) =>
        Buffer.byteLength(
          buildTranslationPrompt({ chunk, targetLanguage: "ja-JP" }),
          "utf8",
        ) <= BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES
      ),
    ).toBe(true);
  });

  it.each([
    ["multibyte sentence stream", `# 多言語\n\n${"界。".repeat(4_000)}`],
    ["CRLF paragraph", `# CRLF\r\n\r\n${"Ordered sentence.\r\n".repeat(700)}`],
  ])("preserves %s bytes, offsets, and deterministic fragment ids", (_, markdown) => {
    const source = translationSource(markdown);
    const create = () =>
      createTranslationChunks({
        blocks: parseMarkdownTranslationBlocks(markdown).blocks,
        jobId: "job-stable",
        langCode: "ja-JP",
        memoryId: source.memoryId,
        source,
      });
    const chunks = create();
    const body = parseMarkdownTranslationBlocks(markdown).bodyMarkdown;
    const fragments = chunks.flatMap((chunk) => chunk.sourceBlocks);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.sourceMarkdown).join("")).toBe(body);
    expect(fragments.map((fragment) => fragment.id))
      .toEqual(create().flatMap((chunk) => chunk.blockIds));
    for (const fragment of fragments) {
      expect(body.slice(fragment.sourceStart, fragment.sourceEnd))
        .toBe(fragment.markdown);
    }
    expect(chunks.every((chunk) =>
      Buffer.byteLength(
        buildTranslationPrompt({ chunk, targetLanguage: "ja-JP" }),
        "utf8",
      ) <= BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES
    )).toBe(true);
  });

  it("rejects an oversized structurally indivisible fenced block before chunk creation", () => {
    const markdown = `# Source\n\n\`\`\`text\n${"protected-code-line\n".repeat(700)}\`\`\`\n`;
    const source = translationSource(markdown);

    expect(() =>
      createTranslationChunks({
        blocks: parseMarkdownTranslationBlocks(markdown).blocks,
        jobId: "job-fence",
        langCode: "ja-JP",
        memoryId: source.memoryId,
        source,
      })
    ).toThrow(/cannot be safely split/i);
  });

  it("bounds a large dense-boundary paragraph and list without losing order", () => {
    const paragraph = "dense boundary ".repeat(8_000);
    const list = Array.from(
      { length: 800 },
      (_, index) =>
        `- dense list item ${String(index).padStart(5, "0")} ${"x".repeat(64)}\n`,
    ).join("");
    const markdown = `# Dense source\n\n${paragraph}\n\n${list}`;
    const source = translationSource(markdown);

    const chunks = createTranslationChunks({
      blocks: parseMarkdownTranslationBlocks(markdown).blocks,
      jobId: "job-dense",
      langCode: "ja-JP",
      memoryId: source.memoryId,
      source,
    });

    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.map((chunk) => chunk.sourceMarkdown).join(""))
      .toBe(parseMarkdownTranslationBlocks(markdown).bodyMarkdown);
    expect(chunks.every((chunk) =>
      estimateRoughTokens(chunk.sourceMarkdown) <=
        DEFAULT_TRANSLATION_CHUNK_CONFIG.maxRoughTokens
    )).toBe(true);
  });

  it("bounds every prompt-oversized group in one ordered multibyte pass", () => {
    const groupCount = 48;
    const paragraph = `${"界".repeat(249)}。`.repeat(39);
    const markdown = Array.from(
      { length: groupCount },
      (_, index) => `${String(index).padStart(2, "0")}: ${paragraph}`,
    ).join("\n\n");
    const source = translationSource(markdown);
    const styleProfile = "dense-style ".repeat(400);

    const chunks = createTranslationChunks({
      blocks: parseMarkdownTranslationBlocks(markdown).blocks,
      jobId: "job-multi-group",
      langCode: "ja-JP",
      memoryId: source.memoryId,
      source,
      styleProfile,
    });

    expect(chunks).toHaveLength(groupCount * 2);
    expect(chunks.map((chunk) => chunk.sourceMarkdown).join("")).toBe(markdown);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      Array.from({ length: chunks.length }, (_, index) => index),
    );
    expect(chunks.every((chunk) => chunk.chunkCount === chunks.length)).toBe(true);
    expect(chunks.every((chunk) =>
      Buffer.byteLength(
        buildTranslationPrompt({ chunk, targetLanguage: "ja-JP" }),
        "utf8",
      ) <= BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES
    )).toBe(true);
  });
});

function translationSource(markdown: string): TranslationSourceSnapshot {
  return {
    byteSize: Buffer.byteLength(markdown, "utf8"),
    documentType: "article",
    memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f903",
    roughTokenEstimate: estimateRoughTokens(markdown),
    sourceHash: "sha256:source",
    sourceMarkdown: markdown,
    sourcePath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f903/CONTENT.md",
    sourceUrl: "https://example.com",
    title: "Large source",
  };
}
