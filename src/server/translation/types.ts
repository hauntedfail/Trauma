export const TRANSLATION_JOB_STATUSES = [
  "pending",
  "running",
  "stale",
  "cancel_requested",
  "canceled",
  "unavailable",
  "stitching",
  "committing",
  "complete",
  "failed",
] as const;

export const TRANSLATION_CHUNK_STATUSES = [
  "pending",
  "running",
  "validating",
  "retrying",
  "complete",
  "purged",
  "failed",
] as const;

export const BRILLIANT_MAX_RETRIES = 3;
export const BRILLIANT_CANCEL_GRACE_MS = 30_000;

export type TranslationJobStatus = (typeof TRANSLATION_JOB_STATUSES)[number];
export type TranslationChunkStatus =
  (typeof TRANSLATION_CHUNK_STATUSES)[number];

export type TranslationBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "blockquote"
  | "table"
  | "code_fence"
  | "inline_code_paragraph"
  | "math_block"
  | "html_block"
  | "image_figure"
  | "caption"
  | "footnote"
  | "bibliography_entry"
  | "unknown_raw";

export type TranslationErrorAction =
  | "open_settings"
  | "setup_codex_auth"
  | "retry"
  | "open_source_reader"
  | "start_fresh_translation"
  | "none";

export type TranslationErrorCode =
  | "translation_unavailable"
  | "translation_language_required"
  | "translation_language_mismatch"
  | "invalid_language"
  | "missing_memory"
  | "missing_source_content"
  | "auth_required"
  | "setup_required"
  | "app_server_unavailable"
  | "stale_source"
  | "cancellation_conflict"
  | "usage_limit"
  | "context_overflow"
  | "timeout"
  | "stream_disconnected"
  | "invalid_final_output"
  | "validation_failed"
  | "filesystem_failure"
  | "unknown";

export type PersistableTranslationErrorCode = Exclude<
  TranslationErrorCode,
  | "translation_language_required"
  | "translation_language_mismatch"
  | "invalid_language"
  | "missing_memory"
  | "missing_source_content"
  | "cancellation_conflict"
>;

export interface TranslationJobSnapshotError {
  code: TranslationErrorCode;
  message: string;
  action?: TranslationErrorAction;
}

export type TranslationUnavailableReason =
  | "output_missing"
  | "output_hash_mismatch";

export interface TranslationPersistedError {
  code: PersistableTranslationErrorCode;
  message: string;
  action?: TranslationErrorAction;
  reason?: TranslationUnavailableReason | string;
}

export interface TranslationSourceSnapshot {
  memoryId: string;
  sourcePath: string;
  sourceMarkdown: string;
  sourceHash: string;
  byteSize: number;
  roughTokenEstimate: number;
  title: string | null;
  sourceUrl: string | null;
  documentType: "article" | "paper" | "unknown";
}

export interface ProtectedSpan {
  kind:
    | "code_fence"
    | "inline_code"
    | "math"
    | "html_tag"
    | "url"
    | "markdown_link_destination"
    | "citation_marker"
    | "footnote_marker"
    | "identifier"
    | "file_path"
    | "command"
    | "placeholder";
  value: string;
  blockId: string;
}

export interface TranslationBlock {
  id: string;
  type: TranslationBlockType;
  markdown: string;
  sectionPath: string[];
  protectedSpans: ProtectedSpan[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface TranslationChunk {
  jobId: string;
  memoryId: string;
  langCode: string;
  sourceHash: string;
  chunkIndex: number;
  chunkCount: number;
  sectionPath: string[];
  docTitle: string | null;
  sourceUrl: string | null;
  documentType: "article" | "paper" | "unknown";
  styleProfile: string | null;
  glossary: Record<string, string>;
  blockIds: string[];
  sourceMarkdown: string;
  sourceChunkHash: string;
}

export interface CodexChunkOutput {
  chunk_index: number;
  blocks: Array<{
    id: string;
    translated_markdown: string;
  }>;
  warnings: string[];
}

export type TranslationEventType =
  | "translation.job.started"
  | "translation.chunk.queued"
  | "translation.chunk.started"
  | "translation.codex.delta"
  | "translation.codex.item.started"
  | "translation.codex.item.completed"
  | "translation.chunk.validating"
  | "translation.chunk.completed"
  | "translation.chunk.failed"
  | "translation.chunk.retrying"
  | "translation.job.snapshot"
  | "translation.job.stitching"
  | "translation.job.committing"
  | "translation.job.completed"
  | "translation.job.failed"
  | "translation.job.stale"
  | "translation.job.canceled";

export interface TranslationEventEnvelope<TData = unknown> {
  id: string;
  type: TranslationEventType;
  job_id: string;
  memory_id: string;
  lang_code: string;
  chunk_index: number | null;
  timestamp: number;
  data: TData;
}

export interface TranslationJobCompletedData {
  output_path: string;
  output_hash: string;
  reader_url: string;
}

export interface TranslationJobStaleData {
  reason: "source_changed";
  job_source_hash: string;
  current_source_hash: string;
}

export interface TranslationJobFailedData {
  error: TranslationJobSnapshotError;
}

export interface TranslationChunkFailedData {
  error: TranslationJobSnapshotError;
  retry_count: number;
  will_retry: boolean;
}
