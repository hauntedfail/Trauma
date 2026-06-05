# 24.10.3 Codex Turn Identity

## Goal

Require exact Codex app-server turn identity before accepting answer deltas,
process events, failures, or text completions for a Psychiatrist turn. Reused
threads must not accept stale notifications from a previous turn.

## Files Owned

- Modify: `src/server/translation/codex-app-server.ts`
- Modify: `tests/server/translation/codex-app-server.test.ts`

If the required change touches translation behavior outside the shared adapter,
split that behavior into a separate workflow before coding.

## Current Fragility

The adapter currently treats missing expected or actual turn ids as a match.
That allows a reused conversation thread to accept a text completion or delta
before the current `turn_id` is known. A stale notification can then settle the
wrong Psychiatrist turn.

## Required Contract

Implement an explicit state machine for turn notification matching:

| Adapter State | Acceptable Notification | Required Check |
| --- | --- | --- |
| waiting for start response | start response or started notification | records the current `turn_id` from the app-server response |
| turn id known | answer/process delta | notification `turn_id` equals the recorded `turn_id` |
| turn id known | completion/failure/cancel | notification `turn_id` equals the recorded `turn_id` |
| turn id unknown | completion/failure/cancel | reject or ignore; never settle the TRAUMA turn |
| any state | notification for another `turn_id` | ignore and continue waiting |

For a reused app-server thread, no answer text may be accepted until the current
turn id is known. Missing `turn_id` on terminal text completion is a protocol
error unless it is attached to the synchronous start response that also
establishes the current turn id.

## Required Tests

Add tests that fail on the current implementation:

- A reused thread receives a stale completion without the current `turn_id`
  before the current turn starts. The adapter must ignore it and return the
  current turn's answer.
- A reused thread receives answer deltas for a different `turn_id`; no TRAUMA
  process or answer events are emitted for those deltas.
- A terminal completion without any known `turn_id` fails safely instead of
  completing the TRAUMA turn.
- Translation tests still pass for the existing new-turn path.

Tests should assert both the returned answer and emitted stream/process events.
Do not only assert that the promise resolves.

## Implementation Notes

- Remove fallback matching that treats `undefined` as a wildcard.
- Keep app-server raw payloads out of thrown browser-facing errors.
- Preserve existing locked-down runtime defaults for Psychiatrist.
- Preserve Brilliant translation behavior by updating shared tests, not by
  adding Psychiatrist-only shortcuts.

## Verification

```bash
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts -t "Codex"
git diff --check
```
