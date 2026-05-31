# 24.3 Session API And Streaming Events

## Goal

Add TRAUMA API routes that create memory-scoped Psychiatrist sessions, accept
user messages, run Codex assistant turns, and stream safe assistant events back
to the reader UI.

## Files Likely Owned

- Create: `src/server/psychiatrist/errors.ts`
- Create: `src/server/psychiatrist/events.ts`
- Create: `src/server/psychiatrist/sessions.ts`
- Create: `src/server/psychiatrist/session-route.ts`
- Create: `src/server/psychiatrist/message-route.ts`
- Create: `src/server/psychiatrist/events-route.ts`
- Create: `src/server/psychiatrist/cancel-route.ts`
- Create: `src/routes/api/memories/[memoryId]/psychiatrist/sessions.ts`
- Create: `src/routes/api/psychiatrist-sessions/[sessionId]/messages.ts`
- Create: `src/routes/api/psychiatrist-turns/[turnId]/events.ts`
- Create: `src/routes/api/psychiatrist-turns/[turnId]/cancel.ts`
- Test: `tests/server/psychiatrist/api-routes.test.ts`
- Test: `tests/server/psychiatrist/events.test.ts`
- Test: `tests/server/psychiatrist/sessions.test.ts`

## API Contract

Create session:

```http
POST /api/memories/:memoryId/psychiatrist/sessions
content-type: application/json

{
  "lang_code": "ja-JP"
}
```

For a source reader, the body may be `{}`. For a translated reader, the body
must include the active `lang_code`.

Successful response:

```json
{
  "status": "ready",
  "session_id": "019f...",
  "memory_id": "019e...",
  "lang_code": "ja-JP",
  "variant_kind": "translation",
  "content_hash": "sha256:...",
  "expires_at": "2026-06-01T12:30:00.000Z"
}
```

Send message:

```http
POST /api/psychiatrist-sessions/:sessionId/messages
content-type: application/json

{
  "client_message_id": "local-1",
  "message": "What does this memory say about the deployment risk?"
}
```

Response:

```json
{
  "status": "started",
  "turn_id": "019f...",
  "session_id": "019f...",
  "event_url": "/api/psychiatrist-turns/019f.../events"
}
```

Stream turn events:

```http
GET /api/psychiatrist-turns/:turnId/events
accept: text/event-stream
```

Event names:

- `psychiatrist.turn.started`
- `psychiatrist.answer.delta`
- `psychiatrist.answer.completed`
- `psychiatrist.answer.failed`
- `psychiatrist.turn.canceled`
- `psychiatrist.session.stale`

Cancel turn:

```http
POST /api/psychiatrist-turns/:turnId/cancel
```

## Session Rules

- Sessions live in memory and expire after 30 minutes of inactivity.
- A session stores memory id, optional lang code, variant kind, content hash,
  context snapshot, transcript, Codex thread id when available, active turn id,
  and expiry.
- Session ids and turn ids use the existing UUID v7 generator.
- Only one active turn may run per session. A concurrent message returns `409`
  with `code = "turn_conflict"`.
- Before each turn, the server reloads the active memory content hash. If it no
  longer matches the session hash, return or emit `session_stale` and require a
  fresh session.
- Completed assistant output is appended to the transcript. Deltas alone are
  not transcript state.
- Failed or canceled turns append no assistant message.

## Error Contract

Safe error response shape:

```json
{
  "status": "error",
  "code": "auth_required",
  "message": "Codex ChatGPT sign-in is required before Psychiatrist can answer.",
  "action": "setup_codex_auth"
}
```

Required codes:

- `invalid_request`
- `missing_memory`
- `context_unavailable`
- `session_not_found`
- `session_stale`
- `turn_conflict`
- `auth_required`
- `setup_required`
- `app_server_unavailable`
- `app_server_protocol_error`
- `usage_limit`
- `context_overflow`
- `timeout`
- `stream_disconnected`
- `turn_interrupted`
- `unknown`

Messages must not include memory Markdown, prompt text, app-server payloads,
socket paths, credential paths, or tokens.

## Tests

Cover:

- Session route creates a source session and translated session.
- Message route rejects empty messages and oversized messages.
- Message route rejects missing, expired, and stale sessions.
- Message route rejects a second active turn for the same session.
- Event route emits snapshot/started/delta/completed in order.
- Failed app-server turns emit safe failure events.
- Cancel route calls `cancelTurn()` with the stored thread id and turn id.
- Browser-visible JSON never contains app-server endpoint details.

Run:

```bash
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/sessions.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- A reader can create a context-ready session before sending a prompt.
- Each user message streams through TRAUMA SSE, not direct app-server access.
- Stale memory content is detected before the assistant answers.
