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
- `contracts/07-atomic-commit-purge-recovery.md`

## Error taxonomy

Use typed errors for:

- auth required
- setup required
- app-server unavailable
- usage limit
- context overflow
- timeout
- stream disconnect
- validation failure
- stale source
- filesystem failure
- cancellation
- unknown failure

User-facing errors must not include tokens, raw prompts, credential paths, app-server secrets, or full source chunks.

## Cancellation contract

- `POST /api/translation-jobs/:job_id/cancel` marks the job `cancel_requested`.
- Scheduler stops starting new chunks.
- In-flight Codex turn is canceled if app-server supports cancellation.
- The orchestrator stores the latest in-flight Codex `turnId` from `turn.started` events.
- `cancelTurn(turnId)` is called only when an in-flight `turnId` is known.
- If app-server cannot cancel, late output is ignored.
- Canceled jobs do not commit final `CONTENT.md`.
- SSE emits `translation.job.canceled` when cancellation completes.

## Tests

Cover:

- cancel pending job
- cancel running job
- canceled job stops scheduling chunks
- known in-flight turn id triggers `cancelTurn(turnId)`
- missing in-flight turn id falls back to ignoring late output
- late chunk output is ignored
- canceled job never commits final file
- auth and usage errors surface actionable messages
- filesystem failure does not corrupt existing translation
- stream disconnect does not cancel job
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
