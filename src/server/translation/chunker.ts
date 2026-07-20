import { createSha256ContentHash, estimateRoughTokens } from "./hash";
import { TranslationOutputValidationError } from "./errors";
import { parseMarkdownTranslationBlocks } from "./markdown-blocks";
import { parseTranslationMarkdownAst } from "./markdown-parser";
import {
  assertTranslationManifestAdmission,
  assertTranslationSourceAdmission,
  BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES,
  DEFAULT_TRANSLATION_CHUNK_CONFIG,
  DEFAULT_TRANSLATION_WORKLOAD_LIMITS,
  type TranslationWorkloadLimits,
} from "./limits";
import { measureTranslationPromptBytes } from "./prompt";
import { projectTranslationMarkdownToReaderText } from "./source-projection";
import { createTranslationSegmentManifest } from "./translation-segments";
import type { SupportedLanguageCode } from "./languages";
import type { Node, Parent } from "unist";
import type {
  TranslationBlock,
  TranslationChunk,
  TranslationSourceSnapshot,
} from "./types";

export { DEFAULT_TRANSLATION_CHUNK_CONFIG } from "./limits";

export interface CreateTranslationChunksInput {
  blocks: TranslationBlock[];
  jobId: string;
  langCode: string;
  memoryId: string;
  source: TranslationSourceSnapshot;
  styleProfile?: string | null;
  glossary?: Record<string, string>;
  workloadLimits?: TranslationWorkloadLimits;
}

type TranslationChunkManifestPayload = Omit<
  TranslationChunk,
  "chunkCount" | "chunkIndex"
>;

export function createTranslationChunks(
  input: CreateTranslationChunksInput,
): TranslationChunk[] {
  const workloadLimits =
    input.workloadLimits ?? DEFAULT_TRANSLATION_WORKLOAD_LIMITS;
  assertTranslationSourceAdmission(
    Buffer.byteLength(input.source.sourceMarkdown, "utf8"),
    workloadLimits,
  );
  const boundedBlocks = input.blocks.flatMap(splitOversizedBlock);
  const initialGroups = groupBlocks(boundedBlocks);
  const sourceReaderProjection = projectTranslationMarkdownToReaderText(
    boundedBlocks.map((block) => block.markdown).join(""),
  );
  return boundGroupsByPromptBytes(
    input,
    initialGroups,
    sourceReaderProjection,
    new Map(),
    workloadLimits,
  );
}

function createChunksFromGroups(
  input: CreateTranslationChunksInput,
  groups: TranslationBlock[][],
  sourceReaderProjection: ReturnType<typeof projectTranslationMarkdownToReaderText>,
  manifestPayloads: Map<string, TranslationChunkManifestPayload>,
  workloadLimits: TranslationWorkloadLimits,
): TranslationChunk[] {
  assertTranslationManifestAdmission(
    { chunkCount: groups.length, segmentCount: 0 },
    workloadLimits,
  );
  const chunks: TranslationChunk[] = [];
  let segmentCount = 0;
  for (const [index, blocks] of groups.entries()) {
    const cacheKey = createManifestPayloadCacheKey(blocks);
    let payload = manifestPayloads.get(cacheKey);
    if (payload === undefined) {
      payload = createTranslationChunkManifestPayload(
        input,
        blocks,
        sourceReaderProjection,
      );
      manifestPayloads.set(cacheKey, payload);
    }
    segmentCount += payload.segments.length;
    assertTranslationManifestAdmission(
      { chunkCount: groups.length, segmentCount },
      workloadLimits,
    );
    chunks.push({
      ...payload,
      chunkCount: groups.length,
      chunkIndex: index,
    });
  }
  return chunks;
}

function createTranslationChunkManifestPayload(
  input: CreateTranslationChunksInput,
  blocks: TranslationBlock[],
  sourceReaderProjection: ReturnType<typeof projectTranslationMarkdownToReaderText>,
): TranslationChunkManifestPayload {
  const sourceMarkdown = blocks.map((block) => block.markdown).join("");
  const segmentManifest = createTranslationSegmentManifest(sourceMarkdown, {
    sourceDocumentOffset: blocks[0]?.sourceStart ?? 0,
    sourceReaderProjection,
  });
  return {
    blockIds: blocks.map((block) => block.id),
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
    segments: segmentManifest.segments,
    styleProfile: input.styleProfile ?? null,
  };
}

function createManifestPayloadCacheKey(blocks: readonly TranslationBlock[]): string {
  return blocks.map((block) =>
    `${block.id}:${block.sourceStart}:${block.sourceEnd}`
  ).join("|");
}

