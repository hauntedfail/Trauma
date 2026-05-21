import { MemoryContentStoreError } from "../store";
import {
  getMemoryBackupQueue,
  type MemoryBackupQueue,
} from "../backup";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "../config";
import {
  initializeDatabase,
  type TraumaDatabaseConnection,
  type TraumaRepositories,
} from "../db";
import { generateMemoryId } from "../memories/id";
import { createTranslationChunks } from "./chunker";
import {
  CodexAppServerClient,
  CodexAppServerError,
  type TranslationClient,
} from "./codex-app-server";
import {
  repairUnavailableTranslation,
  resolveCurrentTranslationReadOnly,
} from "./current-translation";
import { translationEventBus } from "./events";
import { createSha256ContentHash } from "./hash";
import { parseMarkdownTranslationBlocks } from "./markdown-blocks";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
  buildTranslationPrompt,
  createCodexChunkOutputSchema,
  stringifyCodexChunkOutput,
  validateCodexChunkOutput,
  TranslationOutputValidationError,
} from "./prompt";
import { loadTranslationSourceSnapshot } from "./source-loader";
import { commitTranslatedContent, TranslationStitchingError } from "./stitching";
import {
  BRILLIANT_MAX_RETRIES,
  type PersistableTranslationErrorCode,
  type TranslationErrorAction,
  type TranslationErrorCode,
  type TranslationJobCompletedData,
  type TranslationJobFailedData,
  type TranslationJobSnapshotError,
} from "./types";
import { isSupportedLanguageCode, type SupportedLanguageCode } from "./languages";

export type StartTranslationJobResult =
  | {
      status: "current";
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      output_path: string;
      reader_url: string;
    }
  | {
      status: "active";
      job_status: string;
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      event_url: string;
    }
  | {
      status: "started";
      job_id: string;
      memory_id: string;
      lang_code: SupportedLanguageCode;
      source_hash: string;
      event_url: string;
    };

export interface TranslationJobSnapshot {
  chunk_count: number;
  completed_chunks: number;
  error: TranslationJobSnapshotError | null;
  failed_chunks: number;
  job_id: string;
  lang_code: string;
  memory_id: string;
  output_path: string | null;
  reader_url: string | null;
  retrying_chunks: number;
  source_hash: string;
  status: string;
}

interface StartTranslationJobInput {
  backupQueue?: MemoryBackupQueue;
  client?: TranslationClient;
  config?: ResolvedTraumaConfig;
  generateJobId?: () => string;
  langCode?: string;
  memoryId: string;
  now?: Date;
  openConnection?: (config: ResolvedTraumaConfig) => TraumaDatabaseConnection;
  schedule?: (jobId: string, options: TranslationRunOptions) => void;
}

interface TranslationRunOptions {
  backupQueue?: MemoryBackupQueue;
  client?: TranslationClient;
  config?: ResolvedTraumaConfig;
  openConnection?: (config: ResolvedTraumaConfig) => TraumaDatabaseConnection;
}

let queue: Promise<void> = Promise.resolve();

