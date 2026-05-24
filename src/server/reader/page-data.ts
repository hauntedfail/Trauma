import { initializeDatabase } from "../db";
import type { ReaderMemoryAggregateRow } from "../db/repositories";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import {
  MemoryContentStoreError,
  readMemoryContent,
  readResolvedMemoryContent,
} from "../store";
import {
  createReaderContentHash,
  FlashbackMarkerError,
  type FlashbackMarkerRange,
} from "../store/flashback-markers";
import {
  renderMemoryMarkdown,
  type RenderedMemoryMarkdown,
} from "./markdown-renderer";
import { renderMarkdownWithFlashbackRecords } from "../flashbacks/toggle";
import {
  resolveCurrentTranslationReadOnly,
} from "../translation/current-translation";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "../translation/languages";
import { projectFlashbacksToTranslatedReader } from "./translation-projections";

type FlashbackRow = ReaderMemoryAggregateRow["flashbacks"][number];

interface LoadedReaderContent {
  langCode?: SupportedLanguageCode;
  markdown: string;
  outputHash?: string;
  relativePath: string;
  sourceHash?: string;
}

export type ReaderMemoryResult =
  | {
      status: "ready";
      memory: ReaderMemory;
      content: {
        langCode?: SupportedLanguageCode;
        relativePath: string;
        sourceReaderUrl?: string;
        variants: ReaderContentVariant[];
      };
      rendered: RenderedMemoryMarkdown;
    }
  | {
      status: "not_found" | "content_missing" | "unavailable";
      message: string;
    };

