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

Codex transport failures map to stable API/job error codes:

- `timeout` remains `timeout` and maps to HTTP `504` when returned from an API request.
- `stream_disconnected` remains `stream_disconnected` and maps to HTTP `503` when returned from an API request.
- `invalid_final_output` remains `invalid_final_output` and maps to HTTP `502` when returned from an API request.
- Do not collapse `timeout`, `stream_disconnected`, or `invalid_final_output` into `unknown`, `app_server_unavailable`, or `validation_failed`.

Stale source is not reported as a generic failed job. When a pending or running job becomes stale because the source hash changed, emit `translation.job.stale` with safe hash metadata and close the stream.

Unavailable translation output is not reported as current. If a previously
complete job loses its output file or its output hash no longer matches, mark it
`unavailable`, return `translation_unavailable` where an API error is needed,
and allow a fresh translation for the same `(memory_id, lang_code, source_hash)`.

## Cancellation contract

- `POST /api/translation-jobs/:job_id/cancel` marks the job `cancel_requested`.
- Scheduler stops starting new chunks.
- In-flight Codex turn is canceled if app-server supports cancellation.
- The orchestrator stores the latest in-flight Codex `threadId` and `turnId` from app-server events.
- `cancelTurn({ threadId, turnId })` sends app-server `turn/interrupt`.
- `cancelTurn()` is called only when both an in-flight `threadId` and `turnId` are known.
- If app-server cannot cancel, late output is ignored.
- Canceled jobs do not commit final `CONTENT.md`.
- SSE emits `translation.job.canceled` when cancellation completes.

## Tests

Cover:

- cancel pending job
- cancel running job
- canceled job stops scheduling chunks
- known in-flight thread id and turn id trigger `turn/interrupt`
- missing in-flight thread id or turn id falls back to ignoring late output
- late chunk output is ignored
- canceled job never commits final file
- auth and usage errors surface actionable messages
- timeout and stream-disconnected errors preserve their stable codes
- invalid-final-output errors preserve their stable code
- filesystem failure does not corrupt existing translation
- unavailable completed output does not block a fresh translation
- stream disconnect does not cancel job
- stale source emits `translation.job.stale` rather than `translation.job.failed`
- error payloads contain no secrets

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
