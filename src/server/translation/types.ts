import type { SupportedLanguageCode } from "./languages";

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
export const CODEX_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type TranslationJobStatus = (typeof TRANSLATION_JOB_STATUSES)[number];
export type TranslationChunkStatus =
  (typeof TRANSLATION_CHUNK_STATUSES)[number];
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export function isCodexReasoningEffort(
  value: string,
): value is CodexReasoningEffort {
  return (CODEX_REASONING_EFFORTS as readonly string[]).includes(value);
}

export type TranslationBlockType =
  | "heading"
  | "thematic_break"
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
  | "translation_model_unavailable"
  | "translation_reasoning_effort_unavailable"
  | "invalid_language"
  | "missing_memory"
  | "missing_source_content"
  | "auth_required"
  | "setup_required"
  | "runtime_isolation_required"
  | "app_server_unavailable"
  | "app_server_protocol_error"
  | "stale_source"
  | "cancellation_conflict"
  | "usage_limit"
  | "context_overflow"
  | "timeout"
  | "turn_interrupted"
  | "stream_disconnected"
  | "invalid_final_output"
  | "validation_failed"
  | "filesystem_failure"
  | "unknown";

export type PersistableTranslationErrorCode = Exclude<
  TranslationErrorCode,
  | "translation_language_required"
  | "translation_language_mismatch"
  | "translation_model_unavailable"
  | "translation_reasoning_effort_unavailable"
  | "invalid_language"
  | "missing_memory"
  | "missing_source_content"
  | "cancellation_conflict"
>;

export interface TranslationValidationDiagnostic {
  kind:
    | "markdown_structure"
    | "protected_span"
    | "segment_schema"
    | "segment_length_ratio"
    | "projection";
  message: string;
  chunkIndex?: number;
  segmentId?: string;
  blockId?: string;
  sourceEntry?: {
    kind: string;
    valuePreview: string;
  };
  translatedEntry?: {
    kind: string;
    valuePreview: string;
  };
  protectedSpan?: {
    kind: string;
    valuePreview: string;
  };
}

export interface TranslationJobSnapshotError {
  code: TranslationErrorCode;
  message: string;
  action?: TranslationErrorAction;
  diagnostics?: TranslationValidationDiagnostic[];
}

export type TranslationUnavailableReason =
  | "output_missing"
  | "output_hash_mismatch"
  | "policy_version_mismatch";

export interface TranslationPersistedError {
  code: PersistableTranslationErrorCode;
  message: string;
  action?: TranslationErrorAction;
  reason?: TranslationUnavailableReason | string;
  diagnostics?: TranslationValidationDiagnostic[];
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
  sourceEnd: number;
  sourceStart: number;
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
  sourceBlocks: TranslationBlock[];
  sourceMarkdown: string;
  sourceChunkHash: string;
  segments: TranslationTextSegment[];
}

export interface TranslationProjectionSpan {
  blockId: string;
  createdAt: Date;
  jobId: string;
  langCode: SupportedLanguageCode;
  memoryId: string;
  outputHash: string;
  segmentId: string;
  sourceHash: string;
  sourceMarkdownEnd: number;
  sourceMarkdownStart: number;
  sourceReaderEnd: number;
  sourceReaderStart: number;
  spanIndex: number;
  translatedMarkdownEnd: number;
  translatedMarkdownStart: number;
  translatedReaderEnd: number;
  translatedReaderStart: number;
  updatedAt: Date;
}

export interface TranslationChunkProjectionSpan {
  blockId: string;
  segmentId: string;
  sourceMarkdownEnd: number;
  sourceMarkdownStart: number;
  sourceReaderEnd: number;
  sourceReaderStart: number;
  translatedMarkdownEnd: number;
  translatedMarkdownStart: number;
  translatedReaderEnd: number;
  translatedReaderStart: number;
}

export interface RawCodexChunkOutput {
  chunk_index: number;
  segments: Array<{
    id: string;
    translated_text: string;
  }>;
  warnings: string[];
}

export interface CodexChunkOutput extends RawCodexChunkOutput {
  projectionSpans: TranslationChunkProjectionSpan[];
  translated_markdown: string;
}

export interface TranslationTextSegment {
  blockId: string;
  id: string;
  sourceDocumentEnd: number;
  sourceDocumentStart: number;
  sourceEnd: number;
  sourceReaderEnd: number;
  sourceReaderStart: number;
  sourceStart: number;
  text: string;
}

export interface TranslationProtectedRange {
  kind:
    | "code"
    | "inline_code"
    | "math"
    | "inline_math"
    | "html"
    | "link_destination"
    | "link_title"
    | "image_destination"
    | "image_title"
    | "footnote_label"
    | "table_delimiter"
    | "frontmatter";
  sourceEnd: number;
  sourceStart: number;
  value: string;
}

export interface TranslationSegmentReplacement {
  segmentId: string;
  translatedText: string;
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