export interface ReaderMemory {
  id: string;
  url: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  extractionStatus: ReaderMemoryAggregateRow["extractionStatus"];
  contentPath: string;
  read: boolean;
  categories: ReaderTaxonomyItem[];
  moments: ReaderMomentItem[];
  tags: ReaderTaxonomyItem[];
  flashbacks: ReaderFlashbackItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ReaderTaxonomyItem {
  id: string;
  name: string;
}

export interface ReaderMomentItem {
  id: string;
  sectionAnchor: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string;
  sectionStartOffset: number | null;
  sectionEndOffset: number | null;
  contentHash?: string | null;
  createdAt: string;
}

export interface ReaderFlashbackItem {
  id: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  contentHash?: string | null;
  createdAt: string;
}

export interface ReaderContentVariant {
  active: boolean;
  kind: "source" | "translation";
  label: string;
  langCode?: SupportedLanguageCode;
  readerUrl: string;
  relativePath: string;
}

export interface LoadReaderMemoryOptions {
  config?: ResolvedTraumaConfig;
  langCode?: SupportedLanguageCode;
}

export async function loadReaderMemory(
  memoryId: string,
  options: LoadReaderMemoryOptions = {},
): Promise<ReaderMemoryResult> {
  let connection: ReturnType<typeof initializeDatabase> | undefined;

  try {
    const config = options.config ?? loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const memory =
      await connection.repositories.memories.findReaderAggregateById(memoryId);
    if (memory === undefined) {
      return {
        status: "not_found",
        message: "Memory was not found.",
      };
    }

    const content: LoadedReaderContent = options.langCode === undefined
      ? await readMemoryContent({ config, memoryId })
      : await readTranslatedReaderContent({
        config,
        connection,
        langCode: options.langCode,
        memoryId,
      });
    let flashbackMarkers: Parameters<typeof renderMemoryMarkdownSafely>[1] =
      memory.flashbacks;
    let projectedFlashbacks: ReaderFlashbackItem[] | undefined;
    if (
      content.langCode !== undefined &&
      content.outputHash !== undefined &&
      content.sourceHash !== undefined
    ) {
      const sourceContent = await readMemoryContent({ config, memoryId });
      const projectionSpans =
        await connection.repositories.translations.listCurrentProjectionSpans({
          langCode: content.langCode,
          memoryId,
          outputHash: content.outputHash,
          sourceHash: content.sourceHash,
        });
      const projected = projectFlashbacksToTranslatedReader({
        flashbacks: memory.flashbacks,
        projectionSpans,
        sourceContentHash: createReaderContentHash(sourceContent.markdown),
        translatedMarkdown: content.markdown,
      });
      flashbackMarkers = projected.markers;
      projectedFlashbacks = projected.items;
    }
    const rendered = renderMemoryMarkdownSafely(
      content.markdown,
      flashbackMarkers,
      memory.url,
    );
    const variants = await loadReaderContentVariants({
      activeLangCode: options.langCode,
      config,
      memoryId,
      repository: connection.repositories.translations,
      sourceContentPath: memory.contentPath,
    });
    return {
      status: "ready",
      memory: toReaderMemory(memory, rendered, projectedFlashbacks),
      content: {
        ...(options.langCode === undefined
          ? {}
          : {
            langCode: options.langCode,
            sourceReaderUrl: `/memories/${memoryId}`,
          }),
        relativePath: content.relativePath,
        variants,
      },
      rendered,
    };
  } catch (error) {
    if (
      error instanceof MemoryContentStoreError &&
      error.code === "missing_content"
    ) {
      return {
        status: "content_missing",
        message: "Readable content is missing for this memory.",
      };
    }

    if (
      error instanceof TraumaConfigError ||
      error instanceof MemoryContentStoreError
    ) {
      return {
        status: "unavailable",
        message: "Reader content is unavailable.",
      };
    }

    throw error;
  } finally {
    connection?.close();
  }
}

async function readTranslatedReaderContent(input: {
  config: ResolvedTraumaConfig;
  connection: ReturnType<typeof initializeDatabase>;
  langCode: SupportedLanguageCode;
  memoryId: string;
}): Promise<LoadedReaderContent> {
  const current = await resolveCurrentTranslationReadOnly({
    config: input.config,
    langCode: input.langCode,
    memoryId: input.memoryId,
    repository: input.connection.repositories.translations,
  });
  if (current.status === "missing") {
    throw new MemoryContentStoreError(
      `translated CONTENT.md is missing for ${input.langCode}`,
      "missing_content",
    );
  }
  if (current.status === "unavailable") {
    throw new MemoryContentStoreError(
      `translated CONTENT.md is unavailable for ${input.langCode}`,
      "missing_content",
    );
  }

  const content = await readResolvedMemoryContent(
    resolveTranslatedMemoryContentPath({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.memoryId,
    }),
  );
  return {
    ...content,
    langCode: input.langCode,
    outputHash: current.outputHash,
    sourceHash: current.sourceHash,
  };
}

async function loadReaderContentVariants(input: {
  activeLangCode?: SupportedLanguageCode;
  config: ResolvedTraumaConfig;
  memoryId: string;
  repository: ReturnType<typeof initializeDatabase>["repositories"]["translations"];
  sourceContentPath: string;
}): Promise<ReaderContentVariant[]> {
  const variants: ReaderContentVariant[] = [
    {
      active: input.activeLangCode === undefined,
      kind: "source",
      label: "Original",
      readerUrl: `/memories/${input.memoryId}`,
      relativePath: input.sourceContentPath,
    },
  ];

  for (const language of SUPPORTED_TRANSLATION_LANGUAGES) {
    const current = await resolveCurrentTranslationReadOnly({
      config: input.config,
      langCode: language.code,
      memoryId: input.memoryId,
      repository: input.repository,
    });
    if (current.status !== "current") {
      continue;
    }

    variants.push({
      active: input.activeLangCode === language.code,
      kind: "translation",
      label: language.displayName,
      langCode: language.code,
      readerUrl: current.readerUrl,
      relativePath: current.outputPath,
    });
  }

  return variants;
}

function renderMemoryMarkdownSafely(
  markdown: string,
  flashbacks: FlashbackMarkerRange[],
  sourceUrl: string,
): RenderedMemoryMarkdown {
  try {
    return renderMemoryMarkdown(
      renderMarkdownWithFlashbackRecords(markdown, flashbacks),
      { sourceUrl },
    );
  } catch (error) {
    if (error instanceof FlashbackMarkerError) {
      return renderMemoryMarkdown(markdown, { sourceUrl });
    }

    throw error;
  }
}

function toReaderMemory(
  memory: ReaderMemoryAggregateRow,
  rendered: RenderedMemoryMarkdown,
  projectedFlashbacks?: ReaderFlashbackItem[],
): ReaderMemory {
  const renderedFlashbackIds = collectRenderedFlashbackIds(rendered.html);
  const flashbacks = projectedFlashbacks ?? memory.flashbacks.map((flashback) => ({
    id: flashback.id,
    text: flashback.text,
    prefix: flashback.prefix,
    suffix: flashback.suffix,
    startOffset: flashback.startOffset,
    endOffset: flashback.endOffset,
    contentHash: flashback.contentHash,
    createdAt: flashback.createdAt.toISOString(),
  }));
  return {
    id: memory.id,
    url: memory.url,
    title: memory.title,
    description: memory.description,
    faviconUrl: memory.faviconUrl,
    extractionStatus: memory.extractionStatus,
    contentPath: memory.contentPath,
    read: memory.read,
    categories: memory.memoryCategories.map(({ category }) => ({
      id: category.id,
      name: category.name,
    })),
    moments: memory.moments.map((moment) => ({
      id: moment.id,
      sectionAnchor: moment.sectionAnchor,
      sectionTitle: moment.sectionTitle,
      sectionLevel: moment.sectionLevel,
      sectionPath: moment.sectionPath,
      sectionStartOffset: moment.sectionStartOffset,
      sectionEndOffset: moment.sectionEndOffset,
      contentHash: moment.contentHash,
      createdAt: moment.createdAt.toISOString(),
    })),
    tags: memory.memoryTags.map(({ tag }) => ({
      id: tag.id,
      name: tag.name,
    })),
    flashbacks: flashbacks
      .filter((flashback) => renderedFlashbackIds.has(flashback.id))
      .map((flashback) => ({ ...flashback })),
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function collectRenderedFlashbackIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(/\bdata-flashback-id="([^"]+)"/g)) {
    const id = match[1];
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return ids;
}