export async function startTranslationJob(
  input: StartTranslationJobInput,
): Promise<StartTranslationJobResult> {
  const config = input.config ?? loadRuntimeTraumaConfig();
  const openConnection = input.openConnection ?? initializeDatabase;
  const now = input.now ?? new Date();
  const connection = openConnection(config);
  try {
    const memory = await connection.repositories.memories.findById(input.memoryId);
    if (memory === undefined) {
      throw new TranslationApiError(
        "missing_memory",
        "Memory was not found.",
        "open_source_reader",
      );
    }
    const settings = await connection.repositories.settings.getSettings(now);
    const langCode = settings.translationTargetLanguage;
    if (input.langCode !== undefined && input.langCode !== langCode) {
      throw new TranslationApiError(
        "translation_language_mismatch",
        "Requested language does not match the configured translation target language.",
        "open_settings",
      );
    }
    if (!isSupportedLanguageCode(langCode)) {
      throw new TranslationApiError(
        "invalid_language",
        "Unsupported translation target language.",
        "open_settings",
      );
    }

    const source = await loadTranslationSourceSnapshot({
      config,
      memoryId: input.memoryId,
    });
    const current = await resolveCurrentTranslationReadOnly({
      config,
      langCode,
      memoryId: input.memoryId,
      repository: connection.repositories.translations,
    });
    if (current.status === "current") {
      return {
        status: "current",
        job_id: current.job.jobId,
        memory_id: input.memoryId,
        lang_code: langCode,
        source_hash: current.sourceHash,
        output_path: current.outputPath,
        reader_url: current.readerUrl,
      };
    }
    if (current.status === "unavailable") {
      await repairUnavailableTranslation({
        jobId: current.job.jobId,
        reason: current.reason,
        repository: connection.repositories.translations,
        now,
      });
    }

    const active = await connection.repositories.translations.findActiveTranslationJob(
      input.memoryId,
      langCode,
      source.sourceHash,
    );
    if (active !== null) {
      if (active.status === "cancel_requested") {
        throw new TranslationApiError(
          "cancellation_conflict",
          "A cancellation is still being finalized. Try again shortly.",
          "none",
        );
      }
      return {
        status: "active",
        job_status: active.status,
        job_id: active.jobId,
        memory_id: input.memoryId,
        lang_code: langCode,
        source_hash: source.sourceHash,
        event_url: createTranslationEventUrl(active.jobId),
      };
    }

    const client = input.client ?? new CodexAppServerClient();
    await client.probe();

    const manifest = parseMarkdownTranslationBlocks(source.sourceMarkdown);
    const jobId = input.generateJobId === undefined
      ? generateMemoryId(now)
      : input.generateJobId();
    const chunks = createTranslationChunks({
      blocks: manifest.blocks,
      jobId,
      langCode,
      memoryId: input.memoryId,
      source,
    });
    const job = await connection.repositories.translations.createTranslationJob({
      chunkCount: chunks.length,
      chunkerVersion: BRILLIANT_CHUNKER_VERSION,
      jobId,
      langCode,
      memoryId: input.memoryId,
      model: null,
      now,
      promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
      sourceHash: source.sourceHash,
    });
    await connection.repositories.translations.insertTranslationChunks(
      jobId,
      chunks.map((chunk) => ({
        blockIds: chunk.blockIds,
        chunkIndex: chunk.chunkIndex,
        now,
        sourceChunkHash: chunk.sourceChunkHash,
        status: "pending",
      })),
    );
    translationEventBus.emit({
      data: { chunk_count: chunks.length },
      jobId,
      langCode,
      memoryId: input.memoryId,
      type: "translation.job.started",
    });
    for (const chunk of chunks) {
      translationEventBus.emit({
        chunkIndex: chunk.chunkIndex,
        data: { source_chunk_hash: chunk.sourceChunkHash },
        jobId,
        langCode,
        memoryId: input.memoryId,
        type: "translation.chunk.queued",
      });
    }

    const schedule = input.schedule ?? enqueueTranslationJobRun;
    schedule(job.jobId, {
      backupQueue: input.backupQueue,
      client,
      config,
      openConnection,
    });

    return {
      status: "started",
      job_id: jobId,
      memory_id: input.memoryId,
      lang_code: langCode,
      source_hash: source.sourceHash,
      event_url: createTranslationEventUrl(jobId),
    };
  } catch (error) {
    throw mapStartError(error);
  } finally {
    connection.close();
  }
}

export function enqueueTranslationJobRun(
  jobId: string,
  options: TranslationRunOptions = {},
): void {
  queue = queue
    .catch(() => undefined)
    .then(() => runTranslationJob(jobId, options))
    .catch((error) => {
      console.error(`translation job ${jobId} failed`, error);
    });
}

