# 24.8 Streaming Continuity, Stop, Regenerate, And Backup

## Goal

Persist the full user-visible Psychiatrist stream, keep running turns alive
across reader navigation and browser reload, expose explicit Stop, and support
same-pair Regenerate with git-backed Markdown overwrite.

## Files Likely Owned

- Modify: `src/server/backup/index.ts`
- Modify: `src/server/psychiatrist/events.ts`
- Modify: `src/server/psychiatrist/events-route.ts`
- Modify: `src/server/psychiatrist/message-route.ts`
- Modify: `src/server/psychiatrist/thread-store.ts`
- Modify: `src/server/psychiatrist/threads.ts`
- Create: `src/server/psychiatrist/stream-store.ts`
- Create: `src/server/psychiatrist/regenerate-route.ts`
- Create:
  `src/routes/api/memories/[memoryId]/psychiatrist/threads/[threadId]/pairs/[pairId]/regenerate.ts`
- Modify: `src/components/reader/PsychiatristDock.tsx`
- Modify: `src/components/reader/psychiatrist-requests.ts`
- Modify: `src/components/reader/psychiatrist-types.ts`
- Test: `tests/server/backup/git-backup.test.ts`
- Test: `tests/server/psychiatrist/events.test.ts`
- Test: `tests/server/psychiatrist/thread-store.test.ts`
- Test: `tests/server/psychiatrist/threads.test.ts`
- Test: `tests/server/psychiatrist/api-routes.test.ts`
- Test: `tests/components/psychiatrist-dock.test.tsx`
- E2E: `e2e/reader.spec.ts`

## Storage Additions

Add these artifacts under the existing memory-local thread directory:

```text
{storePath}/memories/{memoryId}/threads/{threadId}/THREAD.md
{storePath}/memories/{memoryId}/threads/{threadId}/pairs/{pairId}/PROMPT.md
{storePath}/memories/{memoryId}/threads/{threadId}/pairs/{pairId}/CONTEXT.json
{storePath}/memories/{memoryId}/threads/{threadId}/pairs/{pairId}/RESPONSE.md
{storePath}/memories/{memoryId}/threads/{threadId}/streams/{turnId}.jsonl
```

Rules:

- `streams/{turnId}.jsonl` is append-only and stores `event_id`, `event_name`,
  `pair_id`, `turn_id`, `created_at`, and a safe payload.
- Stream payloads may include answer deltas and visible process/status text.
- Stream payloads must not include hidden chain-of-thought, raw app-server
  notifications, local absolute paths, credentials, tokens, or raw fetched
  bodies.
- `THREAD.md` is rewritten from the latest pair state for readable backup and
  export. It is not canonical memory content.
- `pairs/{pairId}/RESPONSE.md` is the latest completed response Markdown for
  that pair.
- Regenerate overwrites `pairs/{pairId}/RESPONSE.md` and rewrites `THREAD.md`.
  It does not create a new pair, new thread, or new Markdown response path.
- `pairs/{pairId}/CONTEXT.json` stores enough prompt/context provenance to
  regenerate from the same context: memory variant, content hash, prompt policy
  version, selected section anchors, selected section hashes, selected Markdown
  text, and source URL. It must include the selected section Markdown payloads
  themselves: order, anchor, heading, normalized Markdown text, and hash for
  each selected section. If an implementation stores exact rendered prompt input
  instead of selected Markdown text, that input must be sufficient to
  reconstruct the original Codex input after memory edits. Regenerate tests must
  fail if the rebuilt prompt uses `sections: []` or blank title/source URL
  metadata.

## API And Event Contract

Thread create/read responses include:

```json
{
  "active_turn": {
    "pair_id": "019f...",
    "turn_id": "019f...",
    "status": "running",
    "event_url": "/api/memories/019e.../psychiatrist/threads/019f.../turns/019f.../events?variant_kind=translation&lang_code=ja-JP"
  }
}
```

The event route must:

- Resolve the memory/thread stream path directly and verify the active variant
  query before replay or reconciliation; it must not scan other memories.
- Replay stored `streams/{turnId}.jsonl` rows and hand off to live events with
  no gap. Implement this by subscribing before replay and de-duplicating by
  `event_id`, or by using an equivalent atomic cursor protocol that cannot miss
  events appended during replay.
- Support `Last-Event-ID` and `?after_event_id=...`.
- Close after replay when the turn is already terminal.
- Continue the server turn when a browser EventSource disconnects.

Regenerate route:

```http
POST /api/memories/:memoryId/psychiatrist/threads/:threadId/pairs/:pairId/regenerate
content-type: application/json

{
  "lang_code": "ja-JP",
  "memory_id": "019e...",
  "thread_id": "019f...",
  "variant_kind": "translation",
  "web_source_permission": "deny"
}
```

Rules:

- Reject non-completed pairs with `409 regenerate_unavailable`.
- Reject missing pairs, cross-memory pairs, and pairs lacking stored
  `PROMPT.md`/`CONTEXT.json` provenance.
- Reject cross-thread, cross-pair, and cross-variant requests. The route is
  scoped by active `memoryId`, `threadId`, `pairId`, and active variant
  identity; translated-reader requests must carry the active `lang_code`, while
  source-reader requests omit it.
