# Subtask 004: Route Error, Prompt, Context, And WaitFor

Parent: `.eda/n31/001/001_pr31_latest_review/parent-exec-plan.md`

## Assigned Review Items

- CR-02: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119869
- CR-03: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119873
- CR-05: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119880
- CR-06: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119881
- CR-07: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119884
- CR-08: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119885
- CR-14: https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119899

## Scope

Allowed files/modules:

- `src/server/psychiatrist/cancel-route.ts`
- `src/server/psychiatrist/context.ts`
- `src/server/psychiatrist/message-route.ts`
- `src/server/psychiatrist/prompt.ts`
- `tests/server/psychiatrist/api-routes.test.ts`
- prompt/context tests if present or appropriate

Out of scope:

- regenerate-route and thread-store contracts owned by subtask 002
- process-event safe projection owned by subtask 003
- unrelated prompt rewrites

## Expected Behavior

- Cancel route unregisters the active turn even when appending the cancel stream
  event fails.
- Translated context read/parse failures map to the same safe
  `context_unavailable` contract as source context failures.
- Message-route error handling returns the intended safe error response even if
  a best-effort stream event append fails.
- If an assistant response has already been persisted, interrupted/canceled
  errors should run the existing post-save recovery path before returning.
- Section titles interpolated into prompt headings should be escaped or
  normalized so untrusted article metadata cannot inject prompt instructions.
- Recent history selection must enforce the budget for the newest pair too; do
  not include a pair whose serialized representation exceeds the budget.
- The `waitFor` test helper should tolerate transient predicate throws until
  timeout.

## Evidence And Tests

- Task 24.10.6: completion must come from terminal state, not raw text.
- Security boundary docs require prompt and user-visible safety for untrusted
  imported content.
- Add focused tests for each route/prompt behavior where practical. At minimum,
  cover the regression cases called out in the review.

## Required Verification

- `mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts`
- Run prompt/context tests if files exist or were changed.

## Revy Handoff Notes

Prefer existing route/test patterns and best-effort telemetry handling. Do not
turn telemetry failures into user-facing API failures. Preserve unrelated
changes and never force-push.
