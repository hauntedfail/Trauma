import { randomUUID } from "node:crypto";

import type { MemoryBackupQueue } from "../backup";
import { assertBackupEnvironmentReady } from "../backup/environment";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import { createRepositories } from "../db/repositories";
import {
  applyHighlightMarkers,
  createReaderContentHash,
  HighlightMarkerError,
  readCanonicalReaderRangeContext,
  normalizeHighlightMarkerRanges,
  resolveCanonicalHighlightSelection,
  stripHighlightMarkers,
  type HighlightMarkerRange,
  type HighlightSelectionInput,
} from "../store/highlight-markers";
import {
  readMemoryContent,
} from "../store/memory-content";
import {
  addHighlightCoverage,
  isRangeFullyHighlighted,
  removeHighlightCoverage,
  type HighlightRange,
} from "./ranges";
import { writeHighlightMetadataExport } from "./export";

const CONTEXT_LIMIT = 80;

export type HighlightToggleOperation = "highlight" | "unhighlight";

export interface ToggleMemoryHighlightInput {
  memoryId: string;
  operation?: HighlightToggleOperation;
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
    contentHash: string;
  }>;
}

type HighlightRow = Awaited<
  ReturnType<ReturnType<typeof createRepositories>["highlights"]["listForMemory"]>
>[number];

const highlightMemoryLocks = new Map<string, Promise<void>>();

export class HighlightToggleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_memory"
      | "invalid_selection"
      | "stale_selection",
  ) {
    super(message);
    this.name = "HighlightToggleError";
  }
}

export async function toggleMemoryHighlight(
  input: ToggleMemoryHighlightInput,
): Promise<ToggleMemoryHighlightResult> {
  return withHighlightMemoryLock(input.memoryId, () =>
    toggleMemoryHighlightUnlocked(input),
  );
}

async function toggleMemoryHighlightUnlocked(
  input: ToggleMemoryHighlightInput,
): Promise<ToggleMemoryHighlightResult> {
  await assertBackupEnvironmentReady({
    config: input.config,
    db: input.db,
  });
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
  const contentHash = createReaderContentHash(content.markdown);
  const existingHighlights = await repositories.highlights.listForMemory(
    input.memoryId,
  );
  const existingRanges = normalizeHighlightMarkerRanges(
    content.markdown,
    existingHighlights.map(toHighlightRange),
  );
  const generatedId = input.generateId ?? randomUUID;
  const currentFullyHighlighted = isRangeFullyHighlighted(
    existingRanges,
    selection,
  );
  const operation = input.operation ?? (currentFullyHighlighted
    ? "unhighlight"
    : "highlight");

  if (operation === "unhighlight" && !currentFullyHighlighted) {
    throw new HighlightToggleError(
      "Highlight state changed. Reload the reader and try again.",
      "stale_selection",
    );
  }

  const resultOperation = operation === "unhighlight"
    ? "unhighlighted"
    : "highlighted";
  const cleanMarkdown = stripHighlightMarkers(content.markdown);
  const nextRanges = operation === "unhighlight"
    ? removeHighlightCoverage(existingRanges, selection, generatedId)
    : currentFullyHighlighted
      ? existingRanges
      : addHighlightCoverage(existingRanges, selection, generatedId);
  const now = (input.now ?? (() => new Date()))();
  const nextHighlights = buildHighlightRows({
    cleanMarkdown,
    contentHash,
    existingHighlights,
    memoryId: input.memoryId,
    now,
    ranges: nextRanges,
  });
  await repositories.highlights.replaceForMemory(input.memoryId, nextHighlights);
  const highlightExportPath = await writeHighlightMetadataExport({
    config: input.config,
    memoryId: input.memoryId,
    highlights: nextHighlights,
  });
  await input.backupQueue.enqueue({
    memoryId: input.memoryId,
    contentPaths: [highlightExportPath],
    reason: "highlight_update",
  });

  return {
    operation: resultOperation,
    highlights: nextHighlights.map((highlight) => ({
      id: highlight.id,
      text: highlight.text,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      contentHash: highlight.contentHash ?? contentHash,
    })),
  };
}

async function withHighlightMemoryLock<T>(
  memoryId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = highlightMemoryLocks.get(memoryId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  highlightMemoryLocks.set(memoryId, queued);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (highlightMemoryLocks.get(memoryId) === queued) {
      highlightMemoryLocks.delete(memoryId);
    }
  }
}

function resolveSelection(markdown: string, selection: HighlightSelectionInput) {
  try {
    return resolveCanonicalHighlightSelection(markdown, selection);
  } catch (error) {
    if (error instanceof HighlightMarkerError) {
      throw new HighlightToggleError(error.message, "invalid_selection");
    }

    throw error;
  }
}

function toHighlightRange(highlight: HighlightRow): HighlightMarkerRange {
  return {
    id: highlight.id,
    contentHash: highlight.contentHash,
    startOffset: highlight.startOffset,
    endOffset: highlight.endOffset,
    text: highlight.text,
  };
}

function buildHighlightRows(input: {
  cleanMarkdown: string;
  contentHash: string;
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
    const rendered = readCanonicalReaderRangeContext(
      input.cleanMarkdown,
      range,
      CONTEXT_LIMIT,
    );

    return {
      id: range.id,
      memoryId: input.memoryId,
      text: rendered.text,
      prefix: rendered.prefix,
      suffix: rendered.suffix,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      contentHash: input.contentHash,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };
  });
}

export function renderMarkdownWithHighlightRecords(
  markdown: string,
  highlights: HighlightMarkerRange[],
): string {
  return applyHighlightMarkers(markdown, highlights);
}
