# 19.15 Error handling and cancellation

## Goal

Define consistent failure, retry, cancellation, and recovery behavior across backend, frontend, SQLite, and Codex app-server boundaries.

## Scope

Implement typed error categories, user-facing messages, cancellation endpoint behavior, job state transitions, stream termination, and recovery for interrupted jobs.

## Inputs

- 19.3 state machine
- 19.5 app-server typed errors
- 19.7 SSE stream behavior
- 19.9 validation/retry policy
- 19.10 atomic commit boundaries

## Outputs

- Error taxonomy for auth failure, setup required, app-server unavailable, usage limit, context overflow, timeout, stream disconnect, validation failure, stale source, filesystem failure, and cancellation.
- `POST /api/translation-jobs/:job_id/cancel` behavior.
- Frontend-safe error payloads.

## Dependencies

- 19.3, 19.5, 19.7, and 19.9 must define their local failure surfaces first.

## Acceptance criteria

- Cancellation marks the job cancel-requested or canceled in Reader state.
- Cancellation stops scheduling new chunks.
- In-flight Codex work is aborted if app-server supports it; otherwise its output is ignored after cancellation.
- Canceled jobs do not commit final `CONTENT.md`.
- Failed jobs do not corrupt existing completed translations.
- Usage-limit and auth failures stop the job with actionable setup guidance.
- Validation failures retry at chunk level before failing the job.
- Stream disconnect does not necessarily cancel the backend job.
- User-facing errors do not include tokens, raw prompts, secret paths, or raw credential details.

## Parallelization notes

This should run after core backend interfaces exist. It can run beside frontend work if error payload shapes are frozen early.

## Implementation risks

- WebSocket is not required for MVP cancellation; overbuilding it would increase surface area.
- Aborting in-flight app-server turns may not be supported; the backend must be able to ignore late output safely.
- Error messages must be actionable without leaking sensitive details.
