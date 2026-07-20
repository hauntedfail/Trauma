import { readFile } from "node:fs/promises";

import type { ResolvedTraumaConfig } from "../config";
import type {
  MemoryRepository,
  TranslationRepository,
} from "../db/repositories";
import { renderMemoryMarkdown } from "../reader/markdown-renderer";
import {
  MemoryContentStoreError,
  parseMemoryContentFixture,
  readMemoryContent,
} from "../store";
import { createSha256ContentHash } from "../translation/hash";
import { isSupportedLanguageCode } from "../translation/languages";
import { resolveCurrentTranslationReadOnly } from "../translation/current-translation";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import type {
  PsychiatristContextSection,
  PsychiatristMemoryContext,
} from "./types";

export type PsychiatristContextErrorCode =
  | "missing_memory"
  | "context_unavailable";

export class PsychiatristContextError extends Error {
  constructor(
    public readonly code: PsychiatristContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PsychiatristContextError";
  }
}

export async function buildPsychiatristMemoryContext(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode?: string;
  memoryId: string;
  memoryRepository: Pick<MemoryRepository, "findReaderAggregateById">;
  translationRepository: Pick<TranslationRepository, "findCompleteTranslationRecord">;
}): Promise<PsychiatristMemoryContext> {
  const memory = await input.memoryRepository.findReaderAggregateById(input.memoryId);
  if (memory === undefined) {
    throw new PsychiatristContextError(
      "missing_memory",
      "Memory was not found for Psychiatrist context.",
    );
  }

  const loaded = input.langCode === undefined
    ? await loadSourceContextContent(input)
    : await loadTranslatedContextContent({ ...input, langCode: input.langCode });

  return {
    categories: memory.memoryCategories.map(({ category }) => category.name),
    contentHash: loaded.contentHash,
    ...(input.langCode === undefined ? {} : { langCode: input.langCode }),
    memoryId: input.memoryId,
    relativePath: loaded.relativePath,
    sections: splitContextSections(loaded.markdown),
    sourceHash: loaded.sourceHash,
    sourceUrl: memory.url,
    tags: memory.memoryTags.map(({ tag }) => tag.name),
    title: memory.title,
    ...(input.langCode === undefined ? {} : { translationOutputHash: loaded.contentHash }),
    variantKind: input.langCode === undefined ? "source" : "translation",
  };
}

async function loadSourceContextContent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
}): Promise<{
  contentHash: string;
  markdown: string;
  relativePath: string;
  sourceHash: string;
}> {
  try {
    const content = await readMemoryContent(input);
    return {
      contentHash: createSha256ContentHash(content.markdown),
      markdown: content.markdown,
      relativePath: content.relativePath,
      sourceHash: createSha256ContentHash(content.markdown),
    };
  } catch (error) {
    if (error instanceof MemoryContentStoreError && error.code === "missing_content") {
      throw new PsychiatristContextError(
        "context_unavailable",
        "Source memory content is unavailable.",
      );
    }
    throw error;
  }
}

async function loadTranslatedContextContent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: string;
  memoryId: string;
  translationRepository: Pick<TranslationRepository, "findCompleteTranslationRecord">;
}): Promise<{
  contentHash: string;
  markdown: string;
  relativePath: string;
  sourceHash: string;
}> {
  if (!isSupportedLanguageCode(input.langCode)) {
    throw new PsychiatristContextError(
      "context_unavailable",
      "Translated memory language is unsupported.",
    );
  }

  const current = await resolveCurrentTranslationReadOnly({
    config: input.config,
    langCode: input.langCode,
    memoryId: input.memoryId,
    repository: input.translationRepository as TranslationRepository,
  });
  if (current.status !== "current") {
    throw new PsychiatristContextError(
      "context_unavailable",
      "Translated memory content is unavailable or stale.",
    );
  }

  let translatedPath: ReturnType<typeof resolveTranslatedMemoryContentPath>;
  let markdown: string;
  try {
    translatedPath = resolveTranslatedMemoryContentPath(input);
    const content = await readFile(translatedPath.absolutePath, "utf8");
    ({ markdown } = parseMemoryContentFixture(
      content,
      translatedPath.relativePath,
      input.memoryId,
    ));
  } catch {
    throw new PsychiatristContextError(
      "context_unavailable",
      "Translated memory content is unavailable.",
    );
  }
  return {
    contentHash: current.outputHash,
    markdown,
    relativePath: translatedPath.relativePath,
    sourceHash: current.sourceHash,
  };
}

