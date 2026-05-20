# 19.15 Error handling and cancellation

## Goal

Define consistent failure, retry, cancellation, and recovery behaviour across Brilliant backend, frontend, SQLite, and Codex app-server boundaries.

## Files likely owned

- `src/server/translation/types.ts`
- `src/server/translation/job-state.ts`
- `src/server/translation/codex-app-server.ts`
- `src/server/translation/orchestrator.ts`
- route file implementing `POST /api/translation-jobs/:job_id/cancel`, following existing `src/routes/api/` conventions
- `tests/server/routes/api-translation-jobs.test.ts`
- `tests/server/translation/orchestrator.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/04-api-and-sse.md`
- `contracts/06-codex-prompt-and-validation.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Instruction alignment

Scope: typed errors, user-actionable failures, cancellation endpoint, and late-output safety.

Inputs: job state, app-server typed errors, in-flight `threadId`/`turnId`, filesystem failures, and SSE terminal events.

Outputs: cancellation state transitions, `turn/interrupt` usage, failure payload rules, and no-corruption guarantees.

Dependencies: 19.3 defines states, 19.5 defines cancellation primitive, and 19.7 defines terminal events.

Parallelization notes: can run after app-server and state contracts are frozen; do not change prompt or chunking logic here.

Implementation risks: committing canceled output, leaking prompts/secrets in errors, or canceling without known ids breaks safety requirements.

## Error taxonomy

Use typed errors for:

- auth required
- setup required
- app-server unavailable
- usage limit
- context overflow
- timeout
- stream disconnect
- invalid final output
- validation failure
- stale source
- unavailable translation output
- filesystem failure
- cancellation
- unknown failure

User-facing errors must not include tokens, raw prompts, credential paths, app-server secrets, or full source chunks.

API error responses use the shared shape from `contracts/04-api-and-sse.md`. The stable frontend branch key is `code`, not free-form `message`.

Auth/setup failures during translation start are precondition failures. `POST
/api/memories/:memory_id/translations` returns `409 auth_required` or `409
setup_required` and does not create a `translation_jobs` row when Codex cannot
run authenticated translation work. This precondition check happens only after
the backend has ruled out a current committed translation and compatible active
job reuse. If Codex auth/setup is lost after a job row has been created, the
job records a normal execution failure with `auth_required` or `setup_required`.
Reused active jobs must not remain indefinitely running after auth loss; runner
recovery or the next execution tick marks them failed with the same safe code.

SSE failure events use the same stable error shape. `translation.job.failed`
emits `{ error }`; `translation.chunk.failed` emits `{ error, retry_count,
will_retry }`. Error payloads must not include raw prompts, source chunks,
tokens, credential paths, app-server URLs, or raw app-server payloads.

Codex transport failures map to stable API/job error codes:

- `timeout` remains `timeout` and maps to HTTP `504` when returned from an API request.
- `stream_disconnected` remains `stream_disconnected` and maps to HTTP `503` when returned from an API request.
- `invalid_final_output` remains `invalid_final_output` and maps to HTTP `502` when returned from an API request.
- Do not collapse `timeout`, `stream_disconnected`, or `invalid_final_output` into `unknown`, `app_server_unavailable`, or `validation_failed`.

Validation error boundary:

- Use `invalid_final_output` only for JSON parse failure or `CodexChunkOutput`
  schema mismatch after all configured output-mode fallbacks are exhausted.
- Use `validation_failed` for schema-valid output that fails semantic checks.
- Persist job and chunk errors as structured `TranslationPersistedError` JSON,
  never raw exception text.

Stale source is not reported as a generic failed job. When a pending or running job becomes stale because the source hash changed, emit `translation.job.stale` with safe hash metadata and close the stream.

Unavailable translation output is not reported as current. If a previously
complete job loses its output file or its output hash no longer matches, mark it
`unavailable`, return `translation_unavailable` where an API error is needed,
and allow a fresh translation for the same `(memory_id, lang_code, source_hash)`.

## Cancellation contract

- `POST /api/translation-jobs/:job_id/cancel` marks the job `cancel_requested`.
- Cancellation is accepted for `pending` and `running` jobs.
- Cancellation is idempotent for `cancel_requested` and `canceled` jobs.
- Cancellation returns `409 cancellation_conflict` for `stitching`, `committing`, `complete`, `stale`, `failed`, and `unavailable` jobs.
- Scheduler stops starting new chunks.
- In-flight Codex turn is canceled if app-server supports cancellation.
- The orchestrator stores the latest in-flight Codex `threadId` and `turnId` from app-server events.
- `cancelTurn({ threadId, turnId })` sends app-server `turn/interrupt`.
- `cancelTurn()` is called only when both an in-flight `threadId` and `turnId` are known.
- In-flight `threadId` and `turnId` are stored only in the in-process runner registry for Brilliant MVP. Do not add SQLite columns for them.
- After process restart, a `cancel_requested` job without registry ids is non-resumable and is finalized as `canceled`; late output is ignored.
- If app-server cannot cancel, late output is ignored.
- Canceled jobs do not commit final `CONTENT.md`.
- SSE emits `translation.job.canceled` when cancellation completes.

## Tests

Cover:

- cancel pending job
- cancel running job
- cancel already requested or canceled job is idempotent
- cancel non-cancelable job returns `cancellation_conflict`
- canceled job stops scheduling chunks
- known in-flight thread id and turn id trigger `turn/interrupt`
- missing in-flight thread id or turn id falls back to ignoring late output
- in-flight thread id and turn id are not persisted in SQLite
- late chunk output is ignored
- canceled job never commits final file
- auth and usage errors surface actionable messages
- auth/setup precondition failures do not create job rows
- current committed translation reuse does not require Codex auth
- in-flight auth/setup loss after job creation is persisted as a safe job error
- reused active job with auth/setup loss transitions to failed instead of remaining indefinitely running
- timeout and stream-disconnected errors preserve their stable codes
- invalid-final-output errors preserve their stable code
- validation-failed errors are reserved for schema-valid semantic validation failures
- job and chunk errors persist as structured JSON, not raw strings
- filesystem failure does not corrupt existing translation
- unavailable completed output does not block a fresh translation
- stream disconnect does not cancel job
- stale source emits `translation.job.stale` rather than `translation.job.failed`
- error payloads contain no secrets
- SSE job/chunk failure payloads expose stable codes and safe messages only

## Verification

```sh
mise exec -- bun run test tests/server/routes/api-translation-jobs.test.ts
mise exec -- bun run test tests/server/translation/orchestrator.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Cancellation works without WebSocket.
- Failures are typed and user-actionable.
- Failed and canceled jobs do not corrupt committed translations.
