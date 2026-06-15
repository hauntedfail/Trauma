# Subtask 001: UI Transcript And E2E Fixtures

Parent: `.eda/n31/001/001_pr31_latest_review/parent-exec-plan.md`

## Assigned Review Items

- CR-01: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119867
- CX-03: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121376
- CR-BODY-01: https://github.com/hauntedfail/Trauma/pull/31#pullrequestreview-4491571868

## Scope

Allowed files/modules:

- `src/components/reader/psychiatrist-transcript.ts`
- component tests for psychiatrist transcript/dock behavior
- `e2e/reader.spec.ts` and local E2E test helpers in that file

Out of scope:

- server turn-store or API-route implementation
- stream-store persistence projection
- unrelated UI refactors

## Expected Behavior

- A canceled first-answer turn with partial assistant delta must render as
  canceled, not completed.
- Existing completed answers should remain completed when a later regenerate
  retry is canceled or fails; use terminal pair/turn state, not nonempty answer
  text, as the completion signal.
- The E2E fake EventSource fixture should have one canonical source of event
  frames instead of two manually duplicated copies.

## Evidence And Tests

- Task 24.10.6 says not to infer completion from `pair.answer !== ""`.
- Add or update a focused component test proving the canceled partial-delta
  case and, if possible, regenerate cancellation preserving the old completed
  answer.
- Keep E2E behavior unchanged while removing duplicated fixture definitions.

## Required Verification

- `mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx`
- If E2E fixture behavior is materially changed, run the focused reader E2E
  test or document why it was not practical.

## Revy Handoff Notes

Implement only this subtask. Compare the diff against the parent plan before
reporting completion. Preserve unrelated user changes and never force-push.
