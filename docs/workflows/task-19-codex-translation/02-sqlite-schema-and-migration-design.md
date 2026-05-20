# 19.2 SQLite schema and migration design

## Goal

Create the database foundation for Brilliant translation jobs, temporary chunk state, and SQLite-backed target-language settings. This subtask does not implement Codex calls, route handlers, or UI.

## Files likely owned

- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- optional `src/server/db/translation-repositories.ts`
- optional `src/server/settings/translation-language.ts`
- `tests/server/db/translation-schema.test.ts`
- `tests/server/db/translation-repositories.test.ts`
- `tests/server/settings/translation-language.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Data model contract

Add `translation_jobs` and `translation_chunks` using the SQL shape in `contracts/03-sqlite-and-repositories.md`.

Rules:

- `translation_jobs.memory_id` references `memories.id` with `ON DELETE CASCADE`.
- Complete jobs use a partial unique index on `(memory_id, lang_code, source_hash)` where `status = 'complete'`.
- Active jobs use a partial unique index on `(memory_id, lang_code, source_hash)` where status is one of `pending`, `running`, `cancel_requested`, `stitching`, or `committing`.
- Failed, canceled, and stale jobs do not block a new retry job for the same source hash.
- `translation_chunks` uses `(job_id, chunk_index)` as primary key.
- `translated_markdown` is nullable and temporary.
- `output_path` is store-relative.
- Hash values use `sha256:<hex>`.
- No table stores Codex credentials, ChatGPT tokens, app-server tokens, refresh tokens, or raw auth files.

## Settings language contract

Persist the `/settings` translation target language in SQLite. Use the existing settings table if Task 18 already introduced one. If no focused settings service exists, add `src/server/settings/translation-language.ts`.

Rules:

- The persisted value is a supported BCP 47 code.
- Japanese is `ja-JP`.
- Frontend component state is not canonical.
- Translation jobs copy the current persisted value into `translation_jobs.lang_code` at job creation.
- Existing jobs keep their copied `lang_code` if the user changes settings later.

## Repository contract

Expose focused methods or exact equivalents:

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

Repository rules:

- Language validation occurs before writes that can affect paths.
- Missing jobs and chunks are reported explicitly.
- Purge sets completed chunk `translated_markdown` to `NULL` and status to `purged`.
- Repository methods do not perform Codex app-server calls.

## Tests

Cover:

- migration creates `translation_jobs` and `translation_chunks`
- memory delete cascades translation job and chunk rows
- duplicate complete `(memory_id, lang_code, source_hash)` is rejected or returned idempotently according to repository contract
- duplicate active `(memory_id, lang_code, source_hash)` is rejected or returned idempotently according to repository contract
- failed/canceled/stale jobs do not block a new retry job for the same `(memory_id, lang_code, source_hash)`
- `output_path` stores a relative path
- `translated_markdown` can be nulled while `translated_hash` remains
- purge converts complete chunks to purged chunks with `translated_markdown = NULL`
- settings language persists `ja-JP`
- unsupported and traversal-like language values are rejected
- no schema column stores credential material

## Verification

```sh
mise exec -- bun run test tests/server/db/translation-schema.test.ts
mise exec -- bun run test tests/server/db/translation-repositories.test.ts
mise exec -- bun run test tests/server/settings/translation-language.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Database schema supports all later Brilliant subtasks.
- Settings language is server-side SQLite state.
- Completed translated article bodies cannot become permanently stored in SQLite.
- No Codex credential material is stored.
- No API or UI behaviour is introduced here.
