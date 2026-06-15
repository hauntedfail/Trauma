# Subtask 003: Process Event Safety

Parent: `.eda/n31/001/001_pr31_latest_review/parent-exec-plan.md`

## Assigned Review Items

- CR-04: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119875
- CR-11: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119890
- CR-13: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119895
- CR-15: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119903
- CX-02: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121373

## Scope

Allowed files/modules:

- `src/server/psychiatrist/events-route.ts`
- `src/server/psychiatrist/stream-store.ts`
- `src/server/translation/codex-app-server.ts`
- tests for psychiatrist events/stream store and translation adapter safety

Out of scope:

- thread-store terminal state
- prompt/context changes
- unrelated translation runtime behavior

## Expected Behavior

- If live SSE subscription succeeds but replay loading fails, unsubscribe before
  returning/erroring the stream.
- Persisted psychiatrist stream events must pass through explicit per-type safe
  projection. Unknown or unsupported event shapes must not be stored verbatim.
- Process-event text must be normalized/bounded and must not expose tokens,
  absolute Unix paths, Windows drive paths, UNC paths, or raw large status
  messages.
- Translation adapter tests must satisfy switch-case declaration lint.

## Evidence And Tests

- Task 24.10.7 requires explicit safe projection before persistence and bounded
  visible process event text.
- Security boundary docs forbid leaking private local paths and credentials.
- Add tests for replay cleanup, unknown/raw stream event rejection or projection,
  bounded process text, and Windows/UNC path rejection.

## Required Verification

- `mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts`
- `mise exec -- bun run test tests/server/translation/codex-app-server.test.ts`

## Revy Handoff Notes

Keep safety helpers small and shared where useful, but avoid broad refactors.
Preserve current allowed user-visible process behavior after applying explicit
projection, truncation, and path/token rejection. Never force-push.