- Do not reject solely because the current memory content changed after the
  original answer. Regenerate uses the stored prompt and stored context snapshot
  for the same pair.
- Load `PROMPT.md` and `CONTEXT.json` for the same `pair_id`.
- Rebuild the Regenerate prompt from `PROMPT.md` plus the section Markdown and
  metadata stored in `CONTEXT.json`. Do not reread current memory content to
  select new sections, and do not pass empty section arrays or blank source
  metadata to the prompt builder.
- Create a new `turn_id` for the regenerate attempt.
- Keep the existing `thread_id`, `pair_id`, and `RESPONSE.md` path.
- Stream through the normal event route.
- On completion, write or recoverably stage `RESPONSE.md` and `THREAD.md`
  before appending the canonical `regenerated_completed` pair revision, then
  append the terminal stream event and enqueue backup.
- On failure or Stop, append safe failed/stopped metadata for the new
  regenerate `turn_id` without overwriting `RESPONSE.md` and without changing
  the loaded pair's visible completed assistant response. Reloading the thread
  after that failed/stopped Regenerate must still show the previous completed
  answer.

## UI Contract

Running state:

- Submit becomes Stop while a turn is running.
- Stop is the only user action that calls the cancel route.
- Stop sends the active `memoryId`, `threadId`, `pairId`, `turnId`, and
  `langCode` when present. The cancel route validates those fields against the
  in-memory active-turn record and rejects cross-memory, cross-thread,
  cross-pair, cross-variant, stale, completed, failed, or already-canceled
  attempts before app-server interruption.
- Panel close, Escape, route navigation, memory switching, and browser reload do
  not call cancel.
- Returning to the same memory or reloading the page resumes the latest matching
  thread and reconnects to `active_turn.event_url`.
- The UI replays stored process and answer events, then continues live.
- Replay-to-live event handling de-duplicates by `event_id` so overlap from a
  subscribe-before-replay implementation does not duplicate visible rows.

Process stream rendering:

- Render safe process/status events in the active assistant response.
- Keep process text visually subordinate to answer text.
- Do not render hidden chain-of-thought or raw backend payloads.

Regenerate:

- Render a Regenerate button on each completed assistant response.
- Clicking Regenerate calls `regeneratePsychiatristResponse()` with the active
  `memoryId`, active `threadId`, existing `pairId`, and active `langCode` when
  present.
- The UI streams the regenerated answer into the same pair row.
- On first new answer delta, replace the visible previous answer for that pair.
- If Regenerate fails or is stopped, keep the previous completed answer visible
  and show the safe failure/stopped state.
- This rule must hold both in the live transcript reducer and after a fresh
  thread reload from storage. Component tests alone are not sufficient; server
  storage tests must cover the reload case.
- If Regenerate reaches `network_permission_required`, keep the previous
  completed answer visible and show a waiting-for-approval state for the same
  pair. Approval retries the same scoped regenerate route, not a new message or
  global pair route.

## Backup Contract

Extend backup reasons:

```ts
export const PSYCHIATRIST_BACKUP_REASONS = [
  "psychiatrist_thread_update",
  "psychiatrist_response_regenerate",
] as const;

export type PsychiatristBackupReason =
  (typeof PSYCHIATRIST_BACKUP_REASONS)[number];
```

Expected `{action}` text:

- `psychiatrist_thread_update` -> `updated psychiatrist thread`
- `psychiatrist_response_regenerate` -> `regenerated psychiatrist response`

Completed first answers enqueue:

```ts
await backupQueue.enqueue({
  contentPaths: [
    threadManifestRelativePath,
    threadMarkdownRelativePath,
    pairRevisionLogRelativePath,
    pairPromptRelativePath,
    pairContextRelativePath,
    pairResponseRelativePath,
    turnStatusRelativePath,
    turnStreamRelativePath,
  ],
  memoryId,
  reason: "psychiatrist_thread_update",
});
```

Completed Regenerate enqueues:

```ts
await backupQueue.enqueue({
  contentPaths: [
    threadManifestRelativePath,
    threadMarkdownRelativePath,
    pairRevisionLogRelativePath,
    pairPromptRelativePath,
    pairContextRelativePath,
    pairResponseRelativePath,
    turnStatusRelativePath,
    turnStreamRelativePath,
  ],
  memoryId,
  reason: "psychiatrist_response_regenerate",
});
```

The relative path variables above represent the durable thread artifacts needed
to restore the completed operation: `THREAD.json`, `THREAD.md`, `PAIRS.jsonl`,
`pairs/{pairId}/PROMPT.md`, `pairs/{pairId}/CONTEXT.json`,
`pairs/{pairId}/RESPONSE.md`, `turns/{turnId}.json`, and
`streams/{turnId}.jsonl` when a stream file was written for that turn.

Backup enqueue failure must return a safe warning and must not discard the
completed response. The existing backup failsafe UI remains responsible for
global backup alerts.
Tests must inject a backup queue failure and assert both outcomes: the
completed response remains in `RESPONSE.md`/`PAIRS.jsonl`, and the API or
terminal stream exposes a safe warning that contains no store path, prompt, or
raw app-server details.

