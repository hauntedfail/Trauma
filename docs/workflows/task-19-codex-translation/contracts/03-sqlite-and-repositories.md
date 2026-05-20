# Brilliant SQLite and repository contract

## Tables

```sql
CREATE TABLE translation_jobs (
  job_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  lang_code TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT,
  prompt_policy_version TEXT NOT NULL,
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

CREATE UNIQUE INDEX translation_jobs_current_complete_idx
  ON translation_jobs(memory_id, lang_code, source_hash)
  WHERE status = 'complete';

CREATE UNIQUE INDEX translation_jobs_active_idx
  ON translation_jobs(memory_id, lang_code, source_hash)
  WHERE status IN ('pending', 'running', 'cancel_requested', 'stitching', 'committing');

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

## Rules

- `source_hash`, `source_chunk_hash`, and `output_hash` use `sha256:<hex>`.
- `output_path` is store-relative, for example `memories/abc123/ja-JP/CONTENT.md`.
- `reader_url` is derived from `memory_id` and `lang_code` as `/memories/<lang_code>/<memory_id>`; do not add a column unless implementation proves a durable need.
- `translation_jobs.error` stores either `NULL` or a JSON string matching `TranslationPersistedError` from `contracts/02-types-state-and-settings.md`.
- `translation_chunks.error` stores either `NULL` or a JSON string matching `TranslationPersistedError` from `contracts/02-types-state-and-settings.md`.
- Do not persist request-boundary API errors such as `translation_language_required`, `translation_language_mismatch`, `invalid_language`, `missing_memory`, `missing_source_content`, or `cancellation_conflict` in `translation_jobs.error` or `translation_chunks.error`.
- `auth_required` and `setup_required` are not persisted when they happen before job creation. They may be persisted only for an already-created job when Codex auth/setup is lost during app-server execution.
- `markTranslationUnavailable(jobId, reason)` stores `error` as JSON with `code = "translation_unavailable"`, `action = "start_fresh_translation"`, and `reason = "output_missing"` or `"output_hash_mismatch"`.
- `translated_markdown` is temporary and must be `NULL` after final commit and purge.
- Do not add token, refresh token, credential, or raw Codex auth columns.
- The user-selected target language is persisted in SQLite settings state, not frontend-only state.
- Translation jobs copy the currently configured settings language into `translation_jobs.lang_code` at job creation.
- Settings language writes must validate against `SUPPORTED_TRANSLATION_LANGUAGES` from the shared language contract.
- Failed, canceled, and stale jobs remain as history and must not block a user retry for the same `(memory_id, lang_code, source_hash)`.
- `unavailable` jobs are historical records for completed translations whose output file is missing or whose file hash no longer matches `output_hash`; they must not block a user retry for the same `(memory_id, lang_code, source_hash)`.
- At most one complete job and at most one active job may exist for the same `(memory_id, lang_code, source_hash)`.

## Required repository methods

Expose these methods or exact equivalents:

```ts
createTranslationJob(input): Promise<TranslationJobRecord>
getTranslationJob(jobId): Promise<TranslationJobRecord | null>
findCompleteTranslationRecord(memoryId, langCode, sourceHash): Promise<TranslationJobRecord | null>
findActiveTranslationJob(memoryId, langCode, sourceHash): Promise<TranslationJobRecord | null>
updateTranslationJobStatus(jobId, status, patch): Promise<void>
claimTranslationJob(jobId, expectedStatus: "pending"): Promise<boolean>
cancelPendingTranslationJob(jobId): Promise<boolean>
requestRunningTranslationJobCancellation(jobId): Promise<boolean>
markTranslationUnavailable(jobId, reason: "output_missing" | "output_hash_mismatch"): Promise<void>
insertTranslationChunks(jobId, chunks): Promise<void>
getTranslationChunks(jobId): Promise<TranslationChunkRecord[]>
updateTranslationChunk(jobId, chunkIndex, patch): Promise<void>
purgeCompletedTranslationChunks(jobId): Promise<void>
countTranslationChunksByStatus(jobId): Promise<Record<TranslationChunkStatus, number>>
getTranslationTargetLanguage(): Promise<string | null>
setTranslationTargetLanguage(langCode: string): Promise<void>
```

Progress aggregation rules:

- `completed_chunks` in public snapshots equals `complete + purged`.
- `failed_chunks` equals chunks with status `failed`.
- `retrying_chunks` equals chunks with status `retrying`.
- Raw per-status counts may still be returned by repository/internal methods for diagnostics, but frontend/API snapshot math must use the public aggregation above.

Runner claim rules:

- `claimTranslationJob()` is a compare-and-set transition used by the runner to atomically claim `pending -> running`.
- It returns `false` if another runner tick already claimed, canceled, failed, or otherwise changed the job.
- `cancelPendingTranslationJob()` is a compare-and-set transition used by the cancel API to atomically claim `pending -> canceled`.
- `requestRunningTranslationJobCancellation()` is a compare-and-set transition used by the cancel API to atomically claim `running -> cancel_requested`.
- If either cancellation compare-and-set returns `false`, the cancel API reloads the job and branches on the current status instead of assuming the previous state still holds.
- In-flight Codex `threadId` and `turnId` are not persisted in SQLite for Brilliant MVP. They live only in the local in-process runner registry.
- After restart, a `cancel_requested` job without in-memory ids is recovered as `canceled`.

Current-translation lookup rules:

- Repository methods remain SQLite-only. They do not read `storePath`, check file existence, compute output file hashes, or open `CONTENT.md`.
- `findCompleteTranslationRecord()` returns only the SQLite `status = 'complete'` row for `(memory_id, lang_code, source_hash)`.
- `src/server/translation/current-translation.ts` owns current-translation resolution and is the single shared boundary for storePath resolution, output file existence checks, output hash verification, unavailable repair, and `reader_url` derivation.
- It exposes a read-only resolver and an explicit repair helper:
  - `resolveCurrentTranslationReadOnly()` verifies current output and derives `reader_url` without mutating SQLite.
  - `repairUnavailableTranslation()` marks a known broken complete row `unavailable` after the caller has decided mutation is allowed.
- Job start, current translation metadata API, and job status/snapshot API may call `repairUnavailableTranslation()` because they are backend API boundaries that can return `translation_unavailable`, expose unavailable snapshots, or create a replacement job.
- Reader route loading and variant tab page-data must call `resolveCurrentTranslationReadOnly()` and must not mutate SQLite while rendering. If they detect missing or hash-mismatched output, they return not-found/unavailable UI state and leave repair to API/job-start recovery.
- The partial unique index on `status = 'complete'` remains valid because `unavailable` rows are not current and do not block replacement translations.

## Path constraints

- Source content remains store-relative `memories/<memory_id>/CONTENT.md` under configured `storePath`.
- Translated content is store-relative `memories/<memory_id>/<lang_code>/CONTENT.md` under configured `storePath`.
- Do not create a parallel singular `memory/` storage tree.
- `lang_code` must be validated before path resolution.
- Never store translated content outside the memory directory.
