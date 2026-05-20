# Brilliant execution contracts

## Purpose

This file freezes the implementation contracts for Brilliant before code work starts. Implementation agents must treat this as the source of truth when executing subtasks 19.1 through 19.17.

## Canonical names

- Product task name: `Brilliant`
- Implementation branch: `feat/brilliant`
- Feature purpose: Codex app-server powered translation for Reader memory content
- Source content path: `memory/<memory_id>/CONTENT.md`
- Translated content path: `memory/<memory_id>/<lang_code>/CONTENT.md`
- Japanese language code: `ja-JP`
- Default progress transport: SSE
- Codex integration: backend-only Codex app-server client
- Default Codex thread strategy: one ephemeral Codex thread per chunk

## Files and ownership map

Use these paths unless existing code clearly has a more specific equivalent. If an equivalent path already exists, extend it instead of creating duplicate abstractions.

### Schema and repositories

- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/repositories.ts`
- Create: `src/server/db/translation-repositories.ts` if repositories are already split by domain
- Create: `drizzle/<next>_brilliant_translation_jobs.sql`
- Test: `tests/server/db/translation-schema.test.ts`
- Test: `tests/server/db/translation-repositories.test.ts`

### Translation domain

- Create: `src/server/translation/types.ts`
- Create: `src/server/translation/languages.ts`
- Create: `src/server/translation/source-loader.ts`
- Create: `src/server/translation/markdown-blocks.ts`
- Create: `src/server/translation/chunker.ts`
- Create: `src/server/translation/job-state.ts`
- Create: `src/server/translation/codex-app-server.ts`
- Create: `src/server/translation/prompt.ts`
- Create: `src/server/translation/validator.ts`
- Create: `src/server/translation/stitcher.ts`
- Create: `src/server/translation/atomic-writer.ts`
- Create: `src/server/translation/events.ts`
- Create: `src/server/translation/orchestrator.ts`
- Test: `tests/server/translation/source-loader.test.ts`
- Test: `tests/server/translation/markdown-blocks.test.ts`
- Test: `tests/server/translation/chunker.test.ts`
- Test: `tests/server/translation/job-state.test.ts`
- Test: `tests/server/translation/codex-app-server.test.ts`
- Test: `tests/server/translation/prompt.test.ts`
- Test: `tests/server/translation/validator.test.ts`
- Test: `tests/server/translation/stitcher.test.ts`
- Test: `tests/server/translation/atomic-writer.test.ts`
- Test: `tests/server/translation/events.test.ts`
- Test: `tests/server/translation/orchestrator.test.ts`

### API routes

- Create: `src/routes/api/memories/[memoryId]/translations.ts`
- Create: `src/routes/api/memories/[memoryId]/translations/[langCode].ts`
- Create: `src/routes/api/translation-jobs/[jobId].ts`
- Create: `src/routes/api/translation-jobs/[jobId]/events.ts`
- Create: `src/routes/api/translation-jobs/[jobId]/cancel.ts`
- Test: `tests/server/routes/api-memory-translations.test.ts`
- Test: `tests/server/routes/api-translation-jobs.test.ts`
- Test: `tests/server/routes/api-translation-events.test.ts`

### Settings and auth

- Modify: `src/components/settings/SettingsPage.tsx`
- Modify: `src/server/settings/codex-auth.ts` or create it if missing
- Modify: settings API routes created by Task 18
- Test: `tests/server/settings/codex-auth.test.ts`
- Test: `tests/components/settings-codex-auth.test.tsx`

### Reader frontend

- Modify: `src/server/reader/page-data.ts`
- Modify: `src/routes/memories/[id].tsx`
- Modify: `src/components/reader/MemoryReader.tsx`
- Create: `src/components/reader/TranslationControls.tsx`
- Create: `src/components/reader/TranslationProgress.tsx`
- Test: `tests/server/reader/translated-page-data.test.ts`
- Test: `tests/components/reader-translation-controls.test.tsx`
- Test: `tests/components/reader-translation-progress.test.tsx`

### Skill and fixtures

- Create: `.agents/skills/reader-translate/SKILL.md`
- Create: `tests/fixtures/translation/simple-article.md`
- Create: `tests/fixtures/translation/academic-paper.md`
- Create: `tests/fixtures/translation/hostile-prompt-injection.md`
- Create: `tests/fixtures/translation/markdown-protected-spans.md`

## TypeScript contracts

Create these interfaces in `src/server/translation/types.ts` and import them everywhere instead of redefining local shapes.

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

export interface TranslationBlock {
  id: string;
  type: TranslationBlockType;
  markdown: string;
  sectionPath: string[];
  protectedSpans: ProtectedSpan[];
  metadata: Record<string, string | number | boolean | null>;
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

## SQLite contract

Use Drizzle names that match these SQL-level names unless the existing schema naming convention requires camelCase in TypeScript.

```sql
CREATE TABLE translation_jobs (
  job_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  lang_code TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT,
  skill_version TEXT NOT NULL,
  chunker_version TEXT NOT NULL,
  status TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  output_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX translation_jobs_current_idx
  ON translation_jobs(memory_id, lang_code, source_hash);

CREATE INDEX translation_jobs_memory_lang_idx
  ON translation_jobs(memory_id, lang_code, updated_at);

CREATE TABLE translation_chunks (
  job_id TEXT NOT NULL REFERENCES translation_jobs(job_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  source_chunk_hash TEXT NOT NULL,
  block_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  translated_markdown TEXT,
  translated_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, chunk_index)
);

CREATE INDEX translation_chunks_status_idx
  ON translation_chunks(job_id, status, chunk_index);
```

Rules:

- `source_hash`, `source_chunk_hash`, and `output_hash` use `sha256:<hex>`.
- `output_path` is store-relative, for example `memory/abc123/ja-JP/CONTENT.md`.
- `translated_markdown` is temporary and must be `NULL` after final commit and purge.
- Do not add any token, refresh token, credential, or raw Codex auth column.

## State transition table

### Job transitions

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
complete -> stale only when source_hash no longer matches current CONTENT.md
```

### Chunk transitions

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

Rules:

- `complete` job status is allowed only after final file rename, output hash verification, metadata update, and chunk purge.
- `purged` chunk status means `translated_markdown IS NULL` and `translated_hash IS NOT NULL`.
- Late Codex output for a canceled job must be ignored.

## API contracts

### Start or reuse translation

```http
POST /api/memories/:memory_id/translations
content-type: application/json

{
  "lang_code": "ja-JP"
}
```

Responses:

```json
{
  "status": "started",
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "source_hash": "sha256:...",
  "event_url": "/api/translation-jobs/018f.../events"
}
```

```json
{
  "status": "current",
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "source_hash": "sha256:...",
  "output_path": "memory/018f.../ja-JP/CONTENT.md"
}
```

Status codes:

- `202` for newly started async job
- `200` for current committed translation or already running job reuse
- `400` for invalid language code
- `404` for missing memory or source content
- `409` for Codex auth/setup required, stale running conflict, or cancellation conflict
- `500` for unexpected server failure

### Read committed translation metadata

```http
GET /api/memories/:memory_id/translations/:lang_code
```

Response:

```json
{
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "status": "current",
  "source_hash": "sha256:...",
  "output_hash": "sha256:...",
  "output_path": "memory/018f.../ja-JP/CONTENT.md",
  "completed_at": "2026-05-20T00:00:00.000Z"
}
```

### Read job status

```http
GET /api/translation-jobs/:job_id
```

Response:

```json
{
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "status": "running",
  "source_hash": "sha256:...",
  "chunk_count": 42,
  "completed_chunks": 13,
  "failed_chunks": 0,
  "retrying_chunks": 1,
  "output_path": null,
  "error": null
}
```

### Stream job events

```http
GET /api/translation-jobs/:job_id/events
accept: text/event-stream
```

SSE message:

```text
id: 000000000013
event: translation.chunk.completed
data: {"id":"000000000013","type":"translation.chunk.completed","job_id":"018f...","memory_id":"018f...","lang_code":"ja-JP","chunk_index":3,"timestamp":1710000000000,"data":{"translated_hash":"sha256:..."}}
```

Rules:

- Event ids are monotonic per job.
- Support `Last-Event-ID` if an in-memory or SQLite event buffer is implemented.
- If no replay buffer exists in MVP, reconnect returns current job state first, then new events.
- Send heartbeat comments every 15 seconds while the job is active.

### Cancel job

```http
POST /api/translation-jobs/:job_id/cancel
```

Response:

```json
{
  "job_id": "018f...",
  "status": "cancel_requested"
}
```

## Markdown block algorithm

1. Parse frontmatter separately. Frontmatter is metadata, not a translatable body block.
2. Scan Markdown line by line.
3. Treat fenced code blocks as one `code_fence` block from opening fence to closing fence.
4. Treat `$$` math blocks as one `math_block` block.
5. Treat contiguous HTML block lines as one `html_block` when they start with block-level tags or comments.
6. Treat ATX headings as `heading` blocks and update `sectionPath`.
7. Treat contiguous table lines as one `table` block.
8. Treat contiguous list lines, including indented continuation lines, as one `list` block.
9. Treat contiguous blockquote lines as one `blockquote` block.
10. Treat Markdown image lines, image-in-link lines, or figure HTML as `image_figure` blocks.
11. Treat likely caption lines immediately following image/figure as `caption` blocks.
12. Treat footnote definitions as `footnote` blocks.
13. Treat bibliography/reference entries under references-like headings as `bibliography_entry` blocks.
14. Treat other prose paragraphs containing inline code as `inline_code_paragraph`.
15. Treat other prose paragraphs as `paragraph`.
16. Use `unknown_raw` only when the scanner cannot classify without risking structural damage.

Block id rule:

```text
b000001, b000002, b000003, ... in source order after frontmatter removal
```

Chunking defaults:

```ts
export const DEFAULT_TRANSLATION_CHUNK_CONFIG = {
  maxRoughTokens: 2500,
  softRoughTokens: 1800,
  maxBlocks: 80,
  maxRetries: 3,
  minLengthRatio: 0.35,
  maxLengthRatio: 2.8,
} as const;
```

Chunking rule:

- Prefer section boundaries from heading path.
- Group adjacent small sections while under `softRoughTokens`.
- Split oversized sections by contiguous block groups under `maxRoughTokens`.
- Never split inside a block.
- If a single block exceeds `maxRoughTokens`, mark the chunk as oversized and let Codex validation/retry handle context errors; do not corrupt the block by slicing unless a later task defines block-specific splitting.

## Codex app-server contract

The backend Codex client owns all app-server communication.

```ts
export interface CodexAppServerClient {
  checkAuth(): Promise<CodexAuthStatus>;
  startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>;
  translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>;
  cancelTurn(turnId: string): Promise<void>;
}
```

Rules:

- Use app-server `turn/start` with `outputSchema` when available.
- Do not send full document unless the chunker produced one chunk.
- Do not let Codex write files.
- Do not expose app-server URL, token, or raw auth state to the browser.
- Deltas are progress only. Final output must come from completed item content and pass schema validation.
- Disable network/tool access for translation turns if app-server exposes such controls.

## Prompt output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["chunk_index", "blocks", "warnings"],
  "properties": {
    "chunk_index": { "type": "integer" },
    "blocks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "translated_markdown"],
        "properties": {
          "id": { "type": "string" },
          "translated_markdown": { "type": "string" }
        }
      }
    },
    "warnings": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Prompt requirements:

