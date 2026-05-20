# 19.3 Translation job state machine

## Goal

Implement the Reader-owned Brilliant orchestration state machine for translation jobs and chunks.

## Scope

Implement job lifecycle, chunk lifecycle, stale-source checks, retry transitions, cancellation state, and event emission points. This subtask owns state, not Codex transport or Markdown parsing.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.2 repository methods
- Existing memory content loading APIs

## Outputs

- Create: `src/server/translation/types.ts`
- Create: `src/server/translation/source-loader.ts`
- Create: `src/server/translation/job-state.ts`
- Create: `src/server/translation/orchestrator.ts` with placeholders/interfaces for later Codex/chunker dependencies
- Test: `tests/server/translation/source-loader.test.ts`
- Test: `tests/server/translation/job-state.test.ts`
- Test: `tests/server/translation/orchestrator.test.ts`

## Dependencies

- 19.2 must provide persistence primitives.
- 19.4 must provide manifest/chunk data before full translation execution can run.

## Concrete lifecycle

Use the job and chunk transition tables from `00-execution-contracts.md` without adding synonyms.

Start job algorithm:

1. Validate `memory_id` and `lang_code`.
2. Load `memory/<memory_id>/CONTENT.md`.
3. Compute `source_hash`, byte size, rough token estimate, title, source URL, and document type hint.
4. Look up a `complete` job for `(memory_id, lang_code, source_hash)`.
5. If found and `output_path` exists, return `current`.
6. If a compatible non-terminal job exists, return the running job.
7. Create a new `pending` job.
8. Emit `translation.job.started`.
9. Let later tasks generate chunks and run Codex.

Commit guard algorithm:

1. Re-read source `CONTENT.md`.
2. Recompute `source_hash`.
3. If hash differs from job `source_hash`, mark job `stale` and stop before stitching/commit.

## Acceptance criteria

- `TranslationJobStatus`, `TranslationChunkStatus`, and event types are centralized in `types.ts`.
- Starting a job is idempotent for current translations and active jobs.
- Source freshness is checked at start and again before commit.
- Job completion is impossible before final file commit and purge.
- Retry count is per chunk.
- State changes emit the event types defined in `00-execution-contracts.md`.
- Late output for canceled jobs is ignored.

## Parallelization notes

Can run beside 19.5 and 19.8 after 19.2. This task owns the canonical state API; later workers must consume it instead of inventing state helpers.

## Implementation risks

- Marking `complete` before purge violates the storage contract.
- Missing idempotency can spawn duplicate Codex jobs for the same memory/language.
- Source freshness must be checked at commit time, not only at start.
