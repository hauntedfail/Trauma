# PR #31 Latest Review Remediation

## Metadata

- PR: #31
- PR URL: https://github.com/hauntedfail/Trauma/pull/31
- Trigger: PR #31 review evaluation and fixes
- Run directory: `.eda/n31/001/001_pr31_latest_review`
- Repository worktree: `/private/tmp/trauma-task24-psychiatrist-ipaddr`
- Branch: `feat/psychiatrist`
- Base: `docs/task-24-psychiatrist-plan`
- Head SHA at discovery: `af30f763365d4eef2833402649ddd47991bab61a`
- Planning mode: `parent-subtasks`

## Mode Rationale

Parent+subtasks mode is required. The current unresolved review set contains
20 valid items across UI transcript projection, server turn-state persistence,
regenerate API contracts, SSE replay cleanup, safe process-event projection,
prompt/context safety, route error handling, and test hygiene. Several items
touch persistence, API compatibility, concurrency, data-loss, and security
boundaries, so they need durable adjudication and scoped Revy handoffs.

Implementation should run sequentially in the same clean PR worktree unless a
future parent explicitly creates isolated worktrees for parallel work. Do not
use the dirty main workspace at `/Users/vvx/projekt/www/trauma` for mutation.

## Shared Evidence And Requirements

- Workspace instructions: `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/INDEX.md`.
- Review policy: valid feedback with machine-checkable behavior needs tests or
  verification in this PR.
- Security boundary: no secrets, tokens, raw tool payloads, private local paths,
  or stack traces in user-visible output or persisted safe stream events.
- Task 24 contracts:
  - durable thread and stream history;
  - terminal turn transitions are absorbing;
  - regenerate retry metadata is unresolved action state, not history;
  - attach regenerate retry only when the failed regenerate turn is newer than
    the latest completed assistant answer for that pair;
  - do not infer completion from nonempty answer text;
  - process event persistence must use explicit safe projection before storage.
- Git safety: never force-push, rewrite remote history, delete/recreate remote
  refs, or stage unrelated user/other-agent changes.

## Review Inventory And Adjudication

All current unresolved non-outdated inline items and the CodeRabbit review-body
nitpick were checked against the code and Task 24 requirements. No item is
classified `not_valid` or `needs_clarification`.

