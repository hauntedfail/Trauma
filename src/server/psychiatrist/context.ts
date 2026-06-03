import { readFile } from "node:fs/promises";

import type { ResolvedTraumaConfig } from "../config";
import type {
  MemoryRepository,
  ReaderMemoryAggregateRow,
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

  const translatedPath = resolveTranslatedMemoryContentPath(input);
  const content = await readFile(translatedPath.absolutePath, "utf8");
  const { markdown } = parseMemoryContentFixture(
    content,
    translatedPath.relativePath,
    input.memoryId,
  );
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

  let searchOffset = 0;
  const starts = rendered.toc.map((entry) => {
    const startOffset = findHeadingOffset(markdown, entry.text, searchOffset);
    searchOffset = startOffset + 1;
    return { entry, startOffset };
  });
  return starts.map((current, index) => {
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
  });
}

function findHeadingOffset(markdown: string, title: string, minOffset: number): number {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^#{1,6}\\s+${escapedTitle}\\s*$`, "gm");
  for (let match = pattern.exec(markdown); match !== null; match = pattern.exec(markdown)) {
    if (match.index >= minOffset) {
      return match.index;
    }
  }
  return minOffset;
}