- State that source content is untrusted data.
- Wrap source chunk in delimiters.
- Translate natural-language prose only.
- Preserve Markdown, HTML tags/attributes, LaTeX/math, citations, footnotes, URLs, code fences, inline code, placeholders, identifiers, file paths, commands, and variables.
- Do not summarize.
- Do not omit.
- Do not add commentary.
- Return only schema-compliant JSON.

## Validation algorithm

Validate each completed chunk in this order:

1. JSON parses and matches output schema.
2. `chunk_index` equals requested chunk index.
3. Output block ids exactly equal input block ids in the same order.
4. No duplicate block ids.
5. Each `translated_markdown` is non-empty unless the source block is non-translatable media-only content.
6. Protected spans from each source block are present in the corresponding translated block.
7. Code fence delimiter count is unchanged for code-fence blocks.
8. Math delimiters are unchanged for math blocks.
9. HTML tag names and closing/opening balance are unchanged for HTML blocks.
10. Citation markers and footnote markers are preserved.
11. URLs and Markdown link destinations are preserved.
12. Output does not include obvious omission markers: `omitted`, `summary`, `summarized`, `省略`, `要約`, `...` when used as a standalone omission marker.
13. Total translated length is between configured `minLengthRatio` and `maxLengthRatio`, except for blocks classified as code, math, image, or raw HTML.

