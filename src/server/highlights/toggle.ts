import { randomUUID } from "node:crypto";

import type { MemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import { createRepositories } from "../db/repositories";
import {
  applyHighlightMarkers,
  HighlightMarkerError,
  resolveHighlightSelection,
  stripHighlightMarkers,
  type HighlightSelectionInput,
} from "../store/highlight-markers";
import {
  readMemoryContent,
  writeMemoryContent,
} from "../store/memory-content";
import {
  addHighlightCoverage,
  isRangeFullyHighlighted,
  removeHighlightCoverage,
  type HighlightRange,
} from "./ranges";

const CONTEXT_LIMIT = 80;

export interface ToggleMemoryHighlightInput {
  memoryId: string;
  selection: HighlightSelectionInput;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  backupQueue: MemoryBackupQueue;
  generateId?: () => string;
  now?: () => Date;
}

export interface ToggleMemoryHighlightResult {
  operation: "highlighted" | "unhighlighted";
  highlights: Array<{
    id: string;
    text: string;
    prefix: string;
    suffix: string;
    startOffset: number;
    endOffset: number;
  }>;
}

type HighlightRow = Awaited<
  ReturnType<ReturnType<typeof createRepositories>["highlights"]["listForMemory"]>
>[number];

export class HighlightToggleError extends Error {
  constructor(
    message: string,
    public readonly code: "missing_memory" | "invalid_selection",
  ) {
    super(message);
    this.name = "HighlightToggleError";
  }
}

export async function toggleMemoryHighlight(
  input: ToggleMemoryHighlightInput,
): Promise<ToggleMemoryHighlightResult> {
  const repositories = createRepositories(input.db);
  const memory = await repositories.memories.findById(input.memoryId);
  if (memory === undefined) {
    throw new HighlightToggleError("Memory was not found.", "missing_memory");
  }

  const content = await readMemoryContent({
    config: { storePath: input.config.storePath },
    memoryId: input.memoryId,
  });
  const selection = resolveSelection(content.markdown, input.selection);
  const existingHighlights = await repositories.highlights.listForMemory(
    input.memoryId,
  );
  const existingRanges = existingHighlights.map(toHighlightRange);
  const generatedId = input.generateId ?? randomUUID;
  const operation = isRangeFullyHighlighted(existingRanges, selection)
    ? "unhighlighted"
    : "highlighted";
  const nextRanges = operation === "unhighlighted"
    ? removeHighlightCoverage(existingRanges, selection, generatedId)
    : addHighlightCoverage(existingRanges, selection, generatedId);
  const cleanMarkdown = stripHighlightMarkers(content.markdown);
  const now = (input.now ?? (() => new Date()))();
  const nextHighlights = buildHighlightRows({
    cleanMarkdown,
    existingHighlights,
    memoryId: input.memoryId,
    now,
    ranges: nextRanges,
  });
  const markedMarkdown = applyHighlightMarkers(content.markdown, nextHighlights);

  await writeMemoryContent({
    config: { storePath: input.config.storePath },
    memoryId: input.memoryId,
    frontmatter: content.frontmatter,
    markdown: markedMarkdown,
  });

  try {
    await repositories.highlights.replaceForMemory(input.memoryId, nextHighlights);
  } catch (error) {
    await restorePreviousContent({
      config: input.config,
      content,
      memoryId: input.memoryId,
    });
    throw error;
  }

  await enqueueBackup({
    backupQueue: input.backupQueue,
    contentPath: content.relativePath,
    memoryId: input.memoryId,
    now,
    repositories,
    shouldEnqueue: input.config.backup.git.enabled,
  });

  return {
    operation,
    highlights: nextHighlights.map((highlight) => ({
      id: highlight.id,
      text: highlight.text,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
    })),
  };
}

function resolveSelection(markdown: string, selection: HighlightSelectionInput) {
  try {
    return resolveHighlightSelection(markdown, selection);
  } catch (error) {
    if (error instanceof HighlightMarkerError) {
      throw new HighlightToggleError(error.message, "invalid_selection");
    }

    throw error;
  }
}

function toHighlightRange(highlight: HighlightRow): HighlightRange {
  return {
    id: highlight.id,
    startOffset: highlight.startOffset,
    endOffset: highlight.endOffset,
  };
}

function buildHighlightRows(input: {
  cleanMarkdown: string;
  existingHighlights: HighlightRow[];
  memoryId: string;
  now: Date;
  ranges: HighlightRange[];
}): HighlightRow[] {
  const existingById = new Map(
    input.existingHighlights.map((highlight) => [highlight.id, highlight]),
  );

  return input.ranges.map((range) => {
    const existing = existingById.get(range.id);
    const text = input.cleanMarkdown.slice(range.startOffset, range.endOffset);

    return {
      id: range.id,
      memoryId: input.memoryId,
      text,
      prefix: readPrefixContext(input.cleanMarkdown, range.startOffset),
      suffix: readSuffixContext(input.cleanMarkdown, range.endOffset),
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };
  });
}

function readPrefixContext(markdown: string, startOffset: number): string {
  const lineStart = markdown.lastIndexOf("\n", startOffset - 1) + 1;
  return markdown.slice(Math.max(lineStart, startOffset - CONTEXT_LIMIT), startOffset);
}

function readSuffixContext(markdown: string, endOffset: number): string {
  const nextLineBreak = markdown.indexOf("\n", endOffset);
  const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak;
  return markdown.slice(endOffset, Math.min(lineEnd, endOffset + CONTEXT_LIMIT));
}

async function restorePreviousContent(input: {
  config: ResolvedTraumaConfig;
  content: Awaited<ReturnType<typeof readMemoryContent>>;
  memoryId: string;
}): Promise<void> {
  try {
    await writeMemoryContent({
      config: { storePath: input.config.storePath },
      memoryId: input.memoryId,
      frontmatter: input.content.frontmatter,
      markdown: input.content.markdown,
    });
  } catch {
    // The database remains canonical. If restore fails, surface the original
    // database error while leaving the attempted content repair best-effort.
  }
}

async function enqueueBackup(input: {
  backupQueue: MemoryBackupQueue;
  contentPath: string;
  memoryId: string;
  now: Date;
  repositories: ReturnType<typeof createRepositories>;
  shouldEnqueue: boolean;
}): Promise<void> {
  if (!input.shouldEnqueue) {
    return;
  }

  try {
    const queued = await input.backupQueue.enqueue({
      memoryId: input.memoryId,
      contentPath: input.contentPath,
    });
    await input.repositories.memories.updateBackupStatus({
      id: input.memoryId,
      backupStatus: queued.backupStatus,
      lastBackupAt: null,
      lastBackupError: null,
      updatedAt: input.now,
    });
  } catch (error) {
    try {
      await input.repositories.memories.updateBackupStatus({
        id: input.memoryId,
        backupStatus: "failed",
        lastBackupAt: null,
        lastBackupError: formatUnknownError(error),
        updatedAt: input.now,
      });
    } catch {
      // Highlight persistence succeeded; backup status is best effort here.
    }
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