| ID | URL | Path | Claim | Author/Requirement Intent | Current Behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| CR-01 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119867 | `src/components/reader/psychiatrist-transcript.ts` | canceled turn uses answer text as completion signal | Terminal state must drive transcript projection | partial answer on canceled first answer becomes completed | valid_must_fix |
| CR-02 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119869 | `src/server/psychiatrist/cancel-route.ts` | append failure can leave active registry stale | cancel terminal state must be absorbing | unregister happens after an awaited append | valid_must_fix |
| CR-03 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119873 | `src/server/psychiatrist/context.ts` | translated context failures map to generic 500 | missing context should use documented context_unavailable | translated branch lacks read/parse failure mapping | valid_must_fix |
| CR-04 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119875 | `src/server/psychiatrist/events-route.ts` | replay failure leaks live SSE subscription | stream setup failure must clean up resources | unsubscribe is not called on replay throw | valid_must_fix |
| CR-05 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119880 | `src/server/psychiatrist/message-route.ts` | stream append failure overrides safe error response | safe API error response must survive telemetry failure | catch path awaits append before returning formatted error | valid_must_fix |
| CR-06 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119881 | `src/server/psychiatrist/message-route.ts` | interrupted/canceled early return skips post-save recovery | persisted assistant answer should be completed/recoverable | early returns happen before persisted-response branch | valid_must_fix |
| CR-07 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119884 | `src/server/psychiatrist/prompt.ts` | raw section title in heading | untrusted article data must be fenced/sanitized | heading includes raw title | valid_must_fix |
| CR-08 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119885 | `src/server/psychiatrist/prompt.ts` | newest history pair can overflow budget | prompt history budget must be enforced | first oversized pair can be selected | valid_must_fix |
| CR-09 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119886 | `src/server/psychiatrist/regenerate-route.ts` | pair_not_found forks regenerate_unavailable contract | regenerate API should have one unavailable code | pair_not_found appears in multiple unavailable branches | valid_must_fix |
| CR-10 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119888 | `src/server/psychiatrist/regenerate-route.ts` | answer_retry post-save recovery emits wrong completed event | answer retries should complete as answer events | recovery catch emits regenerate.completed unconditionally | valid_must_fix |
| CR-11 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119890 | `src/server/psychiatrist/stream-store.ts` | non-process stream payloads are stored verbatim | persistence boundary must project all event types safely | only process.delta is redacted | valid_must_fix |
| CR-12 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119894 | `src/server/psychiatrist/thread-store.ts` | completion read-check-write outside lock | terminal transitions must be serialized | completion reads before mutation lock | valid_must_fix |
| CR-13 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119895 | `src/server/translation/codex-app-server.ts` | Windows/UNC paths are not detected | private local paths must not leak | path check only recognizes Unix-looking paths | valid_must_fix |
| CR-14 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119899 | `tests/server/psychiatrist/api-routes.test.ts` | waitFor should catch transient predicate errors | async polling helpers should be robust | thrown predicates abort immediately | valid_must_fix |
| CR-15 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408119903 | `tests/server/translation/codex-app-server.test.ts` | switch case declaration trips noSwitchDeclarations | tests must satisfy lint/typecheck | const is declared directly under case | valid_must_fix |
| CX-01 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121371 | `src/server/psychiatrist/thread-store.ts` | restart leaves pending rows dead | reader load should not show unreachable pending turns | load path preserves pending without active registry reconciliation | valid_must_fix |
| CX-02 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121373 | `src/server/translation/codex-app-server.ts` | safe process message is unbounded | safe process text must be bounded/normalized | raw message/summary/status can be returned whole | valid_must_fix |
| CX-03 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121376 | `src/components/reader/psychiatrist-transcript.ts` | duplicate of CR-01 | same terminal-state requirement | same as CR-01 | valid_must_fix_duplicate |
| CX-04 | https://github.com/hauntedfail/Trauma/pull/31#discussion_r3408121379 | `src/server/psychiatrist/thread-store.ts` | old regenerate approval prompt can resurrect | retry metadata only for latest unresolved failed regenerate | hydrate compares against original pair turn id only | valid_must_fix |
| CR-BODY-01 | https://github.com/hauntedfail/Trauma/pull/31#pullrequestreview-4491571868 | `e2e/reader.spec.ts` | duplicated SSE fixtures can drift | E2E fixtures should have one canonical frame source | fake EventSource and helper duplicate event frames | valid_should_fix |

## Subtasks

| Subtask | File | Scope | Depends On | Status |
| --- | --- | --- | --- | --- |
| 001 | `subtasks/001_ui_transcript_and_e2e_fixtures.md` | UI transcript canceled-state projection and E2E SSE fixture dedupe | none | completed |
| 002 | `subtasks/002_turn_state_and_regenerate_contracts.md` | thread-store terminal/retry/restart semantics and regenerate API completion contract | 001 optional | completed |
| 003 | `subtasks/003_process_event_safety.md` | SSE replay cleanup, safe stream persistence projection, process-message/path safety, translation test lint | none | completed |
| 004 | `subtasks/004_route_error_prompt_context_and_waitfor.md` | cancel/message/context route error behavior, prompt safety/budget, waitFor robustness | 002/003 may affect shared tests | completed |

## Integration Strategy

Group by behavioral contract, not by reviewer. CR-01 and CX-03 share one UI
fix. CR-09, CR-10, CR-12, CX-01, and CX-04 share turn-state/regenerate
persistence semantics and should not be split across independent workers.
CR-04, CR-11, CR-13, CX-02, and CR-15 share process/SSE safety and translation
adapter test coverage. Route and prompt items are kept together because they
share API-route tests and prompt/context contract coverage.

## Final Sweep Checklist

- Re-fetch unresolved non-outdated review threads after fixes and replies.
- Run targeted tests for each subtask, then typecheck and `git diff --check`.
- Prefer full project verification if targeted checks pass and time permits.
- Delegate staging/commit/push to Sawyer with exact intended files.
- Reply to every inline thread; reply to the review-body nitpick via trace PR
  comment if no inline thread exists.
- Resolve fixed inline threads after evidence-backed replies are posted.
- Add supported positive reactions to corresponding review comments when the
  API accepts them.
- Check PR status/checks before requesting re-review.
- Request re-review using the established PR convention if all valid items are
  fixed and no clarification blockers remain.