function boundGroupsByPromptBytes(
  input: CreateTranslationChunksInput,
  initialGroups: TranslationBlock[][],
  sourceReaderProjection: ReturnType<typeof projectTranslationMarkdownToReaderText>,
  manifestPayloads: Map<string, TranslationChunkManifestPayload>,
  workloadLimits: TranslationWorkloadLimits,
): TranslationChunk[] {
  let groups = initialGroups.map((group) => [...group]);
  while (true) {
    const chunks = createChunksFromGroups(
      input,
      groups,
      sourceReaderProjection,
      manifestPayloads,
      workloadLimits,
    );
    const nextGroups: TranslationBlock[][] = [];
    let splitCount = 0;

    for (const [index, chunk] of chunks.entries()) {
      const group = groups[index]!;
      const promptBytes = measureTranslationPromptBytes({
        chunk,
        targetLanguage: input.langCode as SupportedLanguageCode,
      });
      if (promptBytes <= BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES) {
        nextGroups.push(group);
        continue;
      }
      nextGroups.push(...splitPromptOversizedGroup(group));
      splitCount += 1;
    }

    if (splitCount === 0) {
      return chunks;
    }
    if (nextGroups.length <= groups.length) {
      throw promptPartitionDidNotProgressError();
    }
    groups = nextGroups;
  }
}

function splitPromptOversizedGroup(
  group: TranslationBlock[],
): [TranslationBlock[], TranslationBlock[]] {
  if (group.length === 0) {
    throw promptPartitionDidNotProgressError();
  }
  if (group.length > 1) {
    const splitIndex = Math.ceil(group.length / 2);
    const left = group.slice(0, splitIndex);
    const right = group.slice(splitIndex);
    if (left.length === 0 || right.length === 0) {
      throw promptPartitionDidNotProgressError();
    }
    return [left, right];
  }

  const block = group[0]!;
  const fragments = splitBlockNearMiddle(block);
  if (
    fragments === undefined ||
    fragments.some((fragment) =>
      fragment.markdown.length === 0 ||
      fragment.markdown.length >= block.markdown.length
    ) ||
    fragments.map((fragment) => fragment.markdown).join("") !== block.markdown
  ) {
    throw oversizedIndivisibleBlockError(block);
  }
  return [[fragments[0]], [fragments[1]]];
}

function promptPartitionDidNotProgressError(): TranslationOutputValidationError {
  return new TranslationOutputValidationError(
    "Translation prompt partitioning did not make progress.",
    { retryable: false },
  );
}

function splitOversizedBlock(block: TranslationBlock): TranslationBlock[] {
  if (
    estimateRoughTokens(block.markdown) <=
      DEFAULT_TRANSLATION_CHUNK_CONFIG.maxRoughTokens
  ) {
    return [block];
  }

  const splitOffsets = iterateSafeSplitOffsets(block);
  const ranges = partitionAtSafeOffsets(block.markdown, splitOffsets);
  if (ranges === undefined) {
    throw oversizedIndivisibleBlockError(block);
  }

  return createBlockFragments(block, ranges);
}

function splitBlockNearMiddle(
  block: TranslationBlock,
): [TranslationBlock, TranslationBlock] | undefined {
  const middle = block.markdown.length / 2;
  let offset: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of iterateSafeSplitOffsets(block)) {
    if (candidate <= 0 || candidate >= block.markdown.length) {
      continue;
    }
    const candidateDistance = Math.abs(candidate - middle);
    if (
      candidateDistance < distance ||
      (candidateDistance === distance && (offset === undefined || candidate < offset))
    ) {
      distance = candidateDistance;
      offset = candidate;
    }
  }
  if (offset === undefined) {
    return undefined;
  }
  const fragments = createBlockFragments(block, [
    { end: offset, start: 0 },
    { end: block.markdown.length, start: offset },
  ]);
  return [fragments[0]!, fragments[1]!];
}

function iterateSafeSplitOffsets(block: TranslationBlock): Iterable<number> {
  return block.type === "paragraph" || block.type === "inline_code_paragraph"
    ? iterateParagraphSplitOffsets(block.markdown)
    : block.type === "list"
    ? iterateListSplitOffsets(block.markdown)
    : [];
}

function oversizedIndivisibleBlockError(
  block: TranslationBlock,
): TranslationOutputValidationError {
  return new TranslationOutputValidationError(
    `Source CONTENT.md contains an oversized ${block.type} block that cannot be safely split for translation.`,
    { retryable: false },
  );
}

function createBlockFragments(
  block: TranslationBlock,
  ranges: ReadonlyArray<{ end: number; start: number }>,
): TranslationBlock[] {
  return ranges.map((range, index) => {
    const markdown = block.markdown.slice(range.start, range.end);
    const id = `${block.id}~${String(index + 1).padStart(4, "0")}`;
    return {
      ...block,
      id,
      markdown,
      protectedSpans: parseMarkdownTranslationBlocks(markdown).blocks
        .flatMap((fragment) => fragment.protectedSpans)
        .map((span) => ({ ...span, blockId: id })),
      sourceEnd: block.sourceStart + range.end,
      sourceStart: block.sourceStart + range.start,
    };
  });
}

