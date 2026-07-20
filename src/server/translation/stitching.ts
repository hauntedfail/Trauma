import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DurableMemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import {
  publishFileAtomically,
  syncDirectoryBestEffort,
} from "../files/atomic-write";
import type {
  FlashbackRepository,
  TranslationChunkRecord,
  TranslationJobRecord,
  TranslationRepository,
} from "../db/repositories";
import { withTranslatedFlashbackProjectionMutationLock } from "../flashbacks/coordination";
import {
  clearFlashbackExportReconciliationIntent,
  persistFlashbackExportReconciliationIntent,
} from "../flashbacks/export-intent";
import {
  getTranslatedFlashbackMetadataExportPath,
  writeFlashbackMetadataExport,
} from "../flashbacks/export";
import { createSha256ContentHash } from "./hash";
import {
  DEFAULT_TRANSLATION_WORKLOAD_LIMITS,
  TranslationOutputAdmission,
} from "./limits";
import {
  parseMarkdownTranslationBlocks,
  splitFrontmatter,
} from "./markdown-blocks";
import {
  createTranslatedReaderUrl,
  resolveTranslatedMemoryContentPath,
  resolveTranslatedMemoryProjectionPath,
} from "./paths";
import type { SupportedLanguageCode } from "./languages";
import { loadTranslationSourceSnapshot } from "./source-loader";
import {
  buildTranslationProjectionSpans,
  writeTranslationProjectionSidecarAtomically,
  type TranslationProjectionSidecar,
} from "./projection-map";
import {
  withMemoryArtifactMutation,
  type MemoryArtifactMutationReservation,
} from "../memories/mutation-reservation";

export interface TranslationCommitResult {
  outputHash: string;
  outputPath: string;
  readerUrl: string;
}

export interface StaleTranslationCommitResult {
  currentSourceHash: string;
  jobSourceHash: string;
  status: "stale";
}

export interface SupersededTranslationCommitResult {
  status: "superseded";
}

type CommitTranslatedContentInput = {
  backupQueue: DurableMemoryBackupQueue;
  config: ResolvedTraumaConfig;
  chunks: TranslationChunkRecord[];
  flashbacks: Pick<FlashbackRepository, "listForMemoryVariant">;
  job: TranslationJobRecord;
  maxOutputBytes?: number;
  maxSourceBytes?: number;
  now?: Date;
  publishProjectionSidecar?: (
    absolutePath: string,
    sidecar: TranslationProjectionSidecar,
  ) => Promise<void>;
  repository: TranslationRepository;
};

export async function commitTranslatedContent(
  input: CommitTranslatedContentInput,
): Promise<
  | TranslationCommitResult
  | StaleTranslationCommitResult
  | SupersededTranslationCommitResult
> {
  return withTranslatedFlashbackProjectionMutationLock(
    {
      langCode: input.job.langCode,
      memoryId: input.job.memoryId,
      storePath: input.config.storePath,
    },
    () => withMemoryArtifactMutation(
      { memoryId: input.job.memoryId, storePath: input.config.storePath },
      (reservation) => commitTranslatedContentReserved(input, reservation),
    ),
  );
}

async function commitTranslatedContentReserved(
  input: CommitTranslatedContentInput,
  reservation: MemoryArtifactMutationReservation,
): Promise<
  | TranslationCommitResult
  | StaleTranslationCommitResult
  | SupersededTranslationCommitResult
