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

## Instruction alignment

Scope: backend-only Codex app-server client, auth probe, thread/turn creation, notification parsing, and cancellation primitive.

Inputs: configured app-server transport, JSON-RPC protocol, output schema from 19.8, and chunk payloads from the orchestrator.

Outputs: fakeable `CodexAppServerClient`, typed events, typed errors, and app-server-safe auth/device-code adapters.

Dependencies: 19.1 freezes app-server boundary; 19.8 owns prompt/schema content.

Parallelization notes: can run with 19.6 and 19.7 after JSON-RPC types are frozen; avoid editing frontend or final file writing.

Implementation risks: treating app-server as REST or skipping `initialize` will fail against the real protocol; exposing app-server details to the browser violates security requirements.

## Client contract

Implement a server-only client with these operations:

```ts
checkAuth(): Promise<CodexAuthStatus>
startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>
observeAuthEvents(): AsyncIterable<CodexAuthEvent>
cancelDeviceCodeLogin(input: { loginId: string }): Promise<void>
logout(): Promise<CodexLogoutResult>
translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>
cancelTurn(input: { threadId: string; turnId: string }): Promise<void>
```

## Connection contract

The MVP connects to an already-running Codex app-server. It does not auto-start or supervise the app-server process.

Rules:

- Read app-server endpoint from `TRAUMA_CODEX_APP_SERVER_ENDPOINT` or the equivalent typed TRAUMA config value.
- Default Brilliant MVP endpoint is `unix://`.
- Default local app-server startup command is `codex app-server --listen unix://`.
- Support Unix socket as the default JSON-RPC transport and loopback WebSocket only as a local development fallback.
- Loopback WebSocket fallback example: `codex app-server --listen ws://127.0.0.1:4500` and `TRAUMA_CODEX_APP_SERVER_ENDPOINT=ws://127.0.0.1:4500`.
- HTTP is health-probe-only and must not be used for JSON-RPC app-server requests.
- Reject `http://` and `https://` endpoints for JSON-RPC.
- Reject `stdio` configuration because TRAUMA does not own app-server process startup or supervision in Brilliant.
- Reject non-loopback WebSocket endpoints until a separate security subtask defines remote listener authentication and secret storage.
- Speak JSON-RPC 2.0 over the configured app-server transport; do not implement app-server calls as REST fetches to `turn/start`-style URLs.
- After transport connection opens, send `initialize` with TRAUMA client metadata and then send `initialized`.
- Reject or retry connection setup if any request is attempted before initialization.
- Missing base URL returns `setup_required`.
- Configured but unreachable app-server returns `app_server_unavailable`.
- Health/auth probe uses `account/read` before scheduling translation work.
- Device-code completion and account update notifications are converted to typed auth events for settings/auth services.
- No fallback to `codex exec` exists in this client.
- Request timeout and health timeout are explicit config values or documented defaults.

Protocol schema rules:

- Record the local Codex CLI/app-server version used to implement the client.
- Prefer generated Codex app-server TypeScript or JSON Schema artifacts from `codex app-server generate-ts` or `codex app-server generate-json-schema` for fake app-server tests.
- If generated artifacts are too large, add focused protocol fixtures for the JSON-RPC methods and notifications Brilliant consumes.
- Hand-written event types must be checked against the generated schema or focused fixture version.

Rules:

- Use Codex app-server `thread/start` to create one ephemeral thread per chunk, then `turn/start` for chunk translation.
- `turn/start` must include the locked-down Brilliant translation turn policy from `contracts/06-codex-prompt-and-validation.md`.
- Accept an `outputSchema` from caller code and pass it to app-server when supported.
- If `outputSchema` is unsupported or rejected, retry the same chunk with a prompt-only JSON response contract. The returned JSON must still pass `CodexChunkOutput` validation before persistence. If both paths fail, mark the chunk/job with `invalid_final_output`.
- Do not define the Brilliant translation output schema in this module; schema construction is owned by 19.8.
- Use one ephemeral Codex thread per chunk by default.
- Do not expose app-server URL, auth state, or connection details to frontend code.
- Do not allow Codex to write canonical `CONTENT.md` files.
- Streamed app-server deltas are progress only.
- Final output must come from completed app-server item content.
- `translateChunk()` yields `thread.started` and `turn.started` when ids are available so the orchestrator can cancel the in-flight turn.
- Cancellation uses `turn/interrupt` with both `threadId` and `turnId`.
- Raw JSON-RPC notifications are parsed only in this module and converted into typed `CodexAppServerEvent` values before reaching orchestrator or SSE code.
- Auth JSON-RPC notifications are parsed only in this module and converted into typed `CodexAuthEvent` values before reaching settings/auth services.

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
- missing app-server endpoint returns setup-required
- default Unix socket endpoint config is accepted
- loopback WebSocket fallback config is accepted and documented as local-dev-only
- Unix socket JSON-RPC transport is accepted
- loopback WebSocket JSON-RPC transport is accepted
- HTTP endpoints are rejected for JSON-RPC
- non-loopback WebSocket endpoints are rejected for Brilliant MVP
- `stdio` transport configuration is rejected as unsupported for Brilliant MVP
- unreachable app-server returns app-server-unavailable
- JSON-RPC initialize and initialized happen before `account/read`, `thread/start`, or `turn/start`
- generated schema or focused protocol fixtures cover the JSON-RPC methods and notifications used by the fake app-server
- device-code login response is safe to return to settings UI
- device-code cancel wraps `account/login/cancel` and requires a known `loginId`
- logout wraps `account/logout` when supported and reports unsupported logout explicitly
- auth notifications map to typed `CodexAuthEvent` values including login success, failure, and cancellation
- auth check uses `account/read`
- chunk translation starts an ephemeral thread before starting a turn
- `turn/start` request passes through the caller-provided output schema
- `turn/start` request includes locked-down approval, sandbox, network, and cwd settings
- rejected `outputSchema` falls back to prompt-only JSON output and still validates `CodexChunkOutput`
- `translateChunk()` yields thread id and turn id before item events when available
- `cancelTurn()` sends `turn/interrupt` with thread id and turn id
- chunk translation uses ephemeral chunk scope
- delta event is yielded as non-final progress
- completed item content is yielded separately from deltas
- usage limit, context overflow, timeout, and disconnect are typed
- raw JSON-RPC notifications are converted to typed internal events inside the app-server client module
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