export async function runTranslationJob(
  jobId: string,
  options: TranslationRunOptions = {},
): Promise<void> {
  const config = options.config ?? loadRuntimeTraumaConfig();
  const openConnection = options.openConnection ?? initializeDatabase;
  const backupQueue = options.backupQueue ?? getMemoryBackupQueue(config);
  const client = options.client ?? new CodexAppServerClient();
  const connection = openConnection(config);
  try {
    const job = await connection.repositories.translations.getTranslationJob(jobId);
    if (job === null) {
      return;
    }
    const claimed = job.status === "running" ||
      await connection.repositories.translations.claimTranslationJob(
        jobId,
        "pending",
        new Date(),
      );
    if (!claimed) {
      return;
    }

    const source = await loadTranslationSourceSnapshot({
      config,
      memoryId: job.memoryId,
    });
    if (source.sourceHash !== job.sourceHash) {
      await markJobFailed({
        connection,
        error: {
          code: "stale_source",
          message: "Source CONTENT.md changed while translation was running.",
          action: "open_source_reader",
        },
        jobId,
        status: "stale",
      });
      translationEventBus.emit({
        data: {
          reason: "source_changed",
          job_source_hash: job.sourceHash,
          current_source_hash: source.sourceHash,
        },
        jobId,
        langCode: job.langCode,
        memoryId: job.memoryId,
        type: "translation.job.stale",
      });
      return;
    }

    const manifest = parseMarkdownTranslationBlocks(source.sourceMarkdown);
    const runtimeChunks = createTranslationChunks({
      blocks: manifest.blocks,
      jobId,
      langCode: job.langCode,
      memoryId: job.memoryId,
      source,
    });
    for (const chunk of runtimeChunks) {
      if (await isCancellationRequested(connection.repositories, jobId)) {
        await cancelJob(connection.repositories, job);
        return;
      }
      const record = (await connection.repositories.translations.getTranslationChunks(jobId))
        .find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
      if (record?.status === "complete" || record?.status === "purged") {
        continue;
      }
      await translateAndPersistChunk({
        chunk,
        client,
        connection,
        jobLangCode: job.langCode,
        jobMemoryId: job.memoryId,
      });
    }

    await connection.repositories.translations.updateTranslationJobStatus(
      jobId,
      "stitching",
      { updatedAt: new Date() },
    );
    translationEventBus.emit({
      data: {},
      jobId,
      langCode: job.langCode,
      memoryId: job.memoryId,
      type: "translation.job.stitching",
    });
    await connection.repositories.translations.updateTranslationJobStatus(
      jobId,
      "committing",
      { updatedAt: new Date() },
    );
    translationEventBus.emit({
      data: {},
      jobId,
      langCode: job.langCode,
      memoryId: job.memoryId,
      type: "translation.job.committing",
    });
    const result = await commitTranslatedContent({
      backupQueue,
      chunks: await connection.repositories.translations.getTranslationChunks(jobId),
      config,
      job,
      repository: connection.repositories.translations,
    });
    if ((result as { status?: string }).status === "stale") {
      return;
    }
    const committed = result as Exclude<typeof result, { status: "stale" }>;
    translationEventBus.emit<TranslationJobCompletedData>({
      data: {
        output_hash: committed.outputHash,
        output_path: committed.outputPath,
        reader_url: committed.readerUrl,
      },
      jobId,
      langCode: job.langCode,
      memoryId: job.memoryId,
      type: "translation.job.completed",
    });
  } catch (error) {
    await failRunningJob(connection, jobId, error);
  } finally {
    connection.close();
  }
}

export async function readTranslationJobSnapshot(input: {
  config?: ResolvedTraumaConfig;
  jobId: string;
  openConnection?: (config: ResolvedTraumaConfig) => TraumaDatabaseConnection;
}): Promise<TranslationJobSnapshot | null> {
  const config = input.config ?? loadRuntimeTraumaConfig();
  const openConnection = input.openConnection ?? initializeDatabase;
  const connection = openConnection(config);
  try {
    const job = await connection.repositories.translations.getTranslationJob(input.jobId);
    if (job === null) {
      return null;
    }
    const counts = await connection.repositories.translations.countTranslationChunksByStatus(
      job.jobId,
    );
    let readerUrl: string | null = null;
    let outputPath: string | null = job.outputPath;
    let status = job.status;
    let error = job.error;
    if (job.status === "complete" && isSupportedLanguageCode(job.langCode)) {
      const current = await resolveCurrentTranslationReadOnly({
        config,
        langCode: job.langCode,
        memoryId: job.memoryId,
        repository: connection.repositories.translations,
      });
      if (current.status === "current") {
        readerUrl = current.readerUrl;
        outputPath = current.outputPath;
      } else if (current.status === "unavailable") {
        await repairUnavailableTranslation({
          jobId: current.job.jobId,
          reason: current.reason,
          repository: connection.repositories.translations,
        });
        status = "unavailable";
        error = {
          action: "start_fresh_translation",
          code: "translation_unavailable",
          message: "Translated CONTENT.md is unavailable.",
        };
        outputPath = null;
      }
    }

    return {
      chunk_count: job.chunkCount,
      completed_chunks: counts.complete + counts.purged,
      error,
      failed_chunks: counts.failed,
      job_id: job.jobId,
      lang_code: job.langCode,
      memory_id: job.memoryId,
      output_path: outputPath,
      reader_url: readerUrl,
      retrying_chunks: counts.retrying,
      source_hash: job.sourceHash,
      status,
    };
  } finally {
    connection.close();
  }
}

