import { createSha256ContentHash, estimateRoughTokens } from "./hash";
import type {
  TranslationBlock,
  TranslationChunk,
  TranslationSourceSnapshot,
} from "./types";

export const DEFAULT_TRANSLATION_CHUNK_CONFIG = {
  maxBlocks: 80,
  maxRetries: 3,
  maxRoughTokens: 2500,
  minLengthRatio: 0.35,
  maxLengthRatio: 2.8,
  softRoughTokens: 1800,
} as const;

export interface CreateTranslationChunksInput {
  blocks: TranslationBlock[];
  jobId: string;
  langCode: string;
  memoryId: string;
  source: TranslationSourceSnapshot;
  styleProfile?: string | null;
  glossary?: Record<string, string>;
}

export function createTranslationChunks(
  input: CreateTranslationChunksInput,
): TranslationChunk[] {
  const groups = groupBlocks(input.blocks);
  return groups.map((blocks, index) => {
    const sourceMarkdown = blocks.map((block) => block.markdown).join("");
    return {
      blockIds: blocks.map((block) => block.id),
      chunkCount: groups.length,
      chunkIndex: index,
      docTitle: input.source.title,
      documentType: input.source.documentType,
      glossary: input.glossary ?? {},
      jobId: input.jobId,
      langCode: input.langCode,
      memoryId: input.memoryId,
      sectionPath: blocks[0]?.sectionPath ?? [],
      sourceBlocks: blocks,
      sourceChunkHash: createSha256ContentHash(sourceMarkdown),
      sourceHash: input.source.sourceHash,
      sourceMarkdown,
      sourceUrl: input.source.sourceUrl,
      styleProfile: input.styleProfile ?? null,
    };
  });
}

function groupBlocks(blocks: TranslationBlock[]): TranslationBlock[][] {
  const groups: TranslationBlock[][] = [];
  let current: TranslationBlock[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const blockTokens = estimateRoughTokens(block.markdown);
    const nextWouldExceed =
      current.length > 0 &&
      (current.length >= DEFAULT_TRANSLATION_CHUNK_CONFIG.maxBlocks ||
        currentTokens + blockTokens >
          DEFAULT_TRANSLATION_CHUNK_CONFIG.softRoughTokens);
    const sectionChanged =
      current.length > 0 &&
      block.type === "heading" &&
      currentTokens + blockTokens >
        DEFAULT_TRANSLATION_CHUNK_CONFIG.softRoughTokens / 2;

    if (nextWouldExceed || sectionChanged) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(block);
    currentTokens += blockTokens;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}