> {
  const source = await loadTranslationSourceSnapshot({
    config: input.config,
    maxSourceBytes: input.maxSourceBytes,
    memoryId: input.job.memoryId,
  });
  const now = input.now ?? new Date();
  if (source.sourceHash !== input.job.sourceHash) {
    reservation.assertWritable();
    const markedStale = await input.repository.transitionTranslationJobStatus(
      input.job.jobId,
      "committing",
      "stale",
      {
        error: {
          code: "stale_source",
          message: "Source CONTENT.md changed while translation was running.",
          action: "open_source_reader",
        },
        updatedAt: now,
      },
    );
    if (!markedStale) {
      return { status: "superseded" };
    }
    return {
      currentSourceHash: source.sourceHash,
      jobSourceHash: input.job.sourceHash,
      status: "stale",
    };
  }

  const { frontmatter } = splitFrontmatter(source.sourceMarkdown);
  const body = stitchCompletedChunks(input.chunks, {
    initialBytes: Buffer.byteLength(frontmatter, "utf8"),
    maxOutputBytes:
      input.maxOutputBytes ?? DEFAULT_TRANSLATION_WORKLOAD_LIMITS.maxOutputBytes,
  });
  const output = `${frontmatter}${body}`;
  validateFinalTranslatedContent({
    body,
    expectedFrontmatter: frontmatter,
    output,
  });
  const intendedOutputPath = resolveTranslatedMemoryContentPath({
    config: input.config,
    langCode: input.job.langCode,
    memoryId: input.job.memoryId,
  });
  const projectionPath = resolveTranslatedMemoryProjectionPath({
    config: input.config,
    langCode: input.job.langCode,
    memoryId: input.job.memoryId,
  });
  const flashbackExportPath = getTranslatedFlashbackMetadataExportPath({
    langCode: input.job.langCode,
    memoryId: input.job.memoryId,
  });
  reservation.assertWritable();
  await input.backupQueue.persistIntent({
    contentPaths: [
      intendedOutputPath.relativePath,
      projectionPath.relativePath,
      flashbackExportPath,
    ],
    memoryId: input.job.memoryId,
    reason: "translation_update",
  });
  reservation.assertWritable();
  const outputPath = await writeTranslatedContentAtomically({
    config: input.config,
    jobId: input.job.jobId,
    langCode: input.job.langCode,
    memoryId: input.job.memoryId,
    markdown: output,
  });
  const outputBytes = await readFile(outputPath.absolutePath);
  const outputHash = createSha256ContentHash(outputBytes);
  const projectionSpans = buildTranslationProjectionSpans({
    body,
    chunks: input.chunks,
    jobId: input.job.jobId,
    langCode: input.job.langCode as SupportedLanguageCode,
    memoryId: input.job.memoryId,
    now,
    outputHash,
    sourceHash: input.job.sourceHash,
  });
  reservation.assertWritable();
  await (
    input.publishProjectionSidecar ??
    writeTranslationProjectionSidecarAtomically
  )(
    projectionPath.absolutePath,
    {
      jobId: input.job.jobId,
      langCode: input.job.langCode as SupportedLanguageCode,
      memoryId: input.job.memoryId,
      outputHash,
      sourceHash: input.job.sourceHash,
      spans: projectionSpans,
      version: 1,
    },
  );
  reservation.assertWritable();
  await input.repository.replaceProjectionSpansForJob(
    input.job.jobId,
    projectionSpans,
  );

  const flashbackVariant = {
    kind: "translation" as const,
    langCode: input.job.langCode as SupportedLanguageCode,
    outputHash,
  };
  reservation.assertWritable();
  await persistFlashbackExportReconciliationIntent({
    config: input.config,
    memoryId: input.job.memoryId,
    variant: flashbackVariant,
  });
  reservation.assertWritable();
  const markedComplete = await input.repository.transitionTranslationJobStatus(
    input.job.jobId,
    "committing",
    "complete",
    {
      completedAt: now,
      outputHash,
      outputPath: outputPath.relativePath,
      updatedAt: now,
    },
  );
  if (!markedComplete) {
    return { status: "superseded" };
  }
  let confirmedFlashbackExportPath: string | undefined;
  try {
    reservation.assertWritable();
    const flashbacks = await input.flashbacks.listForMemoryVariant({
      memoryId: input.job.memoryId,
      variant: flashbackVariant,
    });
    confirmedFlashbackExportPath = await writeFlashbackMetadataExport({
      config: input.config,
      flashbacks,
      memoryId: input.job.memoryId,
      variant: flashbackVariant,
    });
    try {
      await clearFlashbackExportReconciliationIntent({
        config: input.config,
        memoryId: input.job.memoryId,
        variant: flashbackVariant,
      });
    } catch {
      // A confirmed export makes a retained or deletion-uncertain intent safe:
      // startup reconciliation is idempotent and will clear it after replay.
    }
  } catch (error) {
    // Translation completion is already authoritative. Keep the durable intent
    // for startup reconciliation instead of rolling the completed job back.
    console.warn("failed to reconcile translated flashback export", error);
  }
  try {
    await input.repository.purgeCompletedTranslationChunks(input.job.jobId, now);
  } catch (error) {
    console.warn("failed to purge completed translation chunks", error);
  }
  try {
    await input.backupQueue.enqueue({
      contentPaths: [
        outputPath.relativePath,
        projectionPath.relativePath,
        ...(confirmedFlashbackExportPath === undefined
          ? []
          : [confirmedFlashbackExportPath]),
      ],
      memoryId: input.job.memoryId,
      reason: "translation_update",
    });
  } catch (error) {
    console.warn("failed to enqueue translation backup", error);
  }

  return {
    outputHash,
    outputPath: outputPath.relativePath,
    readerUrl: createTranslatedReaderUrl({
      langCode: input.job.langCode,
      memoryId: input.job.memoryId,
    }),
  };
}

