import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MemoryBackupQueue } from "../backup";
import { assertBackupEnvironmentReady } from "../backup/environment";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import { createRepositories } from "../db/repositories";
import {
  sourceFlashbackVariant,
  toFlashbackVariantColumns,
  type FlashbackVariant,
} from "./variant";
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
import {
  getFlashbackMetadataExportPath,
  writeFlashbackMetadataExport,
} from "./export";

const CONTEXT_LIMIT = 80;

export type FlashbackToggleOperation = "flashback" | "unflashback";

export interface ToggleMemoryFlashbackInput {
  memoryId: string;
  operation?: FlashbackToggleOperation;
  selection: FlashbackSelectionInput;
  variant?: FlashbackVariant;
  content?: {
    markdown: string;
    relativePath: string;
  };
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
    variantKind: "source" | "translation";
    langCode: string | null;
    translationOutputHash: string | null;
    createdAt: string;
  }>;
}

type FlashbackRow = Awaited<
  ReturnType<ReturnType<typeof createRepositories>["flashbacks"]["listForMemory"]>
>[number];
type FlashbackExportSnapshot =
  | { exists: true; content: string; relativePath: string }
  | { exists: false; relativePath: string };

const flashbackMemoryLocks = new Map<string, Promise<void>>();

export class FlashbackToggleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_memory"
      | "invalid_selection"
      | "translation_unavailable"
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

  const variant = input.variant ?? sourceFlashbackVariant;
  const content = input.content ?? await readMemoryContent({
    config: { storePath: input.config.storePath },
    memoryId: input.memoryId,
  });
  const selection = resolveSelection(content.markdown, input.selection);
  const contentHash = createReaderContentHash(content.markdown);
  const existingFlashbacks =
    await repositories.flashbacks.listForMemoryVariant({
      memoryId: input.memoryId,
      variant,
    });
  const previousFlashbacks = existingFlashbacks.map((flashback) => ({
    ...flashback,
  }));
  const previousExport = await readFlashbackExportSnapshot({
    config: input.config,
    memoryId: input.memoryId,
    variant,
  });
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
    variant,
  });
  await repositories.flashbacks.replaceForMemoryVariant({
    memoryId: input.memoryId,
    variant,
    flashbacks: nextFlashbacks,
  });
  let flashbackExportPath: string;
  try {
    flashbackExportPath = await writeFlashbackMetadataExport({
      config: input.config,
      memoryId: input.memoryId,
      variant,
      flashbacks: nextFlashbacks,
    });
  } catch (error) {
    await repositories.flashbacks.replaceForMemoryVariant({
      memoryId: input.memoryId,
      variant,
      flashbacks: previousFlashbacks,
    });
    throw error;
  }

  if (input.config.backup.git.enabled) {
    try {
      const enqueueResult = await input.backupQueue.enqueue({
        memoryId: input.memoryId,
        contentPaths: [flashbackExportPath],
        reason: "flashback_update",
      });
      if (enqueueResult.backupStatus === "queued") {
        await repositories.memories.updateBackupStatus({
          id: input.memoryId,
          backupStatus: "queued",
          lastBackupError: null,
          updatedAt: now,
        });
      }
    } catch (error) {
      await repositories.flashbacks.replaceForMemoryVariant({
        memoryId: input.memoryId,
        variant,
        flashbacks: previousFlashbacks,
      });
      await restoreFlashbackExportSnapshot({
        config: input.config,
        snapshot: previousExport,
      });
      throw error;
    }
  }

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
      variantKind: flashback.variantKind,
      langCode: flashback.langCode,
      translationOutputHash: flashback.translationOutputHash,
      createdAt: flashback.createdAt.toISOString(),
    })),
  };
}

async function readFlashbackExportSnapshot(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant: FlashbackVariant;
}): Promise<FlashbackExportSnapshot> {
  const relativePath = getFlashbackMetadataExportPath({
    memoryId: input.memoryId,
    variant: input.variant,
  });
  const absolutePath = join(input.config.storePath, relativePath);
  try {
    return {
      exists: true,
      relativePath,
      content: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        exists: false,
        relativePath,
      };
    }

    throw error;
  }
}

async function restoreFlashbackExportSnapshot(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  snapshot: FlashbackExportSnapshot;
}): Promise<void> {
  const absolutePath = join(input.config.storePath, input.snapshot.relativePath);
  if (input.snapshot.exists) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.snapshot.content, "utf8");
    return;
  }

  await rm(absolutePath, { force: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
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
  variant: FlashbackVariant;
}): FlashbackRow[] {
  const existingById = new Map(
    input.existingFlashbacks.map((flashback) => [flashback.id, flashback]),
  );
  const variantColumns = toFlashbackVariantColumns(input.variant);

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
      ...variantColumns,
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
