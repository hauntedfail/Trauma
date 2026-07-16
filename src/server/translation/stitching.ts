import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DurableMemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type {
  TranslationChunkRecord,
  TranslationJobRecord,
  TranslationRepository,
} from "../db/repositories";
import { createSha256ContentHash } from "./hash";
import {
  parseMarkdownTranslationBlocks,
  splitFrontmatter,
} from "./markdown-blocks";
import {
  createTranslatedReaderUrl,
  resolveTranslatedMemoryContentPath,
  resolveTranslatedMemoryProjectionPath,
  resolveTranslatedMemoryTempPath,
} from "./paths";
import type { SupportedLanguageCode } from "./languages";
import { loadTranslationSourceSnapshot } from "./source-loader";
import {
  buildTranslationProjectionSpans,
  serializeTranslationProjectionSidecar,
} from "./projection-map";

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

export async function commitTranslatedContent(input: {
  backupQueue: DurableMemoryBackupQueue;
  config: ResolvedTraumaConfig;
  chunks: TranslationChunkRecord[];
  job: TranslationJobRecord;
  now?: Date;
  repository: TranslationRepository;
}): Promise<TranslationCommitResult | StaleTranslationCommitResult> {
  const source = await loadTranslationSourceSnapshot({
    config: input.config,
    memoryId: input.job.memoryId,
  });
  const now = input.now ?? new Date();
  if (source.sourceHash !== input.job.sourceHash) {
    await input.repository.updateTranslationJobStatus(input.job.jobId, "stale", {
      error: {
        code: "stale_source",
        message: "Source CONTENT.md changed while translation was running.",
        action: "open_source_reader",
      },
      updatedAt: now,
    });
    return {
      currentSourceHash: source.sourceHash,
      jobSourceHash: input.job.sourceHash,
      status: "stale",
    };
  }

  const body = stitchCompletedChunks(input.chunks);
  const { frontmatter } = splitFrontmatter(source.sourceMarkdown);
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
  await input.backupQueue.persistIntent({
    contentPaths: [
      intendedOutputPath.relativePath,
      projectionPath.relativePath,
    ],
    memoryId: input.job.memoryId,
    reason: "translation_update",
  });
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
  await writeFile(
    projectionPath.absolutePath,
    serializeTranslationProjectionSidecar({
      jobId: input.job.jobId,
      langCode: input.job.langCode as SupportedLanguageCode,
      memoryId: input.job.memoryId,
      outputHash,
      sourceHash: input.job.sourceHash,
      spans: projectionSpans,
      version: 1,
    }),
    "utf8",
  );
  await input.repository.replaceProjectionSpansForJob(
    input.job.jobId,
    projectionSpans,
  );

  await input.repository.updateTranslationJobStatus(input.job.jobId, "complete", {
    completedAt: now,
    outputHash,
    outputPath: outputPath.relativePath,
    updatedAt: now,
  });
  try {
    await input.repository.purgeCompletedTranslationChunks(input.job.jobId, now);
  } catch (error) {
    console.warn("failed to purge completed translation chunks", error);
  }
  try {
    await input.backupQueue.enqueue({
      contentPaths: [outputPath.relativePath, projectionPath.relativePath],
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
  chunks: readonly TranslationChunkRecord[],
): string {
  return [...chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => {
      if (chunk.status !== "complete" || chunk.translatedMarkdown === null) {
        throw new TranslationStitchingError(
          `chunk ${chunk.chunkIndex} is not complete`,
        );
      }
      return chunk.translatedMarkdown;
    })
    .join("");
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
  const temporaryPath = resolveTranslatedMemoryTempPath(input);
  let moved = false;

  try {
    await mkdir(dirname(outputPath.absolutePath), { recursive: true });
    const file = await open(temporaryPath, "w");
    try {
      await file.writeFile(input.markdown, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, outputPath.absolutePath);
    moved = true;
    await syncDirectoryBestEffort(dirname(outputPath.absolutePath));
  } finally {
    if (!moved) {
      await rm(temporaryPath, { force: true });
    }
  }

  return outputPath;
}

async function syncDirectoryBestEffort(directoryPath: string): Promise<void> {
  try {
    const directory = await open(directoryPath, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // Some platforms/filesystems do not allow fsync on directories. The file
    // fsync plus atomic same-directory rename remains the hard requirement.
  }
}

export class TranslationStitchingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationStitchingError";
  }
}
