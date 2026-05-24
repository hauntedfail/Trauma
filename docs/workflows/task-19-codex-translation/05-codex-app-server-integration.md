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

Inputs: configured app-server transport, Codex app-server wire protocol, output schema from 19.8, and chunk payloads from the orchestrator.

Outputs: fakeable `CodexAppServerClient`, typed events, typed errors, and app-server-safe auth/device-code adapters.

Dependencies: 19.1 freezes app-server boundary; 19.8 owns prompt/schema content.

Parallelization notes: can run with 19.6 and 19.7 after app-server wire types are frozen; avoid editing frontend or final file writing.

Implementation risks: treating app-server as REST or skipping `initialize` will fail against the real protocol; exposing app-server details to the browser violates security requirements.

## Client contract

Implement a server-only client with these operations:

```ts
checkAuth(): Promise<CodexAuthStatus>
startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>
observeAuthEvents(): AsyncIterable<CodexAuthEvent>
cancelDeviceCodeLogin(input: { loginId: string }): Promise<void>
logout(): Promise<CodexLogoutResult>
listModels(): Promise<CodexModelCatalog>
translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>
cancelTurn(input: { threadId: string; turnId: string }): Promise<void>
```

## Connection contract

The MVP connects to an already-running Codex app-server. It does not auto-start or supervise the app-server process.

Rules:

- Read app-server endpoint from `TRAUMA_CODEX_APP_SERVER_ENDPOINT` or the equivalent typed TRAUMA config value.
- Default Brilliant MVP endpoint is `unix://`, but only when the operator started Codex with `codex app-server --listen unix://`.
- Default local app-server startup command is `codex app-server --listen unix://`.
- `codex app-server` without `--listen unix://` uses the Codex CLI `stdio` default and is not a Brilliant endpoint.
- Support Unix socket as the default app-server wire-protocol transport and loopback WebSocket only as a local development fallback.
- Loopback WebSocket fallback example: `codex app-server --listen ws://127.0.0.1:4500` and `TRAUMA_CODEX_APP_SERVER_ENDPOINT=ws://127.0.0.1:4500`.
- HTTP is health-probe-only and must not be used for app-server wire-protocol requests.
- Reject `http://` and `https://` endpoints for app-server wire-protocol calls.
- Reject `stdio` configuration because TRAUMA does not own app-server process startup or supervision in Brilliant.
- Reject non-loopback WebSocket endpoints until a separate security subtask defines remote listener authentication and secret storage.
- Speak the Codex app-server wire protocol over the configured app-server transport; do not implement app-server calls as REST fetches to `turn/start`-style URLs.
- Use the Codex app-server wire envelope exactly: requests are `{ method, params, id }`, responses are `{ id, result }` or `{ id, error }`, and notifications are `{ method, params }`. Do not add a top-level `jsonrpc` field unless the generated schema or focused fixtures for the installed Codex version explicitly accept it.
- After transport connection opens, send `initialize` with TRAUMA client metadata and then send `initialized`.
- Brilliant defaults to the stable app-server schema and does not request
  `experimentalApi`. Do not send request fields that appear only in the
  generated `--experimental` schema.
- Reject or retry connection setup if any request is attempted before initialization.
- Missing endpoint returns `setup_required`.
- Configured but unreachable app-server returns `app_server_unavailable`.
- Health/auth probe uses `account/read` before scheduling translation work.
- Device-code completion and account update notifications are converted to typed auth events for settings/auth services.
- No fallback to `codex exec` exists in this client.
- Request timeout and health timeout are explicit config values or documented defaults.

Protocol schema rules:

- Record the local Codex CLI/app-server version used to implement the client.
- Prefer generated Codex app-server TypeScript or JSON Schema artifacts from `codex app-server generate-ts` or `codex app-server generate-json-schema` for fake app-server tests.
- If generated artifacts are too large, add focused protocol fixtures for the app-server methods and notifications Brilliant consumes.
- Hand-written event types must be checked against the generated schema or focused fixture version.
- Before implementing the production transport, run a focused Unix socket adapter
  spike. Confirm how Bun/Node connects to Codex app-server's `unix://` endpoint,
  which uses a Unix domain socket plus HTTP Upgrade/WebSocket framing, and define
  how `unix://` resolves the default Codex app-server control socket path.
- If Bun/Node cannot support the Unix socket WebSocket upgrade without adding a
  fragile custom frame implementation, document the blocker in the subtask
  handoff and use loopback WebSocket only as the local development fallback while
  keeping `unix://` as the intended default contract.

Rules:

- Use Codex app-server `thread/start` to create one ephemeral thread per chunk attempt, then `turn/start` for chunk translation.
- Use Codex app-server `model/list` as the backend-only source of truth for
  available translation models and supported reasoning efforts. Browser code
  must receive only TRAUMA-normalized catalog data through settings-scoped API
  routes.
- `turn/start` must include the locked-down Brilliant translation turn policy from `contracts/06-codex-prompt-and-validation.md`.
- `thread/start` must also receive the locked-down Brilliant policy when supported by the generated schema. If `turn/start` is the only method that accepts the exact sandbox fields, document that the turn payload overrides broader thread defaults before implementation.
- Stable `thread/start` sends only the fields supported by the stable generated
  schema for Brilliant: `cwd`, `ephemeral`, `approvalPolicy`,
  `approvalsReviewer`, `sandbox`, and `threadSource`. It must omit
  `environments`, `experimentalRawEvents`, and `persistExtendedHistory` unless
  a later task deliberately opts into `experimentalApi`.
- Stable `turn/start` sends `threadId`, `input`, `approvalPolicy`,
  `approvalsReviewer`, `sandboxPolicy`, and `outputSchema` when structured
  output is attempted. It sends the selected model as `model` and selected
  reasoning effort as `effort` only when the job metadata is non-null. It must
  omit `environments` unless a later task deliberately opts into
  `experimentalApi`.
