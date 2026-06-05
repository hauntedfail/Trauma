# 24.10.6 Reader Transcript Regenerate Draft

## Goal

Keep the old completed answer canonical in the reader until a regenerate turn
successfully completes. Partial regenerate deltas are draft output, not the new
stored answer.

## Files Owned

- Modify: `src/components/reader/psychiatrist-transcript.ts`
- Modify: `src/components/reader/psychiatrist-types.ts`
- Modify: `src/components/reader/PsychiatristDock.tsx` only if rendering needs
  an explicit draft field.
- Modify: `tests/components/psychiatrist-dock.test.tsx`

If server response types change in 24.10.5, update client request/response
types in that workflow first or split this client workflow into type and
reducer children.

## Current Fragility

The reducer replaces the visible answer on the first regenerate delta. If the
regenerate turn later fails, stops, loses network permission, or disconnects,
the UI can leave partial draft text as if it were the completed answer.

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

## Implementation Notes

- Do not infer completion from `pair.answer !== ""` while a regenerate turn is
  active.
- Key draft state by `pair_id` and regenerate `turn_id` to avoid stale deltas.
- Ignore deltas for unknown or stale regenerate turn ids.
- Keep keyboard/focus behavior unchanged.

## Verification

```bash
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx -t "regenerate"
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx -t "web"
git diff --check
```
