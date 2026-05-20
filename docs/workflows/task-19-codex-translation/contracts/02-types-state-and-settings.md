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

## Job transitions

```text
pending -> running
running -> stale
running -> stitching
running -> failed
running -> cancel_requested
cancel_requested -> canceled
stitching -> committing
stitching -> failed
committing -> complete
committing -> failed
failed -> pending only when a user explicitly retries by creating a new job
```

Completed jobs are immutable history. Do not mutate `complete -> stale`. Reader/API freshness is derived by comparing the job `source_hash` with the current source `CONTENT.md` hash.

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

Rules:

- `/settings` lets the user select the translation target language.
- The settings API persists the selected value in SQLite.
- The persisted value must be a supported BCP 47 language code.
- `ja-JP` is the Japanese value.
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
- On server startup, or before accepting a new translation job, recover interrupted `running`, `stitching`, `committing`, and `cancel_requested` jobs according to the recovery contract.
- A process restart may pause a job, but must not corrupt an existing completed translation.
