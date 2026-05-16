import { randomUUID } from "node:crypto";

import type { MemoryBackupQueue } from "../backup";
import { assertBackupEnvironmentReady } from "../backup/environment";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import { createRepositories } from "../db/repositories";
import {
  applyFlashbackMarkers,
  createReaderContentHash,
  FlashbackMarkerError,
  readCanonicalReaderRangeContext,
  normalizeFlashbackMarkerRanges,
  resolveCanonicalFlashbackSelection,
  stripFlashbackMarkers,
  type FlashbackMarkerRange,
  type FlashbackSelectionInput,
} from "../store/flashback-markers";
import {
  readMemoryContent,
} from "../store/memory-content";
import {
  addFlashbackCoverage,
  isRangeFullyFlashbacked,
  removeFlashbackCoverage,
  type FlashbackRange,
} from "./ranges";
import { writeFlashbackMetadataExport } from "./export";

const CONTEXT_LIMIT = 80;

export type FlashbackToggleOperation = "flashback" | "unflashback";

export interface ToggleMemoryFlashbackInput {
  memoryId: string;
  operation?: FlashbackToggleOperation;
  selection: FlashbackSelectionInput;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  backupQueue: MemoryBackupQueue;
  generateId?: () => string;
  now?: () => Date;
}

export interface ToggleMemoryFlashbackResult {
  operation: "flashbacked" | "unflashbacked";
  flashbacks: Array<{
    id: string;
    text: string;
    prefix: string;
    suffix: string;
    startOffset: number;
    endOffset: number;
    contentHash: string;
  }>;
}

type FlashbackRow = Awaited<
  ReturnType<ReturnType<typeof createRepositories>["flashbacks"]["listForMemory"]>
>[number];

const flashbackMemoryLocks = new Map<string, Promise<void>>();

export class FlashbackToggleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_memory"
      | "invalid_selection"
      | "stale_selection",
  ) {
    super(message);
    this.name = "FlashbackToggleError";
  }
}

export async function toggleMemoryFlashback(
  input: ToggleMemoryFlashbackInput,
): Promise<ToggleMemoryFlashbackResult> {
  return withFlashbackMemoryLock(input.memoryId, () =>
    toggleMemoryFlashbackUnlocked(input),
  );
}

async function toggleMemoryFlashbackUnlocked(
  input: ToggleMemoryFlashbackInput,
): Promise<ToggleMemoryFlashbackResult> {
  await assertBackupEnvironmentReady({
    config: input.config,
    db: input.db,
  });
  const repositories = createRepositories(input.db);
  const memory = await repositories.memories.findById(input.memoryId);
  if (memory === undefined) {
    throw new FlashbackToggleError("Memory was not found.", "missing_memory");
  }

  const content = await readMemoryContent({
    config: { storePath: input.config.storePath },
    memoryId: input.memoryId,
  });
  const selection = resolveSelection(content.markdown, input.selection);
  const contentHash = createReaderContentHash(content.markdown);
  const existingFlashbacks = await repositories.flashbacks.listForMemory(
    input.memoryId,
  );
  const existingRanges = normalizeFlashbackMarkerRanges(
    content.markdown,
    existingFlashbacks.map(toFlashbackRange),
  );
  const generatedId = input.generateId ?? randomUUID;
  const currentFullyFlashbacked = isRangeFullyFlashbacked(
    existingRanges,
    selection,
  );
  const operation = input.operation ?? (currentFullyFlashbacked
    ? "unflashback"
    : "flashback");

  if (operation === "unflashback" && !currentFullyFlashbacked) {
    throw new FlashbackToggleError(
      "Flashback state changed. Reload the reader and try again.",
      "stale_selection",
    );
  }

  const resultOperation = operation === "unflashback"
    ? "unflashbacked"
    : "flashbacked";
  const cleanMarkdown = stripFlashbackMarkers(content.markdown);
  const nextRanges = operation === "unflashback"
    ? removeFlashbackCoverage(existingRanges, selection, generatedId)
    : currentFullyFlashbacked
      ? existingRanges
      : addFlashbackCoverage(existingRanges, selection, generatedId);
  const now = (input.now ?? (() => new Date()))();
  const nextFlashbacks = buildFlashbackRows({
    cleanMarkdown,
    contentHash,
    existingFlashbacks,
    memoryId: input.memoryId,
    now,
    ranges: nextRanges,
  });
  await repositories.flashbacks.replaceForMemory(input.memoryId, nextFlashbacks);
  const flashbackExportPath = await writeFlashbackMetadataExport({
    config: input.config,
    memoryId: input.memoryId,
    flashbacks: nextFlashbacks,
  });
  await input.backupQueue.enqueue({
    memoryId: input.memoryId,
    contentPaths: [flashbackExportPath],
    reason: "flashback_update",
  });

  return {
    operation: resultOperation,
    flashbacks: nextFlashbacks.map((flashback) => ({
      id: flashback.id,
      text: flashback.text,
      prefix: flashback.prefix,
      suffix: flashback.suffix,
      startOffset: flashback.startOffset,
      endOffset: flashback.endOffset,
      contentHash: flashback.contentHash ?? contentHash,
    })),
  };
}

async function withFlashbackMemoryLock<T>(
  memoryId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = flashbackMemoryLocks.get(memoryId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  flashbackMemoryLocks.set(memoryId, queued);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (flashbackMemoryLocks.get(memoryId) === queued) {
      flashbackMemoryLocks.delete(memoryId);
    }
  }
}

function resolveSelection(markdown: string, selection: FlashbackSelectionInput) {
  try {
    return resolveCanonicalFlashbackSelection(markdown, selection);
  } catch (error) {
    if (error instanceof FlashbackMarkerError) {
      throw new FlashbackToggleError(error.message, "invalid_selection");
    }

    throw error;
  }
}

function toFlashbackRange(flashback: FlashbackRow): FlashbackMarkerRange {
  return {
    id: flashback.id,
    contentHash: flashback.contentHash,
    startOffset: flashback.startOffset,
    endOffset: flashback.endOffset,
    text: flashback.text,
  };
}

function buildFlashbackRows(input: {
  cleanMarkdown: string;
  contentHash: string;
  existingFlashbacks: FlashbackRow[];
  memoryId: string;
  now: Date;
  ranges: FlashbackRange[];
}): FlashbackRow[] {
  const existingById = new Map(
    input.existingFlashbacks.map((flashback) => [flashback.id, flashback]),
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

export function renderMarkdownWithFlashbackRecords(
  markdown: string,
  flashbacks: FlashbackMarkerRange[],
): string {
  return applyFlashbackMarkers(markdown, flashbacks);
}
