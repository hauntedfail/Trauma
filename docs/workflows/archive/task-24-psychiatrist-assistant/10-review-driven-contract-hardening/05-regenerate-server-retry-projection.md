# 24.10.5 Regenerate Server Retry Projection

## Goal

Persist and reload web-source approval state for regenerate attempts. If a
Regenerate turn fails with `network_permission_required`, a browser reload must
still show the previous completed answer and the correct web-source approval
action for the same pair.

## Files Owned

- Modify: `src/server/psychiatrist/thread-store.ts`
- Modify: `src/server/psychiatrist/thread-route.ts`
- Modify: `src/server/psychiatrist/regenerate-route.ts`
- Modify: `src/server/psychiatrist/types.ts`
- Modify: `tests/server/psychiatrist/api-routes.test.ts`
- Modify: `tests/server/psychiatrist/thread-store.test.ts`

If client request types need new response fields, split the client type/update
work into a child workflow or execute it together with 24.10.6 after this
server contract is stable.

## Current Fragility

First-answer web-source failures are projected as failed pairs that can be
retried after reload. Regenerate web-source failures are different: the pair is
already completed, so reducing `PAIRS.jsonl` back to the previous completed row
can lose the fact that the latest regenerate turn is waiting for user web-source
approval.

A second failure mode is stale retry projection. A regenerate turn can fail
with `network_permission_required`, then a later approved regenerate can
successfully complete for the same pair. The old failed turn still exists in
`turns/` for auditability, but it is no longer an actionable retry. Hydration
must not attach retry metadata merely because a historical failed turn exists.

## Required Durable Contract

When a regenerate attempt reaches `network_permission_required`:

- keep the previous completed assistant response as the canonical pair answer;
- persist retry metadata tied to the regenerate `turn_id`;
- expose the pair on thread reload with a web-source approval action;
- expose enough mode information for the client to call regenerate approval,
  not first-answer send approval;
- keep `thread_id` and `pair_id` unchanged;
- do not overwrite `pairs/{pairId}/RESPONSE.md`;
- do not append an orphan assistant response.

Retry metadata is an unresolved action, not history. Hydration must apply these
rules:

- for a first-answer failed pair with no completed assistant answer, attach web
  retry metadata only when the failed turn is the current failed pair turn;
- for a completed pair with a regenerate web-source failure, attach web retry
  metadata only when the failed regenerate turn is newer than the latest
  completed assistant answer for that pair;
- after any later successful retry or regenerate completion, older failed
  network-permission turns become obsolete and must not reappear as retry
  metadata on reload;
- do not delete or rewrite old failed turn files just to clear the action;
  clearing is a deterministic hydration decision based on the latest completed
  pair state.

Recommended response shape:

```json
{
  "retry_action": "allow_web_sources",
  "retry_mode": "regenerate",
  "retry_turn_id": "019f..."
}
```

If implementation chooses a different shape, update this plan before coding and
make the shape explicit in server and client types.

## Required Tests

Add tests that fail on the current implementation:

- Completed pair returns normally before regenerate.
- Regenerate with denied web access records `network_permission_required`.
- Fresh `GET /api/psychiatrist-threads/:threadId` after reload returns the
  same completed answer plus `retry_action`, `retry_mode: "regenerate"`, and
  the regenerate `retry_turn_id`.
- Regenerate with denied web access followed by an approved successful
  regenerate returns the new completed answer on fresh reload with no
  `retry_action`, `retry_mode`, or `retry_turn_id` from the obsolete failed
  turn.
- Approving that retry calls the regenerate path for the same `pair_id` and
  writes a new completed response only after Codex completion.
- A first-answer web-source failure still projects as
  `retry_mode: "first_answer"` or the equivalent explicit mode.

## Implementation Notes

- Keep pair reduction canonical: completed answer remains visible.
- Store retry metadata in turn metadata or pair revision rows, but make reload
  deterministic. Do not depend on in-memory active-turn indexes.
- If comparing timestamps, use the canonical completed assistant timestamp from
  the reduced pair row and ISO turn failure/update timestamps from the same
  storage contract. Filter obsolete retry turns before selecting the newest
  actionable retry.
- Keep retry metadata safe. Do not store raw fetched bodies, raw app-server
  payloads, credentials, or absolute store paths.
- Preserve existing API compatibility where possible by keeping
  `retry_action: "allow_web_sources"` as the user-facing action.

## Verification

```bash
mise exec -- bun run test tests/server/psychiatrist/thread-store.test.ts
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts -t "web"
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts -t "Regenerate"
git diff --check
```