- Runtime `cwd` comes from a job-scoped empty directory under `TRAUMA_CODEX_RUNTIME_DIR` or OS temp `trauma-codex-runtime/`; never use the TRAUMA project root or memory store path as `cwd`.
- `networkAccess = false` applies to sandboxed agent/tool execution only. It must not block the backend from connecting to app-server or app-server from contacting Codex/OpenAI services required for translation.
- Accept an `outputSchema` from caller code and pass it to app-server when supported.
- If `outputSchema` is unsupported or rejected, switch to prompt-only JSON response mode. The returned JSON must still pass `CodexChunkOutput` validation before persistence. This is output-mode negotiation, not chunk validation retry; it must not increment `retry_count`, must not consume `maxRetries`, and should be cached per app-server client/job when possible.
- Prefer probing or caching output-mode support before chunk translation starts. Once a job/client determines prompt-only JSON mode is required, use that mode for later chunk attempts without first sending rejected `outputSchema` payloads again.
- If `outputSchema` is rejected after a chunk attempt thread has already been created, discard that thread and start a fresh ephemeral thread in prompt-only JSON mode. This fresh thread is still the same chunk attempt for retry accounting and must not increment `retry_count`.
- If both structured-output mode and prompt-only JSON mode are unavailable or rejected, mark the chunk/job with `invalid_final_output`.
- Do not define the Brilliant translation output schema in this module; schema construction is owned by 19.8.
- Use one ephemeral Codex thread per chunk attempt by default.
- Do not expose app-server URL, auth state, or connection details to frontend code.
- Do not allow Codex to write canonical `CONTENT.md` files.
- Streamed app-server deltas are progress only.
- Final output must come from completed app-server item content.
- `translateChunk()` yields `thread.started` and `turn.started` when ids are available so the orchestrator can cancel the in-flight turn.
- Cancellation uses `turn/interrupt` with both `threadId` and `turnId`.
- In-flight `threadId` and `turnId` are kept in the local runner registry only. The app-server client does not require SQLite columns for these ids in Brilliant MVP.
- Raw app-server notifications are parsed only in this module and converted into typed `CodexAppServerEvent` values before reaching orchestrator or SSE code.
- Auth app-server notifications are parsed only in this module and converted into typed `CodexAuthEvent` values before reaching settings/auth services.

## Error contract

Map app-server failures to typed backend errors:

- `auth_required`
- `setup_required`
- `app_server_unavailable`
- `app_server_protocol_error`
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
- default Unix socket endpoint config is accepted only when paired with the explicit `codex app-server --listen unix://` startup requirement
- loopback WebSocket fallback config is accepted and documented as local-dev-only
- Unix socket app-server wire transport is accepted
- loopback WebSocket app-server wire transport is accepted
- HTTP endpoints are rejected for app-server wire-protocol calls
- non-loopback WebSocket endpoints are rejected for Brilliant MVP
- `stdio` transport configuration is rejected as unsupported for Brilliant MVP
- unreachable app-server returns app-server-unavailable
- app-server `initialize` and `initialized` happen before `account/read`, `thread/start`, or `turn/start`
- generated schema or focused protocol fixtures cover the app-server methods and notifications used by the fake app-server
- fake app-server fixtures omit top-level `jsonrpc` unless generated schema proves it is accepted
- `account/read` auth checks treat a non-null `account` as enabled even when
  `requiresOpenaiAuth` is true; `requiresOpenaiAuth: true` is auth-required only
  when no account is available
- device-code login response is safe to return to settings UI
- device-code cancel wraps `account/login/cancel` and requires a known `loginId`
- logout wraps `account/logout` when supported and reports unsupported logout explicitly
- raw `account/login/completed` and `account/updated` notifications map to
  typed `CodexAuthEvent` values including login success, failure, and
  cancellation
- auth check uses `account/read`
- chunk translation starts an ephemeral thread before starting a turn
- retry attempts start a fresh ephemeral thread and do not reuse the prior failed attempt's thread
- `turn/start` request passes through the caller-provided output schema
- `model/list` response parsing normalizes visible models and supported
  reasoning effort objects into the frontend-safe catalog shape
- `turn/start` request passes through selected model and reasoning effort using
  the generated stable schema field names `model` and `effort`
- output-schema rejection falls back to prompt-only JSON mode without incrementing `retry_count`
- output-schema fallback after thread creation discards the rejected thread and starts a fresh thread without consuming retry budget
- `turn/start` request includes locked-down approval, sandbox, network, and cwd settings
- `turn/start` locked-down policy is verified against generated schema or focused fixtures before implementation
- `thread/start` request includes the same locked-down policy where the generated schema supports it, or tests document that `turn/start` overrides thread defaults
- `thread/start` and `turn/start` use a job-scoped empty runtime `cwd`, never project root or store root
- network-disabled sandbox policy does not disable required app-server/model traffic
- rejected `outputSchema` falls back to prompt-only JSON output and still validates `CodexChunkOutput`
- `translateChunk()` yields thread id and turn id before item events when available
- `cancelTurn()` sends `turn/interrupt` with thread id and turn id
- in-flight thread/turn ids are exposed to the runner for cancellation but are not persisted in SQLite
- chunk translation uses ephemeral chunk scope
- delta event is yielded as non-final progress
- completed item content is yielded separately from deltas
- usage limit, context overflow, timeout, and disconnect are typed
- reachable app-server request-contract rejections, including
  `requires experimentalApi capability`, are typed as
  `app_server_protocol_error` instead of `app_server_unavailable`
- raw app-server notifications are converted to typed internal events inside the app-server client module
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
