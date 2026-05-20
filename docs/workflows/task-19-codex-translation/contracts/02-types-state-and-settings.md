# Brilliant types, state, and settings contract

## TypeScript contracts

Create shared interfaces in `src/server/translation/types.ts` and import them everywhere.

```ts
export type TranslationJobStatus =
  | "pending"
  | "running"
  | "stale"
  | "cancel_requested"
  | "canceled"
  | "unavailable"
  | "stitching"
  | "committing"
  | "complete"
  | "failed";

export type TranslationChunkStatus =
  | "pending"
  | "running"
  | "validating"
  | "retrying"
  | "complete"
  | "purged"
  | "failed";

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

export interface TranslationJobSnapshot {
  job_id: string;
  memory_id: string;
  lang_code: string;
  status: TranslationJobStatus;
  source_hash: string;
  chunk_count: number;
  completed_chunks: number;
  failed_chunks: number;
  retrying_chunks: number;
  output_path: string | null;
  reader_url: string | null;
  error: TranslationJobSnapshotError | null;
}

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

`TranslationPersistedError` is the storage format for both
`translation_jobs.error` and `translation_chunks.error`. Store it as a JSON
string in SQLite, or `NULL` when no error exists. Do not store raw exception
strings, prompts, source chunks, credential paths, tokens, app-server URLs, or
raw app-server payloads in either column.

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
```

`TranslationErrorCode` is the shared safe error-code namespace used by API error
responses, job snapshots, and SSE failure events. `TranslationPersistedError`
uses the narrower `PersistableTranslationErrorCode` because request-boundary
errors such as `translation_language_required`, `translation_language_mismatch`,
`missing_memory`, `missing_source_content`, `invalid_language`, and
`cancellation_conflict` must not be stored as job/chunk lifecycle failures in
SQLite.

`TranslationJobSnapshot.reader_url` is derived, not stored. It is non-null only when a current committed translation exists for `(memory_id, lang_code, source_hash)` and the output file hash matches the completed translation row. For pending, running, cancel-requested, canceled, failed, stale, or renderable-output-missing states, it is `null`.

For `GET /api/translation-jobs/:job_id`, `reader_url` is non-null only when the
job is complete, its `source_hash` still matches the current source
`CONTENT.md` hash, its output file exists, and the output file hash matches
`translation_jobs.output_hash`. A historical complete job for an older source
hash reports `reader_url = null`.

For `status = "unavailable"`, public snapshots set `reader_url = null` and
`error.code = "translation_unavailable"`. The error message must be safe for UI
display and must not include local absolute paths unless the project-standard
diagnostics UI explicitly allows them.

`TranslationJobSnapshot.completed_chunks` counts chunks whose status is
`complete` or `purged`. After a successful final commit and purge, a complete job
still reports `completed_chunks = chunk_count` even though chunk bodies have been
purged from SQLite. Use raw status counts only for internal diagnostics.

## Event types

```ts
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
```

Terminal `translation.job.completed` event data must include:

```ts
export interface TranslationJobCompletedData {
  output_path: string;
  output_hash: string;
  reader_url: string;
}
```

Terminal `translation.job.stale` event data must include:

```ts
export interface TranslationJobStaleData {
  reason: "source_changed";
  job_source_hash: string;
  current_source_hash: string;
}
```

Terminal `translation.job.failed` event data must include:

```ts
export interface TranslationJobFailedData {
  error: TranslationJobSnapshotError;
}
```

`translation.chunk.failed` event data must include:

```ts
export interface TranslationChunkFailedData {
  error: TranslationJobSnapshotError;
  retry_count: number;
  will_retry: boolean;
}
```

Failure event messages must be safe for UI display and must not include source
chunks, prompts, credential paths, tokens, app-server URLs, or raw app-server
payloads.

`stale` is a terminal state for a job attempt. It is distinct from `failed`
because user action is to start a new translation for the changed source, not to
retry the old source hash.

## Job transitions

```text
pending -> running
pending -> stale
pending -> cancel_requested
running -> stale
running -> stitching
running -> failed
running -> cancel_requested
cancel_requested -> canceled
complete -> unavailable only when the committed output file is missing or its hash no longer matches `output_hash`
stitching -> committing
stitching -> failed
committing -> complete
committing -> failed
failed -> pending only when a user explicitly retries by creating a new job
```

