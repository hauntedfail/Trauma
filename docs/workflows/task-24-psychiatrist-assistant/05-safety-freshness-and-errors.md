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
- Cancellation updates `turns/{turnId}.json` and appends no assistant answer to
  `MESSAGES.jsonl`.
- Closing the UI panel does not cancel a running turn.
- Route unmount closes the browser `EventSource`.
- A missing thread emits `thread_not_found` and the UI creates a new thread.

Safe UI errors:

- `auth_required` points to Codex auth setup.
- `setup_required` says Codex app-server must be available.
- `usage_limit`, `timeout`, and `stream_disconnected` are retryable.
- `context_overflow` tells the user the memory is too large for the current
  assistant context.
- Unknown errors use a generic message and log details server-side only.

## Tests

Add or extend tests for:

- Stale hash blocks Codex execution.
- Oversized user message returns `400 invalid_request`.
- Oversized memory uses deterministic section selection.
- Prompt-injection text remains inside untrusted section delimiters.
- Cancel route interrupts when thread and turn ids are known.
- UI refreshes a stale thread and preserves the unsent user prompt.
- Browser-visible errors omit Markdown, prompts, socket paths, absolute store
  paths, and credentials.
- User prompts remain persisted in `MESSAGES.jsonl` when the assistant turn
  fails after the prompt has been accepted.

Run:

```bash
mise exec -- bun run test tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/threads.test.ts tests/components/psychiatrist-dock.test.tsx
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Psychiatrist cannot be driven by instructions embedded in a memory.
- Stale content is never answered as if current.
- The UI gives recoverable failures without leaking backend details.