## Tests

Server tests:

- Stream store appends started, process delta, answer delta, and completed
  events with increasing `event_id`.
- Event route replays stored events after browser reload.
- Event route resumes after `Last-Event-ID`.
- Event route has no replay-to-live gap and de-duplicates replay/live overlap by
  `event_id`.
- EventSource disconnect does not cancel the running turn.
- Cancel route is called only by explicit Stop and appends `turn_stopped`.
- Cancel route rejects mismatched memory, thread, pair, turn, or variant
  identity before app-server interruption.
- Hidden chain-of-thought and raw app-server payloads are filtered from process
  stream storage.
- Regenerate rejects missing, cross-memory, non-completed, and
  lacking-provenance pairs, but does not reject a completed pair solely because
  current memory content changed.
- Regenerate keeps `thread_id` and `pair_id`, creates a new `turn_id`, uses
  stored `PROMPT.md` and `CONTEXT.json`, and overwrites `RESPONSE.md`.
- Regenerate prompt reconstruction includes non-empty stored section Markdown
  and original source metadata from `CONTEXT.json`; the test must inspect the
  fake app-server input and fail if it contains an empty context.
- Regenerate route tests use the memory/thread/pair scoped path and reject
  cross-thread, cross-pair, and cross-variant requests.
- Regenerate provenance tests prove `CONTEXT.json` contains selected Markdown
  text or exact rendered prompt input sufficient to reconstruct the original
  Codex input after memory edits.
- Completed Regenerate rewrites `THREAD.md` and enqueues backup reason
  `psychiatrist_response_regenerate`.
- Failed Regenerate attempts do not overwrite `RESPONSE.md`; a fresh thread
  load still exposes the previous completed assistant response for the same
  `pair_id`.
- Stopped Regenerate attempts have separate coverage from failed Regenerate:
  explicit Stop must append safe stopped metadata for the new regenerate
  `turn_id`, must not append a pair revision that hides the previous completed
  assistant response, must not overwrite `pairs/{pairId}/RESPONSE.md`, and a
  fresh thread load must still expose the previous completed assistant response
  for the same `pair_id`.
- Backup formatting maps `psychiatrist_response_regenerate` to
  `regenerated psychiatrist response`.

Component tests:

- Running state changes submit to Stop.
- Stop click calls cancel exactly once.
- Stop click calls cancel with active memory/thread/pair/turn/variant identity.
- Panel close, Escape, route unmount, and remount do not call cancel.
- Mount with `active_turn` reconnects to the event URL.
- Stream replay renders process and answer rows before live deltas.
- Regenerate button appears only on completed assistant responses.
- Regenerate calls the regenerate route with the existing `pairId`.
- Failed Regenerate leaves the previous completed response visible.
- Failed, stopped, or network-permission-required Regenerate remains visible as
  a safe status while preserving the previous completed answer after the
  component receives server state from a fresh thread load.

E2E tests:

- A running fake turn continues after navigating from `/memories/:id` to
  `/memories` and back.
- A running fake turn continues after browser reload and reconnects to the same
  `turn_id`.
- Stop cancels only after explicit Stop click.
- Regenerate overwrites the same response artifact and does not add a new pair.
- A failed fake Regenerate leaves the previous completed response visible after
  browser reload.
- A stopped fake Regenerate is a separate browser case: click Regenerate on a
  completed answer, click Stop before any replacement answer delta is committed,
  reload the page, reopen the Psychiatrist dock, and verify the previous
  completed response remains visible for the same pair.

## Interruption Recovery Audit

If implementation is resumed after an interruption, rate limit, context
compaction, or worker handoff, treat these as independent completion checks
before marking 24.8 complete:

- Confirm failed Regenerate coverage exists in server storage/API tests and in
  `e2e/reader.spec.ts`.
- Confirm stopped Regenerate coverage exists in server storage/API tests and in
  `e2e/reader.spec.ts`; failed Regenerate coverage does not satisfy this item.
- Confirm the stopped Regenerate server path preserves the reduced loaded pair:
  no canceled/stopped pair revision may replace an already completed assistant
  response during `reducePairRows()` or equivalent pair loading.
- Confirm stopped Regenerate writes terminal turn metadata with a safe stopped
  status and safe error, but leaves `pairs/{pairId}/RESPONSE.md` byte-for-byte as
  the previous completed answer.
- Confirm browser reload evidence after stopped Regenerate, not only live
  reducer evidence before reload.

Run:

```bash
mise exec -- bun run test tests/server/backup/git-backup.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/threads.test.ts tests/server/psychiatrist/api-routes.test.ts tests/components/psychiatrist-dock.test.tsx
mise exec -- bun run test:e2e e2e/reader.spec.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- User-visible process and answer streams are replayable after navigation and
  reload.
- Running turns continue unless the user explicitly presses Stop.
- Stop is represented by the running submit button changing to Stop.
- Regenerate reuses the same prompt/context pair and overwrites existing
  thread-managed Markdown artifacts.
- Regenerate and normal thread updates are backed up with distinct commit
  actions.
