# 19.5 Codex app-server integration

## Goal

Connect the Reader backend to Codex app-server and translate chunks through controlled app-server turns.

## Scope

Implement the backend-only app-server client, turn creation, streamed notification handling, final output extraction, and transport error mapping. Do not expose app-server directly to frontend code.

## Inputs

- 19.1 app-server integration boundary
- 19.4 chunk metadata and source chunk Markdown
- 19.8 prompt and output schema
- Codex app-server documentation for `turn/start`, `outputSchema`, and notifications

## Outputs

- Backend Codex app-server client module.
- Per-chunk translation call that starts an ephemeral thread/turn.
- Notification adapter for `item/agentMessage/delta`, `item/started`, `item/completed`, and failure events.
- Final machine-readable chunk output extraction.

## Dependencies

- 19.1 for thread strategy and security boundary.
- 19.6 for auth readiness detection.
- 19.8 for prompt and output schema.

## Acceptance criteria

- The Reader backend starts or connects to Codex app-server through a server-side module.
- One ephemeral Codex thread per chunk is the default.
- Codex receives only chunk text, metadata, and translation instructions.
- Codex does not receive permission to write canonical `CONTENT.md` files.
- `turn/start` uses an output schema when app-server supports it.
- Streamed deltas are forwarded as non-authoritative progress events only.
- Persistence waits for final completed output and validation.
- Auth failure, usage limit, context overflow, stream disconnect, and app-server unavailable errors are mapped to typed backend errors.
- Tokens and credential material never enter frontend responses or logs.

## Parallelization notes

This can run in parallel with 19.6 and 19.7 after event names are frozen. It should not run in parallel with 19.8 if prompt schema names are still changing.

## Implementation risks

- Treating delta text as final output can persist invalid partial JSON.
- Reusing one long thread for a full paper can exceed context limits and omit late chunks.
- Letting frontend talk to app-server would leak internal auth and control surfaces.
