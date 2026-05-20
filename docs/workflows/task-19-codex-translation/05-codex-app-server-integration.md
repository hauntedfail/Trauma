# 19.5 Codex app-server integration

## Goal

Implement the backend-only Codex app-server client for Brilliant chunk translation.

## Scope

Implement app-server connection/configuration, auth probing hooks, `turn/start`, streamed notification handling, final output extraction, typed error mapping, and test fakes. Do not expose app-server directly to frontend code.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.8 prompt and output schema
- Codex app-server docs for `turn/start`, `outputSchema`, `item/agentMessage/delta`, `item/started`, and `item/completed`

## Outputs

- Create: `src/server/translation/codex-app-server.ts`
- Test: `tests/server/translation/codex-app-server.test.ts`
- Fake client: colocated test fake or `tests/server/translation/fakes/fake-codex-app-server.ts`

## Dependencies

- 19.1 for integration boundary.
- 19.6 for auth status behavior.
- 19.8 for prompt and schema.

## Concrete client interface

Implement the interface frozen in `00-execution-contracts.md`:

```ts
checkAuth(): Promise<CodexAuthStatus>
startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>
translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>
cancelTurn(turnId: string): Promise<void>
```

Typed errors:

```text
auth_required
setup_required
app_server_unavailable
usage_limit
context_overflow
stream_disconnected
timeout
invalid_final_output
unknown
```

## Acceptance criteria

- App-server base URL and startup mode are configured server-side only.
- The browser never receives app-server credentials or direct connection details.
- `turn/start` uses `outputSchema` when available.
- One ephemeral thread per chunk is the default.
- Codex receives chunk text and metadata only.
- Codex is not allowed to write canonical translated files.
- Streamed deltas map to progress events but are not returned as final output.
- Final output is extracted only from completed app-server item content.
- Auth, usage, context, timeout, and disconnect failures are typed.
- Tests use a fake app-server and do not require live Codex.

## Parallelization notes

Can run with 19.6 and 19.7 after event names are frozen. Coordinate with 19.8 before finalizing `CodexTranslateChunkInput`.

## Implementation risks

- Treating delta text as final output can persist invalid partial JSON.
- Reusing one long thread for a full paper can exceed context limits.
- Exposing app-server to the browser leaks internal auth/control surfaces.