function partitionAtSafeOffsets(
  markdown: string,
  splitOffsets: Iterable<number>,
): Array<{ end: number; start: number }> | undefined {
  const maxCodeUnits = DEFAULT_TRANSLATION_CHUNK_CONFIG.maxRoughTokens * 4;
  const ranges: Array<{ end: number; start: number }> = [];
  let start = 0;
  let lastOffset = 0;
  let lastSafeOffset: number | undefined;

  for (const offset of splitOffsets) {
    if (
      offset <= lastOffset ||
      offset <= start ||
      offset >= markdown.length
    ) {
      continue;
    }
    lastOffset = offset;
    if (offset - start > maxCodeUnits) {
      if (lastSafeOffset === undefined) {
        return undefined;
      }
      ranges.push({ end: lastSafeOffset, start });
      start = lastSafeOffset;
      lastSafeOffset = undefined;
      if (offset - start > maxCodeUnits) {
        return undefined;
      }
    }
    lastSafeOffset = offset;
  }

  if (markdown.length - start > maxCodeUnits) {
    if (lastSafeOffset === undefined) {
      return undefined;
    }
    ranges.push({ end: lastSafeOffset, start });
    start = lastSafeOffset;
    if (markdown.length - start > maxCodeUnits) {
      return undefined;
    }
  }

  ranges.push({ end: markdown.length, start });
  return ranges;
}

function* iterateParagraphSplitOffsets(markdown: string): Generator<number> {
  const parsed = parseTranslationMarkdownAst(markdown);
  for (const node of iterateUnprotectedTextNodes(parsed.tree, false)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    const sourceStart = parsed.bodyOffset + start;
    const sourceEnd = parsed.bodyOffset + end;
    let cursor = sourceStart;
    while (cursor < sourceEnd) {
      const boundaryStart = cursor;
      const char = markdown.charAt(cursor);
      if (isMarkdownWhitespace(char)) {
        cursor = consumeMarkdownWhitespace(markdown, cursor, sourceEnd);
      } else if (/[。！？]/u.test(char)) {
        cursor = consumeMarkdownWhitespace(markdown, cursor + 1, sourceEnd);
      } else if (
        /[.!?]/u.test(char) &&
        (cursor + 1 === sourceEnd || isMarkdownWhitespace(markdown.charAt(cursor + 1)))
      ) {
        cursor = consumeMarkdownWhitespace(markdown, cursor + 1, sourceEnd);
      } else {
        cursor += 1;
        continue;
      }
      if (markdown.charAt(boundaryStart - 1) !== "\\") {
        yield cursor;
      }
    }
  }
}

function* iterateUnprotectedTextNodes(
  node: Node,
  insideInlineContainer: boolean,
): Generator<Node> {
  const nextInsideInlineContainer = insideInlineContainer ||
    INLINE_MARKDOWN_CONTAINER_TYPES.has(node.type);
  if (node.type === "text" && !insideInlineContainer) {
    yield node;
  }
  if (!isParentNode(node)) {
    return;
  }
  for (const child of node.children) {
    yield* iterateUnprotectedTextNodes(child, nextInsideInlineContainer);
  }
}

function isParentNode(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}

function consumeMarkdownWhitespace(
  markdown: string,
  start: number,
  end: number,
): number {
  let cursor = start;
  while (cursor < end && isMarkdownWhitespace(markdown.charAt(cursor))) {
    cursor += 1;
  }
  return cursor;
}

function isMarkdownWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

const INLINE_MARKDOWN_CONTAINER_TYPES = new Set([
  "delete",
  "emphasis",
  "image",
  "imageReference",
  "inlineCode",
  "inlineMath",
  "link",
  "linkReference",
  "strong",
]);

function* iterateListSplitOffsets(markdown: string): Generator<number> {
  let lineStart = 0;
  while (lineStart < markdown.length) {
    if (isListMarkerAt(markdown, lineStart)) {
      yield lineStart;
    }
    const lineEnd = markdown.indexOf("\n", lineStart);
    if (lineEnd === -1) {
      return;
    }
    lineStart = lineEnd + 1;
  }
}

function isListMarkerAt(markdown: string, lineStart: number): boolean {
  let cursor = lineStart;
  let indentation = 0;
  while (
    indentation < 3 &&
    (markdown.charAt(cursor) === " " || markdown.charAt(cursor) === "\t")
  ) {
    indentation += 1;
    cursor += 1;
  }
  const marker = markdown.charAt(cursor);
  if (marker === "-" || marker === "+" || marker === "*") {
    return isListMarkerWhitespace(markdown.charAt(cursor + 1));
  }
  if (!/\d/u.test(marker)) {
    return false;
  }
  while (/\d/u.test(markdown.charAt(cursor))) {
    cursor += 1;
  }
  return (markdown.charAt(cursor) === "." || markdown.charAt(cursor) === ")") &&
    isListMarkerWhitespace(markdown.charAt(cursor + 1));
}

function isListMarkerWhitespace(char: string): boolean {
  return char === " " || char === "\t";
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
