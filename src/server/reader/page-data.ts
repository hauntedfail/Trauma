import { initializeDatabase } from "../db";
import type { ReaderMemoryAggregateRow } from "../db/repositories";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import { MemoryContentStoreError, readMemoryContent } from "../store";
import { FlashbackMarkerError } from "../store/flashback-markers";
import {
  renderMemoryMarkdown,
  type RenderedMemoryMarkdown,
} from "./markdown-renderer";
import { renderMarkdownWithFlashbackRecords } from "../flashbacks/toggle";

type FlashbackRow = ReaderMemoryAggregateRow["flashbacks"][number];

export type ReaderMemoryResult =
  | {
      status: "ready";
      memory: ReaderMemory;
      content: {
        relativePath: string;
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

export interface LoadReaderMemoryOptions {
  config?: ResolvedTraumaConfig;
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

    const content = await readMemoryContent({ config, memoryId });
    const rendered = renderMemoryMarkdownSafely(
      content.markdown,
      memory.flashbacks,
      memory.url,
    );
    return {
      status: "ready",
      memory: toReaderMemory(memory, rendered),
      content: {
        relativePath: content.relativePath,
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

function renderMemoryMarkdownSafely(
  markdown: string,
  flashbacks: FlashbackRow[],
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
): ReaderMemory {
  const renderedFlashbackIds = collectRenderedFlashbackIds(rendered.html);
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
    flashbacks: memory.flashbacks
      .filter((flashback) => renderedFlashbackIds.has(flashback.id))
      .map((flashback) => ({
        id: flashback.id,
        text: flashback.text,
        prefix: flashback.prefix,
        suffix: flashback.suffix,
        startOffset: flashback.startOffset,
        endOffset: flashback.endOffset,
        contentHash: flashback.contentHash,
        createdAt: flashback.createdAt.toISOString(),
      })),
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
