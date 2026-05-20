# Brilliant SQLite and repository contract

## Tables

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
- `output_path` is store-relative, for example `memory/abc123/ja-JP/CONTENT.md`.
- `translated_markdown` is temporary and must be `NULL` after final commit and purge.
- Do not add token, refresh token, credential, or raw Codex auth columns.
- The user-selected target language is persisted in SQLite settings state, not frontend-only state.
- Translation jobs copy the currently configured settings language into `translation_jobs.lang_code` at job creation.
- Failed, canceled, and stale jobs remain as history and must not block a user retry for the same `(memory_id, lang_code, source_hash)`.
- At most one complete job and at most one active job may exist for the same `(memory_id, lang_code, source_hash)`.

## Required repository methods

Expose these methods or exact equivalents:

```ts
createTranslationJob(input): Promise<TranslationJobRecord>
getTranslationJob(jobId): Promise<TranslationJobRecord | null>
findCurrentTranslation(memoryId, langCode, sourceHash): Promise<TranslationJobRecord | null>
findActiveTranslationJob(memoryId, langCode, sourceHash): Promise<TranslationJobRecord | null>
updateTranslationJobStatus(jobId, status, patch): Promise<void>
insertTranslationChunks(jobId, chunks): Promise<void>
getTranslationChunks(jobId): Promise<TranslationChunkRecord[]>
updateTranslationChunk(jobId, chunkIndex, patch): Promise<void>
purgeCompletedTranslationChunks(jobId): Promise<void>
countTranslationChunksByStatus(jobId): Promise<Record<TranslationChunkStatus, number>>
getTranslationTargetLanguage(): Promise<string | null>
setTranslationTargetLanguage(langCode: string): Promise<void>
```

## Path constraints

- Source content remains `memory/<memory_id>/CONTENT.md`.
- Translated content is `memory/<memory_id>/<lang_code>/CONTENT.md`.
- `lang_code` must be validated before path resolution.
- Never store translated content outside the memory directory.