Retry behavior:

- Retry only the failed chunk.
- Increment `retry_count` before each retry attempt.
- On validation retry, include validation failures in the retry prompt.
- After `maxRetries`, mark chunk and job failed.

## Atomic commit and purge sequence

Use this exact sequence:

1. Re-read current source `CONTENT.md` hash.
2. If current source hash differs from job `source_hash`, mark job `stale` and stop.
3. Stitch validated chunks in block order.
4. Validate final full document.
5. Ensure `memory/<memory_id>/<lang_code>/` exists.
6. Write full Markdown to `memory/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp`.
7. Flush file contents.
8. Rename temp file to `memory/<memory_id>/<lang_code>/CONTENT.md`.
9. Flush parent directory if supported.
10. Compute `output_hash` from committed `CONTENT.md`.
11. In a SQLite transaction, set job `status = 'complete'`, `output_path`, `output_hash`, and `completed_at`.
12. In the same transaction or immediately following transaction, set completed chunks to `status = 'purged'`, `translated_markdown = NULL`, preserving `translated_hash`.
13. Emit `translation.job.completed` only after purge succeeds.

Crash recovery:

- If temp file exists and job is not complete, delete temp file on startup after confirming final `CONTENT.md` was not renamed.
- If final `CONTENT.md` exists and hash matches job output hash but chunks are not purged, run purge before reporting complete.
- If final `CONTENT.md` exists but job is not complete, compute hash and either complete+purge if all chunks were validated or mark failed for manual retry.

## Per-subtask report requirements

Every implementation subtask must report:

- Changed files
- New interfaces
- Assumptions
- Risks
- Required follow-up
- Verification commands and results, or explicit reason validation was skipped