export function stitchCompletedChunks(
  chunks: readonly Pick<
    TranslationChunkRecord,
    "chunkIndex" | "status" | "translatedMarkdown"
  >[],
  options: {
    initialBytes?: number;
    maxOutputBytes?: number;
  } = {},
): string {
  const admission = new TranslationOutputAdmission({
    initialBytes: options.initialBytes,
    maxOutputBytes:
      options.maxOutputBytes ?? DEFAULT_TRANSLATION_WORKLOAD_LIMITS.maxOutputBytes,
  });
  const translatedChunks: string[] = [];
  for (const chunk of [...chunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  )) {
    if (chunk.status !== "complete" || chunk.translatedMarkdown === null) {
      throw new TranslationStitchingError(
        `chunk ${chunk.chunkIndex} is not complete`,
      );
    }
    admission.admitChunk(chunk.chunkIndex, chunk.translatedMarkdown);
    translatedChunks.push(chunk.translatedMarkdown);
  }
  return translatedChunks.join("");
}

export function validateFinalTranslatedContent(input: {
  body: string;
  expectedFrontmatter: string;
  output: string;
}): void {
  if (input.body.trim() === "") {
    throw new TranslationStitchingError("Translated document body is empty.");
  }
  if (input.output.includes("\u0000")) {
    throw new TranslationStitchingError("Translated document contains a null byte.");
  }
  if (!input.output.startsWith(input.expectedFrontmatter)) {
    throw new TranslationStitchingError(
      "Translated document frontmatter does not match the source frontmatter.",
    );
  }
  const parsed = parseMarkdownTranslationBlocks(input.output);
  if (parsed.bodyMarkdown.trim() === "") {
    throw new TranslationStitchingError("Translated document body is empty.");
  }
  if (parsed.blocks.length === 0) {
    throw new TranslationStitchingError("Translated document has no readable blocks.");
  }
}

export async function writeTranslatedContentAtomically(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  jobId: string;
  langCode: string;
  markdown: string;
  memoryId: string;
}) {
  const outputPath = resolveTranslatedMemoryContentPath(input);
  const directory = dirname(outputPath.absolutePath);
  await mkdir(directory, { recursive: true });
  await syncDirectoryBestEffort(dirname(directory));
  await publishFileAtomically(outputPath.absolutePath, input.markdown);

  return outputPath;
}

export class TranslationStitchingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationStitchingError";
  }
}
