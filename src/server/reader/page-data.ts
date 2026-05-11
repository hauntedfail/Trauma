import type { schema } from "../db";
import { initializeDatabase } from "../db";
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

type MemoryRow = typeof schema.memories.$inferSelect;

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
  createdAt: Date;
  updatedAt: Date;
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
    const memory = await connection.repositories.memories.findById(memoryId);
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
      rendered: renderMemoryMarkdown(content.markdown),
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

function toReaderMemory(memory: MemoryRow): ReaderMemory {
  return {
    id: memory.id,
    url: memory.url,
    title: memory.title,
    description: memory.description,
    faviconUrl: memory.faviconUrl,
    extractionStatus: memory.extractionStatus,
    contentPath: memory.contentPath,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}
