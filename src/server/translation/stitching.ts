import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { MemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type {
  TranslationChunkRecord,
  TranslationJobRecord,
  TranslationRepository,
} from "../db/repositories";
import { createSha256ContentHash } from "./hash";
import { splitFrontmatter } from "./markdown-blocks";
import {
  createTranslatedReaderUrl,
  resolveTranslatedMemoryContentPath,
  resolveTranslatedMemoryTempPath,
} from "./paths";
import { loadTranslationSourceSnapshot } from "./source-loader";

export interface TranslationCommitResult {
  outputHash: string;
  outputPath: string;
  readerUrl: string;
}

export async function commitTranslatedContent(input: {
  backupQueue: MemoryBackupQueue;
  config: ResolvedTraumaConfig;
  chunks: TranslationChunkRecord[];
  job: TranslationJobRecord;
  now?: Date;
  repository: TranslationRepository;
}): Promise<TranslationCommitResult | { status: "stale" }> {
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
    return { status: "stale" };
  }

  const body = stitchCompletedChunks(input.chunks);
  const { frontmatter } = splitFrontmatter(source.sourceMarkdown);
  const output = `${frontmatter}${body}`;
  const outputPath = await writeTranslatedContentAtomically({
    config: input.config,
    jobId: input.job.jobId,
    langCode: input.job.langCode,
    memoryId: input.job.memoryId,
    markdown: output,
  });
  const outputBytes = await readFile(outputPath.absolutePath);
  const outputHash = createSha256ContentHash(outputBytes);

  await input.repository.updateTranslationJobStatus(input.job.jobId, "complete", {
    completedAt: now,
    outputHash,
    outputPath: outputPath.relativePath,
    updatedAt: now,
  });
  await input.repository.purgeCompletedTranslationChunks(input.job.jobId, now);
  await input.backupQueue.enqueue({
    contentPath: outputPath.relativePath,
    memoryId: input.job.memoryId,
    reason: "translation_update",
  });

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
