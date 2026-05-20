# 19.3 Translation job state machine

## Goal

Implement the Reader-owned Brilliant job and chunk lifecycle. This subtask creates orchestration state primitives but does not implement Markdown chunking, Codex transport, or reader UI.

## Files likely owned

- `src/server/translation/types.ts`
- `src/server/translation/current-translation.ts`
- `src/server/translation/source-loader.ts`
- `src/server/translation/job-state.ts`
- `src/server/translation/orchestrator.ts`
- `src/server/translation/job-runner.ts`
- `tests/server/translation/source-loader.test.ts`
- `tests/server/translation/job-state.test.ts`
- `tests/server/translation/orchestrator.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/04-api-and-sse.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Instruction alignment

Scope: Reader-owned job lifecycle, source freshness, idempotent job start, and local runner scheduling.

Inputs: SQLite repositories, settings language, source `CONTENT.md`, source hash, and runner recovery contract.

Outputs: job start orchestration, state transition guards, source snapshot loading, and recoverable runner scheduling.

Dependencies: 19.2 provides schema/repository methods; 19.4/19.5 plug into this later.

Parallelization notes: can run beside 19.4 after shared types are frozen; do not implement Codex transport or Markdown chunking here.

Implementation risks: blocking the POST route until full translation completes violates async pipeline requirements; failing to re-check source hash before commit risks stale output.

## Source loading contract

Load store-relative `memories/<memory_id>/CONTENT.md` under configured `storePath` and compute:

- `source_hash` as `sha256:<hex>`
- byte size
- rough token estimate
- source title from metadata when available
- source URL from SQLite metadata when available
- document type hint: `article`, `paper`, or `unknown`

Do not load translated files in this subtask.

Hashing rule:

- Hash the exact UTF-8 bytes read from source `CONTENT.md`.
- Do not normalize line endings.
- Do not trim bytes.
- Do not parse and reserialize Markdown before hashing.
- If the file cannot be decoded as UTF-8 for Markdown parsing, fail source loading before chunk creation.

## Job start contract

Start algorithm:

1. Validate `memory_id`.
2. Read `translation_target_lang_code` from SQLite settings.
3. If the request supplied `lang_code`, verify it matches the SQLite setting.
4. Reject with `translation_language_required` when no settings language exists.
5. Load source `CONTENT.md` and compute source metadata.
6. Look up a complete job for `(memory_id, settingsLangCode, source_hash)`.
7. Resolve the complete job through `resolveCurrentTranslation()` from `src/server/translation/current-translation.ts`, which checks output file existence and output hash under `storePath`.
8. If the complete job has an existing output path and the output file hash matches `translation_jobs.output_hash`, return current translation metadata.
9. If the complete job's output file is missing or hash-mismatched, call `repairUnavailableTranslation()` to mark that job `unavailable` before continuing.
10. If a compatible active job exists, return that running job.
11. Create a new `pending` job with `lang_code = settingsLangCode`.
12. Schedule the job on the local in-process Brilliant runner.
13. The runner emits `translation.job.started` after it claims the job and transitions `pending -> running`.

## Runner contract

Brilliant uses a local in-process runner for the MVP.

Rules:

- `POST /api/memories/:memory_id/translations` must not block until full translation finishes.
- The route creates or reuses a job, schedules it, and returns `202` or `200`.
- The runner processes one job at a time by default.
- Chunks inside a job are processed sequentially by default.
- Runner state is recoverable from SQLite rows.
- Before accepting a new job, recover interrupted `pending`, `running`, `stitching`, `committing`, and `cancel_requested` jobs.
- A recovered `pending` job is either scheduled when the source hash still matches or marked `stale` when the source changed before execution.
- A server restart may pause a job, but must not corrupt an existing completed translation.

## State transition contract

Use the exact job and chunk transition values from `contracts/02-types-state-and-settings.md`. Do not introduce aliases such as `success`, `completed`, or `in_progress`.

Rules:

- A job cannot become `complete` before atomic commit and chunk purge finish.
- A chunk cannot become `purged` unless `translated_markdown IS NULL` and `translated_hash` remains available.
- A complete job becomes `unavailable` only when its committed output file is missing or its file hash differs from `translation_jobs.output_hash`.
- `unavailable` is terminal history state. Runner recovery and scheduling must treat it like `failed`, `canceled`, and `stale`: it is not active, not resumed, and does not block a new job.
- Late Codex output for canceled jobs is ignored.
- Source hash is checked at job start and again before commit.
- `stale` is terminal for a job attempt and emits `translation.job.stale`, not `translation.job.failed`.

## Tests

Cover:

- source loader computes `sha256:<hex>`
- missing source content returns a typed missing-source error
- job start uses SQLite settings language when request body omits `lang_code`
- request language mismatch returns `translation_language_mismatch`
- missing settings language returns `translation_language_required`
- current completed job is reused
- completed job with mismatched `output_hash` is not returned as current
- completed job with missing or hash-mismatched output is marked unavailable and does not block a new job
- unavailable jobs are not scheduled or resumed by runner recovery
- active non-terminal job is reused
- active job reuse returns job metadata with `event_url`
- failed/canceled/stale job does not block a user retry job
- runner schedules a newly created pending job without blocking the request
- runner recovery schedules an interrupted pending job when the source hash still matches
- runner recovery marks an interrupted pending job stale when the source hash changed
- runner recovery handles interrupted active jobs
- stale source hash prevents commit
- stale source hash emits `translation.job.stale`
- invalid state transitions are rejected
- canceled jobs ignore late chunk output

## Verification

```sh
mise exec -- bun run test tests/server/translation/source-loader.test.ts
mise exec -- bun run test tests/server/translation/job-state.test.ts
mise exec -- bun run test tests/server/translation/orchestrator.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Job and chunk states are centralized in shared types.
- Job start is idempotent.
- Translation language comes from SQLite settings.
- Source freshness is enforced.
- Later chunking and Codex subtasks can plug into the orchestrator and runner without redefining state.