async function translateAndPersistChunk(input: {
  chunk: ReturnType<typeof createTranslationChunks>[number];
  client: TranslationClient;
  connection: TraumaDatabaseConnection;
  jobLangCode: string;
  jobMemoryId: string;
}): Promise<void> {
  let attempt = 0;
  while (attempt <= BRILLIANT_MAX_RETRIES) {
    const now = new Date();
    await input.connection.repositories.translations.updateTranslationChunk(
      input.chunk.jobId,
      input.chunk.chunkIndex,
      {
        status: attempt === 0 ? "running" : "retrying",
        retryCount: attempt,
        updatedAt: now,
      },
    );
    translationEventBus.emit({
      chunkIndex: input.chunk.chunkIndex,
      data: { retry_count: attempt },
      jobId: input.chunk.jobId,
      langCode: input.jobLangCode,
      memoryId: input.jobMemoryId,
      type: attempt === 0
        ? "translation.chunk.started"
        : "translation.chunk.retrying",
    });

    try {
      const prompt = buildTranslationPrompt({
        chunk: input.chunk,
        targetLanguage: input.jobLangCode as SupportedLanguageCode,
      });
      const rawOutput = await input.client.translateChunk({
        chunk: input.chunk,
        outputSchema: createCodexChunkOutputSchema(input.chunk),
        prompt,
        onEvent: (event) => {
          if (event.type === "delta") {
            translationEventBus.emit({
              chunkIndex: input.chunk.chunkIndex,
              data: { text: event.text },
              jobId: input.chunk.jobId,
              langCode: input.jobLangCode,
              memoryId: input.jobMemoryId,
              type: "translation.codex.delta",
            });
          } else if (event.type === "item.started") {
            translationEventBus.emit({
              chunkIndex: input.chunk.chunkIndex,
              data: { item_id: event.itemId },
              jobId: input.chunk.jobId,
              langCode: input.jobLangCode,
              memoryId: input.jobMemoryId,
              type: "translation.codex.item.started",
            });
          } else if (event.type === "item.completed") {
            translationEventBus.emit({
              chunkIndex: input.chunk.chunkIndex,
              data: { item_id: event.itemId },
              jobId: input.chunk.jobId,
              langCode: input.jobLangCode,
              memoryId: input.jobMemoryId,
              type: "translation.codex.item.completed",
            });
          }
        },
      });
      await input.connection.repositories.translations.updateTranslationChunk(
        input.chunk.jobId,
        input.chunk.chunkIndex,
        {
          status: "validating",
          updatedAt: new Date(),
        },
      );
      translationEventBus.emit({
        chunkIndex: input.chunk.chunkIndex,
        data: {},
        jobId: input.chunk.jobId,
        langCode: input.jobLangCode,
        memoryId: input.jobMemoryId,
        type: "translation.chunk.validating",
      });
      const output = validateCodexChunkOutput({
        chunk: input.chunk,
        output: rawOutput,
      });
      const translatedMarkdown = stringifyCodexChunkOutput(output);
      await input.connection.repositories.translations.updateTranslationChunk(
        input.chunk.jobId,
        input.chunk.chunkIndex,
        {
          error: null,
          status: "complete",
          translatedHash: createSha256ContentHash(translatedMarkdown),
          translatedMarkdown,
          updatedAt: new Date(),
        },
      );
      translationEventBus.emit({
        chunkIndex: input.chunk.chunkIndex,
        data: { translated_hash: createSha256ContentHash(translatedMarkdown) },
        jobId: input.chunk.jobId,
        langCode: input.jobLangCode,
        memoryId: input.jobMemoryId,
        type: "translation.chunk.completed",
      });
      return;
    } catch (error) {
      const willRetry = attempt < BRILLIANT_MAX_RETRIES;
      const persistedError = toPersistedError(error);
      await input.connection.repositories.translations.updateTranslationChunk(
        input.chunk.jobId,
        input.chunk.chunkIndex,
        {
          error: toPersistableError(persistedError),
          status: willRetry ? "retrying" : "failed",
          retryCount: attempt,
          updatedAt: new Date(),
        },
      );
      translationEventBus.emit({
        chunkIndex: input.chunk.chunkIndex,
        data: {
          error: persistedError,
          retry_count: attempt,
          will_retry: willRetry,
        },
        jobId: input.chunk.jobId,
        langCode: input.jobLangCode,
        memoryId: input.jobMemoryId,
        type: willRetry
          ? "translation.chunk.retrying"
          : "translation.chunk.failed",
      });
      if (!willRetry) {
        throw error;
      }
    }
    attempt += 1;
  }
}

