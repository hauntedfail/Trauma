# 24.10.6 Reader Transcript Regenerate Draft

## Goal

Keep the old completed answer canonical in the reader until a regenerate turn
successfully completes. Partial regenerate deltas are draft output, not the new
stored answer.

## Files Owned

- Modify: `src/components/reader/psychiatrist-transcript.ts`
- Modify: `src/components/reader/psychiatrist-types.ts`
- Modify: `src/components/reader/PsychiatristDock.tsx`
- Modify: `tests/components/psychiatrist-dock.test.tsx`

If server response types change in 24.10.5, update client request/response
types in that workflow first or split this client workflow into type and
reducer children.

## Current Fragility

The reducer replaces the visible answer on the first regenerate delta. If the
regenerate turn later fails, stops, loses network permission, or disconnects,
the UI can leave partial draft text as if it were the completed answer.

Reload has a separate fragility. Server hydration can correctly return a
completed pair with `retry_action: "allow_web_sources"` after a regenerate
network-permission failure, because the old completed answer remains canonical
while the regenerate action is unresolved. The reader must not discard that
action just because the pair status is `completed`; retry action presence is
the server-owned signal.

## Required UI State Contract

For each transcript pair:

- `answer` is the latest completed canonical answer from storage or a completed
  live turn.
- regenerate deltas are held as draft state until the regenerate turn emits a
  successful completed event;
- failed, stopped, canceled, network-required, or disconnected regenerate turns
  clear or hide draft state and keep `answer` unchanged;
- completed regenerate replaces `answer` with the final completed text and
  clears draft state;
- reload from server state must produce the same visible answer as the live
  reducer path.

The UI may display draft text while regenerate is running, but it must be
visually and semantically distinct from the completed answer. If the existing
layout cannot represent that cleanly, do not display draft text.

## Required Persisted Retry UI Contract

When loading persisted transcript pairs from the server:

- parse and preserve `retry_action`, `retry_mode`, and `retry_turn_id` in client
  response types and transcript mapping;
- if a pair has `retry_action: "allow_web_sources"`, restore the web-source
  approval CTA even when the pair status is `completed`;
- use `retry_mode: "regenerate"` to approve through the regenerate route for the
  same `pair_id` with one-turn web-source permission;
- keep first-answer retry approval behavior unchanged for failed pairs;
- when the server omits retry metadata, do not keep stale client retry UI from a
  prior live or reloaded state.

The frontend must not decide whether a historical failed regenerate turn is
obsolete. That decision belongs to server hydration in 24.10.5. The frontend
only renders actionable retry metadata that the current server response or live
event stream provides.

## Required Tests

Add reducer/component tests that fail on the current behavior:

- A completed answer receives regenerate started plus one delta, then failed:
  the old answer remains visible and the draft is gone.
- A completed answer receives regenerate started plus one delta, then
  `network_permission_required`: the old answer remains visible and the web
  approval control is shown for the pair.
- A completed answer receives regenerate started plus one delta, then stopped:
  the old answer remains visible and Regenerate can be pressed again.
- A completed answer receives regenerate started, deltas, then completed: the
  new answer replaces the old answer.
- Fresh server reload after failed/stopped/network-required regenerate matches
  the live reducer state.
- Fresh server reload with a completed pair plus
  `retry_action: "allow_web_sources"` and `retry_mode: "regenerate"` restores
  the web-source approval CTA and clicking it calls the regenerate approval path
  for the existing pair.
- Fresh server reload without retry metadata shows no web-source approval CTA,
  including after a previous failed regenerate was later successfully approved.

## Implementation Notes

- Do not infer completion from `pair.answer !== ""` while a regenerate turn is
  active.
- Key draft state by `pair_id` and regenerate `turn_id` to avoid stale deltas.
- Ignore deltas for unknown or stale regenerate turn ids.
- Do not limit persisted web-source retry discovery to
  `pair.status === "failed"`; completed pairs can carry an unresolved
  regenerate retry.
- Prefer behavior-level component tests over source-string assertions for the
  persisted retry discovery path.
- Keep keyboard/focus behavior unchanged.

## Verification

```bash
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx -t "regenerate"
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx -t "web"
git diff --check
```
