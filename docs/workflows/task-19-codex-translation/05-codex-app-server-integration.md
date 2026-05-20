# 19.5 Codex app-server integration

## Goal

Implement the backend-only Codex app-server client used by Brilliant. This subtask does not create UI or write translated files.

## Files likely owned

- `src/server/translation/codex-app-server.ts`
- `tests/server/translation/codex-app-server.test.ts`
- optional `tests/server/translation/fakes/fake-codex-app-server.ts`

## Contract references

- `contracts/04-api-and-sse.md`
- `contracts/06-codex-prompt-and-validation.md`

## Client contract

Implement a server-only client with these operations:

```ts
checkAuth(): Promise<CodexAuthStatus>
startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>
translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>
cancelTurn(turnId: string): Promise<void>
```

## Connection contract

The MVP connects to an already-running Codex app-server. It does not auto-start or supervise the app-server process.

Rules:

- Read app-server base URL from `TRAUMA_CODEX_APP_SERVER_URL` or the equivalent typed TRAUMA config value.
- Missing base URL returns `setup_required`.
- Configured but unreachable app-server returns `app_server_unavailable`.
- Health/auth probe runs before scheduling translation work.
- No fallback to `codex exec` exists in this client.
- Request timeout and health timeout are explicit config values or documented defaults.

Rules:

- Use Codex app-server `turn/start` for chunk translation.
- Accept an `outputSchema` from caller code and pass it to app-server when supported.
- Do not define the Brilliant translation output schema in this module; schema construction is owned by 19.8.
- Use one ephemeral Codex thread per chunk by default.
- Do not expose app-server URL, auth state, or connection details to frontend code.
- Do not allow Codex to write canonical `CONTENT.md` files.
- Streamed app-server deltas are progress only.
- Final output must come from completed app-server item content.
- `translateChunk()` yields `turn.started` when a turn id is available so the orchestrator can cancel the in-flight turn.

## Error contract

Map app-server failures to typed backend errors:

- `auth_required`
- `setup_required`
- `app_server_unavailable`
- `usage_limit`
- `context_overflow`
- `stream_disconnected`
- `timeout`
- `invalid_final_output`
- `unknown`

## Tests

Use a fake app-server client. Cover:

- auth check success and auth-required failure
- missing app-server URL returns setup-required
- unreachable app-server returns app-server-unavailable
- device-code login response is safe to return to settings UI
- `turn/start` request passes through the caller-provided output schema
- `translateChunk()` yields turn id before item events when available
- chunk translation uses ephemeral chunk scope
- delta event is yielded as non-final progress
- completed item content is yielded separately from deltas
- usage limit, context overflow, timeout, and disconnect are typed
- no token, credential file content, or app-server secret is returned

## Verification

```sh
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Codex app-server integration is isolated behind one backend module.
- Prompt and output-schema construction remain owned by 19.8.
- App-server startup is outside MVP scope; connection is through server-side URL config.
- Frontend code cannot call app-server directly.
- The client can be faked for deterministic tests.
- No canonical file writes happen inside the Codex client.
