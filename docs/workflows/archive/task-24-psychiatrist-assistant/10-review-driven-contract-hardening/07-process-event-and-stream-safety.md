# 24.10.7 Process Event And Stream Safety

## Goal

Define a safe projection contract for visible process/status events and replayed
stream rows. Filtering must be based on allowed event shape and bounded display
text, not broad string redaction after raw payloads enter durable storage.

## Files Owned

- Modify: `src/server/translation/codex-app-server.ts`
- Modify: `src/server/psychiatrist/stream-store.ts`
- Modify: `src/server/psychiatrist/events.ts`
- Modify: `tests/server/translation/codex-app-server.test.ts`
- Modify: `tests/server/psychiatrist/events.test.ts`

If process projection becomes reusable outside Psychiatrist, split a shared
projection helper workflow before coding.

## Required Projection Contract

Allowed visible process events must satisfy all conditions:

- event kind is in a small allowlist such as `status`, `search`, `source`, or
  `tool_progress`;
- text is plain display text, length-bounded, and normalized;
- payload contains no raw app-server notification object;
- payload contains no absolute local paths, credential paths, API keys, tokens,
  signatures, shell commands, prompts, hidden reasoning, or fetched body text;
- source URLs, when present, use the 24.10.2 URL projection function.

Rejected process events may be dropped or replaced with a generic safe status.
They must not be stored in `streams/{turnId}.jsonl`.

## Required Tests

Add tests that fail on the current implementation:

- A raw app-server payload with nested credentials is not stored or emitted.
- A process event containing an absolute local path is dropped or generalized.
- A process event containing signed source URLs stores only projected citation
  URLs.
- Hidden reasoning/tool internals are never written to the stream JSONL replay.
- Safe status text still streams and replays after `Last-Event-ID`.

## Implementation Notes

- Project before persistence. Do not store raw process payloads and rely on UI
  filtering later.
- Keep answer Markdown handling separate from process event projection.
- Keep event ordering stable for replay after filtering.
- Do not add network validation.

## Verification

```bash
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts -t "process"
mise exec -- bun run test tests/server/psychiatrist/events.test.ts
git diff --check
```
