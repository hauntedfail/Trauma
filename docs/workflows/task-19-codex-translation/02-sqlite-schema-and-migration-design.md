# 19.2 SQLite schema and migration design

## Goal

Add minimal SQLite schema for translation jobs and chunks without making SQLite the canonical store for completed translated content.

## Scope

Design and implement Drizzle schema and migration for `translation_jobs` and `translation_chunks`, including indexes, constraints, and status values.

## Inputs

- Frozen contracts from 19.1
- Existing Drizzle schema and migration patterns
- Existing memory table and memory deletion semantics

## Outputs

- `translation_jobs` table or equivalent Drizzle schema object.
- `translation_chunks` table or equivalent Drizzle schema object.
- Migration SQL for the new tables and indexes.
- Repository methods for creating jobs, reading jobs, updating status, inserting chunks, updating chunks, and querying retryable failures.

## Dependencies

- 19.1 for status names and route/job identity contracts.

## Acceptance criteria

- `translation_jobs` includes `job_id`, `memory_id`, `lang_code`, `source_hash`, `model`, `skill_version`, `chunker_version`, `status`, `chunk_count`, `created_at`, `updated_at`, `completed_at`, `output_path`, `output_hash`, and `error` or equivalent fields.
- `translation_chunks` includes `job_id`, `chunk_index`, `source_chunk_hash`, `block_ids_json`, `status`, `retry_count`, `translated_markdown`, `translated_hash`, `error`, `created_at`, and `updated_at` or equivalent fields.
- `memory_id` references memories with cascade delete.
- `(memory_id, lang_code, source_hash)` or an equivalent lookup supports reuse/staleness checks.
- `(job_id, chunk_index)` is unique.
- `lang_code` accepts only supported BCP 47 values from the settings/language contract.
- `output_path` is relative to the configured store path.
- No table stores Codex credentials or ChatGPT tokens.
- Completed translated article bodies are not stored outside `translation_chunks.translated_markdown`, and that field is temporary.

## Parallelization notes

This can run in parallel with 19.4 after 19.1 freezes contracts. It should not run in parallel with 19.3 unless repository method names and status transitions are already agreed.

## Implementation risks

- A `memory_translations` table may duplicate `translation_jobs` unless its role is clearly limited to committed output metadata.
- Storing absolute paths makes backup/restore brittle; use store-relative paths.
- Adding a full-text translated body column outside chunk temp state violates the cleanup requirement.
