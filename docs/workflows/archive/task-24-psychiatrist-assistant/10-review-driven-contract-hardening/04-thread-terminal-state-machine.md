# 24.10.4 Thread Terminal State Machine

## Goal

Make terminal turn transitions deterministic in `thread-store.ts`. A turn must
settle once, and late Stop, completion, or failure events must not rewrite the
first terminal state or hide the user's last durable answer.

## Files Owned

- Modify: `src/server/psychiatrist/thread-store.ts`
- Modify: `tests/server/psychiatrist/thread-store.test.ts`
- Modify: `tests/server/psychiatrist/thread-store-locking.test.ts`
- Modify only if needed: `tests/server/psychiatrist/api-routes.test.ts`

If route handlers start carrying terminal precedence logic, split a route-level
workflow before coding. The canonical transition policy belongs in
`thread-store.ts`.

## Required State Contract

For one `turn_id`, terminal transitions are absorbing:

| Current Durable State | Incoming Completed | Incoming Failed | Incoming Canceled |
| --- | --- | --- | --- |
| pending/running/non-terminal | write completed | write failed | write canceled |
| completed | keep completed | keep completed | keep completed |
| failed | keep failed | keep failed | keep failed |
| canceled | keep canceled | keep canceled | keep canceled |

The helper that writes terminal metadata must return the resulting terminal
state so callers can decide whether to emit follow-up events. Callers must not
infer that their requested transition won.

## Required Race Rules

- If failure wins before Stop, Stop must not rewrite the turn as canceled.
- If Stop wins before failure, failure must not rewrite the turn as failed.
- If completion wins before Stop or failure, the completed response remains the
  durable state.
- Regenerate failure or Stop must not overwrite the previous completed
  `RESPONSE.md` for the pair.
- Pair reduction must load the previous completed assistant answer when a later
  regenerate attempt failed or was canceled.

## Required Tests

Add or rewrite tests so these cases fail first:

- `markPsychiatristTurnCanceled` preserves an already failed terminal state.
- `markPsychiatristRegenerateFailed` preserves an already canceled terminal
  state.
- A late completion cannot resurrect a failed or canceled turn.
- The locking test that currently expects Stop to overwrite failure must be
  changed to expect the first terminal state to win.
- Reloading a pair after failed/stopped Regenerate still returns the previous
  completed response.

## Implementation Notes

- Prefer one local helper in `thread-store.ts` for terminal-state reads and
  writes.
- Keep terminal metadata safe for browser projection; no raw app-server errors,
  prompts, or absolute store paths.
- Do not solve this by ordering awaits in route handlers. The invariant must
  hold when operations race.

## Verification

```bash
mise exec -- bun run test tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/thread-store-locking.test.ts
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts -t "Regenerate"
git diff --check
```
