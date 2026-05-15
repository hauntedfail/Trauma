import { eq } from "drizzle-orm";

import { initializeDatabase, schema } from "../db";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import { MemoryContentStoreError, readMemoryContent } from "../store";
import {
  renderMemoryMarkdown,
  type RenderedMemoryMarkdown,
} from "./markdown-renderer";
import { renderMarkdownWithHighlightRecords } from "../highlights/toggle";

type MemoryRow = typeof schema.memories.$inferSelect;
type CategoryRow = typeof schema.categories.$inferSelect;
type FlashbackRow = typeof schema.flashbacks.$inferSelect;
type TagRow = typeof schema.tags.$inferSelect;
type HighlightRow = typeof schema.highlights.$inferSelect;
type ReaderMemoryRow = MemoryRow & {
  flashbacks: FlashbackRow[];
  highlights: HighlightRow[];
  memoryCategories: { category: CategoryRow }[];
  memoryTags: { tag: TagRow }[];
};

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
  extractionStatus: MemoryRow["extractionStatus"];
  contentPath: string;
  read: boolean;
  categories: ReaderTaxonomyItem[];
  flashbacks: ReaderFlashbackItem[];
  tags: ReaderTaxonomyItem[];
  highlights: ReaderHighlightItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ReaderTaxonomyItem {
  id: string;
  name: string;
}

export interface ReaderFlashbackItem {
  id: string;
  sectionAnchor: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string;
  sectionStartOffset: number | null;
  sectionEndOffset: number | null;
  contentHash: string | null;
  createdAt: string;
}

export interface ReaderHighlightItem {
  id: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
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
    const memory = await connection.db.query.memories.findFirst({
      where: eq(schema.memories.id, memoryId),
      with: {
        flashbacks: true,
        highlights: true,
        memoryCategories: {
          with: {
            category: true,
          },
        },
        memoryTags: {
          with: {
            tag: true,
          },
        },
      },
    });
    if (memory === undefined) {
      return {
        status: "not_found",
        message: "Memory was not found.",
      };
    }

    const content = await readMemoryContent({ config, memoryId });
    return {
      status: "ready",
      memory: toReaderMemory(memory),
      content: {
        relativePath: content.relativePath,
      },
      rendered: renderMemoryMarkdown(
        renderMarkdownWithHighlightRecords(content.markdown, memory.highlights),
      ),
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

function toReaderMemory(memory: ReaderMemoryRow): ReaderMemory {
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
    flashbacks: memory.flashbacks.map((flashback) => ({
      id: flashback.id,
      sectionAnchor: flashback.sectionAnchor,
      sectionTitle: flashback.sectionTitle,
      sectionLevel: flashback.sectionLevel,
      sectionPath: flashback.sectionPath,
      sectionStartOffset: flashback.sectionStartOffset,
      sectionEndOffset: flashback.sectionEndOffset,
      contentHash: flashback.contentHash,
      createdAt: flashback.createdAt.toISOString(),
    })),
    tags: memory.memoryTags.map(({ tag }) => ({
      id: tag.id,
      name: tag.name,
    })),
    highlights: memory.highlights.map((highlight) => ({
      id: highlight.id,
      text: highlight.text,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      createdAt: highlight.createdAt.toISOString(),
    })),
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}