function splitContextSections(markdown: string): PsychiatristContextSection[] {
  const rendered = renderMemoryMarkdown(markdown);
  if (rendered.toc.length === 0) {
    return [{
      anchor: "document",
      endOffset: markdown.length,
      level: 1,
      markdown,
      path: "document",
      startOffset: 0,
      title: "Document",
    }];
  }

  const headingOffsets = findHeadingOffsets(
    markdown,
    rendered.toc.map((entry) => entry.level),
  );
  const starts = rendered.toc.map((entry, index) => ({
    entry,
    startOffset: headingOffsets[index] ?? 0,
  }));
  const sections: PsychiatristContextSection[] = [];
  const firstStart = starts[0]?.startOffset ?? 0;
  if (firstStart > 0 && markdown.slice(0, firstStart).trim() !== "") {
    sections.push({
      anchor: "document-introduction",
      endOffset: firstStart,
      level: 1,
      markdown: markdown.slice(0, firstStart).trim(),
      path: "document/introduction",
      startOffset: 0,
      title: "Document introduction",
    });
  }
  sections.push(...starts.map((current, index) => {
    const next = starts[index + 1];
    const endOffset = next?.startOffset ?? markdown.length;
    return {
      anchor: current.entry.id,
      endOffset,
      level: current.entry.level,
      markdown: markdown.slice(current.startOffset, endOffset).trim(),
      path: current.entry.path,
      startOffset: current.startOffset,
      title: current.entry.text,
    };
  }));
  return sections;
}

function findHeadingOffsets(
  markdown: string,
  levels: readonly number[],
): number[] {
  const offsets: number[] = [];
  let activeFence: { length: number; marker: string } | undefined;
  let lineStart = 0;
  while (lineStart < markdown.length && offsets.length < levels.length) {
    const newlineIndex = markdown.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex;
    const nextLineStart = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const nextLineEnd = nextLineStart >= markdown.length
      ? markdown.length
      : markdown.indexOf("\n", nextLineStart);
    const nextLine = nextLineStart >= markdown.length
      ? ""
      : markdown.slice(nextLineStart, nextLineEnd === -1 ? markdown.length : nextLineEnd);

    if (activeFence !== undefined) {
      if (isFenceEnd(line, activeFence)) {
        activeFence = undefined;
      }
    } else {
      const fence = readFenceStart(line);
      if (fence !== undefined) {
        activeFence = fence;
      } else if (readMarkdownHeadingLevel(line, nextLine) === levels[offsets.length]) {
        offsets.push(lineStart);
      }
    }

    lineStart = nextLineStart;
  }

  // The rendered TOC and scanner consume the same Markdown. Retain the prior
  // monotonic fallback if a future renderer recognizes a heading form that
  // this offset scanner does not yet understand.
  let fallbackOffset = 0;
  return levels.map((_, index) => {
    const offset = offsets[index] ?? fallbackOffset;
    fallbackOffset = offset + 1;
    return offset;
  });
}

function readMarkdownHeadingLevel(line: string, nextLine: string): number | undefined {
  const atx = /^(?: {0,3})(#{1,6})(?:\s+|$)/.exec(line);
  if (atx?.[1] !== undefined) {
    return atx[1].length;
  }
  if (line.trim() === "") {
    return undefined;
  }
  const setext = /^(?: {0,3})(=+|-+)\s*$/.exec(nextLine);
  if (setext?.[1] === undefined) {
    return undefined;
  }
  return setext[1].startsWith("=") ? 1 : 2;
}

function readFenceStart(line: string): { length: number; marker: string } | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return { length: match[1].length, marker: match[1][0] ?? "" };
}

function isFenceEnd(
  line: string,
  fence: { length: number; marker: string },
): boolean {
  const match = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(line);
  return match?.[1]?.startsWith(fence.marker) === true &&
    match[1].length >= fence.length;
}
