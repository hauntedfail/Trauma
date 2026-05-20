# 19.3 Translation job state machine

## Goal

Implement the Reader-owned Brilliant job and chunk lifecycle. This subtask creates orchestration state primitives but does not implement Markdown chunking, Codex transport, or reader UI.

## Files likely owned

- `src/server/translation/types.ts`
- `src/server/translation/languages.ts`
- `src/server/translation/source-loader.ts`
- `src/server/translation/job-state.ts`
- `src/server/translation/orchestrator.ts`
- `tests/server/translation/source-loader.test.ts`
- `tests/server/translation/job-state.test.ts`
- `tests/server/translation/orchestrator.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/04-api-and-sse.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Source loading contract

Load `memory/<memory_id>/CONTENT.md` and compute:

- `source_hash` as `sha256:<hex>`
- byte size
- rough token estimate
- source title from metadata when available
- source URL from SQLite metadata when available
- document type hint: `article`, `paper`, or `unknown`

Do not load translated files in this subtask.

## Job start contract

Start algorithm:

1. Validate `memory_id`.
2. Read `translation_target_lang_code` from SQLite settings.
3. If the request supplied `lang_code`, verify it matches the SQLite setting.
4. Reject with `translation_language_required` when no settings language exists.
5. Load source `CONTENT.md` and compute source metadata.
6. Look up a complete job for `(memory_id, settingsLangCode, source_hash)`.
7. If the complete job has an existing output path, return current translation metadata.
8. If a compatible non-terminal job exists, return that running job.
9. Create a new `pending` job with `lang_code = settingsLangCode`.
10. Emit `translation.job.started`.

## State transition contract

Use the exact job and chunk transition values from `contracts/02-types-state-and-settings.md`. Do not introduce aliases such as `success`, `completed`, or `in_progress`.

Rules:

- A job cannot become `complete` before atomic commit and chunk purge finish.
- A chunk cannot become `purged` unless `translated_markdown IS NULL` and `translated_hash` remains available.
- Late Codex output for canceled jobs is ignored.
- Source hash is checked at job start and again before commit.

## Tests

Cover:

- source loader computes `sha256:<hex>`
- missing source content returns a typed missing-source error
- job start uses SQLite settings language when request body omits `lang_code`
- request language mismatch returns `translation_language_mismatch`
- missing settings language returns `translation_language_required`
- current completed job is reused
- active non-terminal job is reused
- stale source hash prevents commit
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
- Later chunking and Codex subtasks can plug into the orchestrator without redefining state.
