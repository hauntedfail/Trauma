# 24.5 Safety, Freshness, And Error Handling

## Goal

Harden Psychiatrist against stale memory context, prompt injection, unsafe
browser-visible errors, and turn lifecycle edge cases.

## Files Likely Owned

- Modify: `src/server/psychiatrist/context.ts`
- Modify: `src/server/psychiatrist/prompt.ts`
- Modify: `src/server/psychiatrist/thread-store.ts`
- Modify: `src/server/psychiatrist/threads.ts`
- Modify: `src/server/psychiatrist/message-route.ts`
- Modify: `src/components/reader/PsychiatristDock.tsx`
- Test: `tests/server/psychiatrist/context.test.ts`
- Test: `tests/server/psychiatrist/prompt.test.ts`
- Test: `tests/server/psychiatrist/thread-store.test.ts`
- Test: `tests/server/psychiatrist/threads.test.ts`
- Test: `tests/components/psychiatrist-dock.test.tsx`

## Required Behavior

Stale context:

- Recompute the active content hash before every turn.
- If the hash differs from the thread manifest hash, stop before calling Codex.
- Mark `THREAD.json` stale and emit or return `thread_stale` with action
  `refresh_thread`.
- The dock automatically creates or resumes a fresh thread and lets the user
  resend.

Prompt injection:

- Include memory Markdown only inside explicit untrusted delimiters.
- The prompt says source Markdown is data, not instructions.
- Tests include a memory body that asks the assistant to ignore TRAUMA policy,
  leak credentials, or write files. The expected prompt keeps that text inside
  the memory context section only.

Runtime boundary:

- Psychiatrist Codex app-server turns run without shell access, local file edit
  tools, local filesystem browsing, project-root access, or memory-store access.
- The prompt includes the same boundary, but the adapter test must also prove
  the app-server payload does not expose those capabilities.
- TRAUMA server code may write only `THREAD.json`, `PAIRS.jsonl`, and
  `turns/{turnId}.json` under the active memory thread directory.

Network boundary:

- Network is denied by default for every Psychiatrist turn.
- Web search/source lookup can be enabled only when the user explicitly approves
  it for the current turn or retry.
- If network is denied and current web sources are required, return
  `network_permission_required` without attempting network access.
- If network is approved, store safe source citation metadata on the pair and do
  not expose raw fetch payloads, credentials, or app-server transport details.

Streaming boundary:

- Persist only user-visible process/status events and answer deltas.
- Do not persist or display hidden chain-of-thought, raw app-server
  notifications, local paths, tokens, credential paths, or raw tool payloads.
- Store stream events before SSE fan-out so reload/navigation replay cannot
  miss already-emitted output.

Context bounds:

- Enforce `PSYCHIATRIST_MAX_USER_MESSAGE_CHARS = 4000`.
- Enforce `PSYCHIATRIST_MAX_CONTEXT_CHARS = 80000` for per-turn Codex input.
- If the full memory is larger than the per-turn bound, select sections by:
  title match, direct term match, then document order until the bound is full.
- Always include metadata and TOC even when Markdown sections are trimmed.
- If no section can fit with metadata, return `context_overflow`.

Turn lifecycle:

- A canceled turn calls app-server `turn/interrupt` when thread and turn ids are
  known.
- Cancellation updates `turns/{turnId}.json`, marks the pair `canceled`, and
  writes no `assistant_response`.
- The browser calls cancellation only for an explicit Stop click.
- Closing the UI panel does not cancel a running turn.
- Route unmount, memory navigation, and browser reload close the browser
  `EventSource` but do not cancel the server turn.
- Reopening the same memory resumes the latest thread and reconnects to
  `active_turn.event_url` when present.
- A missing thread emits `thread_not_found` and the UI creates a new thread.

Pair integrity:

- Every durable prompt/answer turn is stored as one pair in `PAIRS.jsonl`.
- A pending pair is created before Codex execution begins.
- Completed output can append only a completed revision for the matching pending
  pair.
- Failed, canceled, stale, and network-permission-required turns must not create
  orphan assistant responses.

Regenerate integrity:

- Regenerate is allowed only for a completed pair.
- Regenerate uses the stored prompt and stored context snapshot for that pair,
  not the current textarea value and not a new memory context.
- Regenerate keeps the same `thread_id` and `pair_id`; it creates only a new
  `turn_id`.
- Regenerate overwrites `pairs/{pairId}/RESPONSE.md` and rewrites `THREAD.md`
  for the existing thread. It must not create a new response Markdown file, new
  pair, or new thread.
- If Regenerate fails or is stopped, the previous completed response remains the
  visible completed response and the failed/stopped regenerate status is stored
  as pair/turn metadata.
- Completed Regenerate enqueues git backup with reason
  `psychiatrist_response_regenerate`.

Safe UI errors:

- `auth_required` points to Codex auth setup.
- `setup_required` says Codex app-server must be available.
- `usage_limit`, `timeout`, and `stream_disconnected` are retryable.
- `context_overflow` tells the user the memory is too large for the current
  assistant context.
- `network_permission_required` asks the user to allow web search/source lookup
  for this answer.
- `turn_stopped` records explicit user Stop.
- `regenerate_unavailable` says the response cannot be regenerated because the
  pair is no longer completed, no longer belongs to the active memory, or lacks
  stored prompt/context provenance.
- Unknown errors use a generic message and log details server-side only.

## Tests

Add or extend tests for:

- Stale hash blocks Codex execution.
- Oversized user message returns `400 invalid_request`.
- Oversized memory uses deterministic section selection.
- Prompt-injection text remains inside untrusted section delimiters.
- Cancel route interrupts when thread and turn ids are known.
- Cancel route is not called on panel close, route unmount, memory navigation,
  or browser reload.
- UI refreshes a stale thread and preserves the unsent user prompt.
- Browser-visible errors omit Markdown, prompts, socket paths, absolute store
  paths, and credentials.
- Stream replay persists safe process and answer events without exposing hidden
  chain-of-thought.
- User prompts remain persisted in `PAIRS.jsonl` when the assistant turn fails
  after the prompt has been accepted, with no `assistant_response`.
- Completed assistant output revision cannot be written unless a matching
  pending pair already exists.
- Default-denied network turns do not include network-enabled app-server fields
  or web-source metadata.
- User-approved network turns persist safe source citation metadata on the
  matching pair.
- Regenerate preserves `thread_id` and `pair_id`, uses stored prompt/context
  provenance, overwrites the existing response Markdown artifact, and enqueues
  backup with reason `psychiatrist_response_regenerate`.

Run:

```bash
mise exec -- bun run test tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/threads.test.ts tests/components/psychiatrist-dock.test.tsx
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Psychiatrist cannot be driven by instructions embedded in a memory.
- Stale content is never answered as if current.
- The UI gives recoverable failures without leaking backend details.
- Runtime and prompt policy both prohibit shell access, local file editing, and
  unapproved network access.
- Turns are not interrupted by browser lifecycle changes. Explicit Stop is the
  only user-driven interruption path.
- Regenerate is an overwrite of an existing pair response artifact, not a new
  conversation branch.