Completed jobs are immutable history while their committed output file remains available. Do not mutate `complete -> stale` when source content changes; Reader/API freshness is derived by comparing the job `source_hash` with the current source `CONTENT.md` hash. If the committed output file is missing or its hash no longer matches `output_hash`, mark the row `unavailable` so the same `(memory_id, lang_code, source_hash)` can be translated again.

`unavailable` is a terminal history status. It is not active work, it must not be
scheduled by the runner, and it must not emit its own SSE terminal event. It is
surfaced through job snapshots and API error responses with
`error.code = "translation_unavailable"`.

Cancellation is allowed only while a job is `pending`, `running`, or already in
`cancel_requested`. Requests for `cancel_requested` or `canceled` jobs are
idempotent. Requests for `stitching`, `committing`, `complete`, `stale`,
`failed`, or `unavailable` jobs return `cancellation_conflict`.

## Hash contract

Hash values use `sha256:<hex>`.

Source hash input:

- Hash the exact UTF-8 bytes read from `memories/<memory_id>/CONTENT.md`.
- Resolve that path under configured `storePath`.
- Do not normalize line endings.
- Do not trim leading or trailing bytes.
- Do not parse and reserialize Markdown before hashing.
- If the file cannot be decoded as UTF-8 for Markdown parsing, fail source loading before creating translation chunks.

Translated output hash input:

- Hash the exact UTF-8 bytes of the committed translated `CONTENT.md` after atomic rename.

## Chunk transitions

```text
pending -> running
running -> validating
running -> failed
validating -> complete
validating -> retrying
retrying -> running
complete -> purged
failed -> retrying while retry_count < maxRetryCount
failed -> failed when retry_count >= maxRetryCount
```

## Settings language contract

Canonical setting:

```text
translation_target_lang_code = "ja-JP"
```

Supported language table:

```ts
export const SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: "ja-JP", displayName: "Japanese", nativeName: "日本語" },
  { code: "en-US", displayName: "English (US)", nativeName: "English" },
  { code: "en-GB", displayName: "English (UK)", nativeName: "English" },
  { code: "ko-KR", displayName: "Korean", nativeName: "한국어" },
  { code: "zh-CN", displayName: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "zh-TW", displayName: "Chinese (Traditional)", nativeName: "繁體中文" },
  { code: "fr-FR", displayName: "French", nativeName: "Français" },
  { code: "de-DE", displayName: "German", nativeName: "Deutsch" },
  { code: "es-ES", displayName: "Spanish", nativeName: "Español" },
  { code: "pt-BR", displayName: "Portuguese (Brazil)", nativeName: "Português (Brasil)" }
] as const;
```

Rules:

- `/settings` lets the user select the translation target language.
- The settings API persists the selected value in SQLite.
- The persisted value must exactly match a `code` in `SUPPORTED_TRANSLATION_LANGUAGES`.
- `ja-JP` is the Japanese value.
- Canonical casing comes from the supported-language table; do not normalize and persist non-canonical casing such as `ja-jp` or `JA-JP`.
- Prompt target language labels and reader variant tab labels must come from the same supported-language table.
- Brilliant translation start reads this value server-side before creating a job.
- The browser may display the selected language, but the translation backend must not trust a client-provided language as the source of truth.
- If `POST /api/memories/:memory_id/translations` includes a `lang_code`, the backend must verify that it matches the persisted SQLite setting.
- If the request language differs from the persisted setting, reject with `409 translation_language_mismatch`.
- If no translation target language is configured, reject with `409 translation_language_required`.
- Old jobs retain their own `lang_code`; future jobs use the latest settings value.

## Local runner contract

Brilliant uses a local in-process runner for the MVP because TRAUMA is a local-first single-user app.

Rules:

- `POST /api/memories/:memory_id/translations` creates or reuses a job, schedules it on the local runner, and returns `202` or `200`.
- The runner processes one translation job at a time by default.
- Chunks inside a job are processed sequentially by default.
- Later concurrency tuning may add configurable chunk concurrency, but the MVP should avoid parallel Codex turns for the same document.
- Runner state is recoverable from SQLite job/chunk rows.
- On server startup, or before accepting a new translation job, recover interrupted `pending`, `running`, `stitching`, `committing`, and `cancel_requested` jobs according to the recovery contract.
- A `pending` job left by a process restart must either be scheduled if the source hash still matches or marked `stale` if the source changed before it started.
- A process restart may pause a job, but must not corrupt an existing completed translation.
