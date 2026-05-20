# 19.2 SQLite schema and migration design

## Goal

Add the concrete SQLite foundation for Brilliant without making SQLite the canonical store for completed translated content.

## Scope

Implement Drizzle schema, migration SQL, repository methods, and schema tests for `translation_jobs` and `translation_chunks` exactly as frozen in `00-execution-contracts.md`.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- Existing `src/server/db/schema.ts`
- Existing `src/server/db/repositories.ts`
- Existing migration naming and timestamp conventions under `drizzle/`

## Outputs

- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/repositories.ts` or create `src/server/db/translation-repositories.ts` if domain repositories are split
- Create: `drizzle/<next>_brilliant_translation_jobs.sql`
- Test: `tests/server/db/translation-schema.test.ts`
- Test: `tests/server/db/translation-repositories.test.ts`

## Dependencies

- 19.1 must freeze the execution contracts.

## Concrete schema

Implement the SQL shape from `00-execution-contracts.md`:

```sql
translation_jobs(job_id, memory_id, lang_code, source_hash, model, skill_version, chunker_version, status, chunk_count, output_path, output_hash, error, created_at, updated_at, completed_at)
translation_chunks(job_id, chunk_index, source_chunk_hash, block_ids_json, status, retry_count, translated_markdown, translated_hash, error, created_at, updated_at)
```

Indexes:

```sql
CREATE UNIQUE INDEX translation_jobs_current_idx ON translation_jobs(memory_id, lang_code, source_hash);
CREATE INDEX translation_jobs_memory_lang_idx ON translation_jobs(memory_id, lang_code, updated_at);
CREATE INDEX translation_chunks_status_idx ON translation_chunks(job_id, status, chunk_index);
```

## Required repository methods

Expose these methods or exact equivalents:

```ts
createTranslationJob(input): Promise<TranslationJobRecord>
getTranslationJob(jobId): Promise<TranslationJobRecord | null>
findCurrentTranslation(memoryId, langCode, sourceHash): Promise<TranslationJobRecord | null>
updateTranslationJobStatus(jobId, status, patch): Promise<void>
insertTranslationChunks(jobId, chunks): Promise<void>
getTranslationChunks(jobId): Promise<TranslationChunkRecord[]>
updateTranslationChunk(jobId, chunkIndex, patch): Promise<void>
purgeCompletedTranslationChunks(jobId): Promise<void>
countTranslationChunksByStatus(jobId): Promise<Record<TranslationChunkStatus, number>>
```

## Acceptance criteria

- Schema exactly supports the TypeScript contracts in `00-execution-contracts.md`.
- `memory_id` cascades on memory delete.
- `lang_code` validation rejects path traversal and unsupported values before repository write.
- `source_hash`, `source_chunk_hash`, and `output_hash` use `sha256:<hex>`.
- `output_path` is store-relative and never absolute.
- `translated_markdown` is nullable and documented as temporary.
- No credentials, tokens, auth files, or raw Codex state are stored.
- Repository tests prove unique current-translation lookup and chunk purge.

## Parallelization notes

Can run in parallel with 19.4 after 19.1. Do not run in parallel with 19.3 unless repository method names above are accepted unchanged.

## Implementation risks

- Adding a separate persistent translated body table violates the Brilliant storage model.
- Using absolute `output_path` makes backup/restore brittle.
- Letting status strings drift from `00-execution-contracts.md` will break orchestration and UI.
