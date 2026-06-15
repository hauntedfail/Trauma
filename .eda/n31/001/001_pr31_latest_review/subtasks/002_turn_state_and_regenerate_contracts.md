# Subtask 002: Turn State And Regenerate Contracts

Parent: `.eda/n31/001/001_pr31_latest_review/parent-exec-plan.md`

## Assigned Review Items

- CR-09: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119886
- CR-10: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119888
- CR-12: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119894
- CX-01: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121371
- CX-04: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121379

## Scope

Allowed files/modules:

- `src/server/psychiatrist/thread-store.ts`
- `src/server/psychiatrist/regenerate-route.ts`
- psychiatrist thread/route tests needed for these contracts
- thread response/load route code only if active-registry reconciliation cannot
  be correctly placed inside thread-store alone

Out of scope:

- UI rendering changes except tests that consume server shape
- process-event projection and translation adapter safety
- unrelated regenerate UX copy

## Expected Behavior

- `markPsychiatristTurnCompleted` must perform its read-check-write under the
  per-thread mutation lock so later completion cannot overwrite an already
  terminal canceled/failed state.
- Opening/loading a thread after server restart must not leave pending/running
  rows in an unreachable state when the active turn registry has no matching
  active turn. Reconcile those rows to a safe terminal interrupted/failed state
  before presenting the reader response.
- Regenerate unavailable cases, including missing pair, should use the
  documented `regenerate_unavailable` contract rather than introducing
  `pair_not_found` as a separate client code.
- The post-save recovery branch for `answer_retry` must emit
  `psychiatrist.answer.completed`; regenerate retry/retry-regenerate paths may
  emit `psychiatrist.regenerate.completed` where already intended.
- Hydrated retry metadata must only expose the latest unresolved failed
  regenerate turn for a pair, and only when it is newer than the latest
  completed assistant answer for that pair. Old failed regenerate prompts must
  not reappear after a later terminal regenerate attempt.

## Evidence And Tests

- Task 24.10.4: terminal transitions are absorbing.
- Task 24.10.5: regenerate retry metadata is unresolved action state and must
  only be attached for the latest failed regenerate turn newer than completion.
- Add focused tests for terminal completion races, restart/orphan pending
  reconciliation, missing-pair regenerate contract, answer_retry recovery event
  type, and stale retry prompt filtering.

## Required Verification

- `mise exec -- bun run test tests/server/psychiatrist/thread-store.test.ts`
- `mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts`

## Revy Handoff Notes

This subtask owns shared turn-state invariants. Keep the implementation
centralized and avoid duplicating terminal-state logic in route handlers unless
thread-store lacks the active-registry information needed for restart
reconciliation. Preserve unrelated changes and never force-push.