async function failRunningJob(
  connection: TraumaDatabaseConnection,
  jobId: string,
  error: unknown,
): Promise<void> {
  const job = await connection.repositories.translations.getTranslationJob(jobId);
  if (job === null) {
    return;
  }
  const persistedError = toPersistedError(error);
  await markJobFailed({
    connection,
    error: persistedError,
    jobId,
    status: "failed",
  });
  translationEventBus.emit<TranslationJobFailedData>({
    data: { error: persistedError },
    jobId,
    langCode: job.langCode,
    memoryId: job.memoryId,
    type: "translation.job.failed",
  });
}

async function markJobFailed(input: {
  connection: TraumaDatabaseConnection;
  error: TranslationJobSnapshotError;
  jobId: string;
  status: "failed" | "stale";
}): Promise<void> {
  await input.connection.repositories.translations.updateTranslationJobStatus(
    input.jobId,
    input.status,
    {
      completedAt: new Date(),
      error: toPersistableError(input.error),
      updatedAt: new Date(),
    },
  );
}

async function isCancellationRequested(
  repositories: TraumaRepositories,
  jobId: string,
): Promise<boolean> {
  const job = await repositories.translations.getTranslationJob(jobId);
  return job?.status === "cancel_requested";
}

async function cancelJob(
  repositories: TraumaRepositories,
  job: { jobId: string; langCode: string; memoryId: string },
): Promise<void> {
  await repositories.translations.updateTranslationJobStatus(
    job.jobId,
    "canceled",
    {
      completedAt: new Date(),
      error: null,
      updatedAt: new Date(),
    },
  );
  translationEventBus.emit({
    data: {},
    jobId: job.jobId,
    langCode: job.langCode,
    memoryId: job.memoryId,
    type: "translation.job.canceled",
  });
}

function toPersistedError(error: unknown): TranslationJobSnapshotError {
  if (error instanceof TranslationApiError) {
    return {
      code: error.code,
      message: error.message,
      action: error.action,
    };
  }
  if (error instanceof CodexAppServerError) {
    return {
      code: error.code,
      message: error.message,
      action: error.code === "auth_required" ? "setup_codex_auth" : "retry",
    };
  }
  if (error instanceof TranslationOutputValidationError) {
    return {
      code: "validation_failed",
      message: error.message,
      action: "retry",
    };
  }
  if (error instanceof TranslationStitchingError) {
    return {
      code: "validation_failed",
      message: error.message,
      action: "retry",
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : "Translation failed.",
    action: "retry",
  };
}

function toPersistableError(error: TranslationJobSnapshotError) {
  const code = isPersistableErrorCode(error.code) ? error.code : "unknown";
  return {
    code,
    message: error.message,
    action: error.action,
  };
}

function isPersistableErrorCode(
  code: TranslationErrorCode,
): code is PersistableTranslationErrorCode {
  return ![
    "translation_language_required",
    "translation_language_mismatch",
    "invalid_language",
    "missing_memory",
    "missing_source_content",
    "cancellation_conflict",
  ].includes(code);
}

function mapStartError(error: unknown): Error {
  if (error instanceof CodexAppServerError) {
    return new TranslationApiError(
      error.code,
      error.message,
      error.code === "auth_required" ? "setup_codex_auth" : "retry",
    );
  }
  if (
    error instanceof MemoryContentStoreError &&
    error.code === "missing_content"
  ) {
    return new TranslationApiError(
      "missing_source_content",
      "Source CONTENT.md was not found.",
      "open_source_reader",
    );
  }
  if (error instanceof TraumaConfigError || error instanceof TranslationApiError) {
    return error;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function createTranslationEventUrl(jobId: string): string {
  return `/api/translation-jobs/${jobId}/events`;
}

export class TranslationApiError extends Error {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    public readonly action: TranslationErrorAction = "none",
  ) {
    super(message);
    this.name = "TranslationApiError";
  }
}
