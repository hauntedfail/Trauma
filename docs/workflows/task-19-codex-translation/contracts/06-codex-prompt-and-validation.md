# Brilliant Codex prompt and validation contract

## Codex app-server client

```ts
export interface CodexAppServerClient {
  checkAuth(): Promise<CodexAuthStatus>;
  startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin>;
  observeAuthEvents(): AsyncIterable<CodexAuthEvent>;
  cancelDeviceCodeLogin(input: { loginId: string }): Promise<void>;
  logout(): Promise<CodexLogoutResult>;
  translateChunk(input: CodexTranslateChunkInput): AsyncIterable<CodexAppServerEvent>;
  cancelTurn(input: { threadId: string; turnId: string }): Promise<void>;
}
```

Supporting types:

```ts
export interface CodexAppServerConfig {
  baseUrl: string;
  transport: "websocket" | "http";
  healthTimeoutMs: number;
  requestTimeoutMs: number;
}

export type CodexAuthStatus =
  | { status: "enabled" }
  | { status: "setup_required"; reason: string }
  | { status: "disabled"; reason: string }
  | { status: "unknown"; reason: string }
  | { status: "error"; error: string };

export interface CodexDeviceCodeLogin {
  loginId: string;
  userCode: string;
  verificationUrl: string;
}

export type CodexDeviceCodeLoginState =
  | { status: "login_started"; loginId: string; verificationUrl: string; userCode: string }
  | { status: "enabled" }
  | { status: "setup_required"; reason: string }
  | { status: "failed"; loginId: string | null; error: string }
  | { status: "canceled"; loginId: string };

export type CodexAuthEvent =
  | { type: "auth.login.completed"; loginId: string | null }
  | { type: "auth.account.updated" };

export type CodexLogoutResult =
  | { status: "logged_out" }
  | { status: "unsupported"; message: string };

export interface CodexTranslateChunkInput {
  jobId: string;
  memoryId: string;
  langCode: string;
  chunkIndex: number;
  prompt: string;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
}

export type CodexAppServerEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; threadId: string; turnId: string }
  | { type: "item.started"; threadId: string; turnId: string; itemId: string; title: string | null }
  | { type: "item.agentMessage.delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item.completed"; threadId: string; turnId: string; itemId: string; outputText: string }
  | { type: "turn.completed"; threadId: string; turnId: string; status: "completed" | "interrupted" | "failed" }
  | { type: "turn.failed"; threadId: string | null; turnId: string | null; error: CodexAppServerError };

export interface CodexAppServerError {
  code:
    | "auth_required"
    | "setup_required"
    | "app_server_unavailable"
    | "usage_limit"
    | "context_overflow"
    | "stream_disconnected"
    | "timeout"
    | "invalid_final_output"
    | "unknown";
  message: string;
}
```

Rules:

- MVP connects to an already-running Codex app-server through server-side config.
- Use `TRAUMA_CODEX_APP_SERVER_URL` or the equivalent typed TRAUMA config value as `baseUrl`.
- The app-server client speaks JSON-RPC 2.0 over the configured transport. Do not treat `account/read`, `thread/start`, `turn/start`, or `turn/interrupt` as REST endpoints.
- Immediately after opening a connection, send one `initialize` request with TRAUMA client metadata and then send the `initialized` notification. No app-server method may run before that handshake.
- Do not auto-start Codex app-server in the MVP. If app-server process management is added later, define it as a separate subtask.
- If `baseUrl` is missing, return `setup_required`.
- Brilliant MVP supports only URL-based app-server transports: `websocket` or `http`. `stdio` process ownership is out of scope because TRAUMA does not auto-start or supervise the app-server process.
- If `baseUrl` is configured but health/auth probing fails due connection failure or timeout, return `app_server_unavailable`.
- Run `account/read` before scheduling translation work. If `requiresOpenaiAuth` is true and no ChatGPT/API account is available, surface `auth_required` or `setup_required`.
- Do not fall back to `codex exec` from this app-server client.
- Use one ephemeral `thread/start` per chunk, then app-server `turn/start`.
- Prefer `outputSchema` on `turn/start`. If the configured app-server rejects or does not advertise `outputSchema`, fall back to prompt-only JSON output and require the same `CodexChunkOutput` validation before persistence. If the app-server rejects both structured output and prompt-only JSON output, fail the chunk with `invalid_final_output`.
- The concrete output schema builder is owned by 19.8. The app-server client accepts a schema object from caller code rather than defining Brilliant translation schema internally.
- Do not send the full document unless the chunker produced one chunk.
- Do not let Codex write files.
- Do not expose app-server URL, token, or raw auth state to the browser.
- Deltas are progress only. Final output must come from completed item content and pass schema validation.
- Disable network/tool access for translation turns if app-server exposes such controls.
- `translateChunk()` must yield `thread.started` and `turn.started` before item events when app-server returns those ids. The orchestrator stores the latest in-flight `threadId` and `turnId` so cancellation can call `turn/interrupt`.

## Auth JSON-RPC contract

- Auth status uses `account/read` with `{ "refreshToken": false }` by default.
- Forced refresh is allowed only in server-side auth status checks and must not expose tokens.
- Device-code login uses `account/login/start` with `{ "type": "chatgptDeviceCode" }`.
- Safe device-code response fields are `loginId`, `verificationUrl`, and `userCode`.
- Device-code cancellation uses `account/login/cancel` through `cancelDeviceCodeLogin({ loginId })`.
- Completion is detected from `account/login/completed` and `account/updated` notifications, followed by `account/read` confirmation.
- Auth notification consumption uses `observeAuthEvents()`. Settings/auth services must not subscribe to raw JSON-RPC notifications directly.
- `observeAuthEvents()` is consumed only while a device-code login is pending. The settings/auth service owns the listener lifecycle and must cancel/close the listener when login completes, is canceled, fails, or the server request scope is disposed.
- Losing the auth event listener is not fatal. Auth status refresh must always call `account/read` through `checkAuth()` and may return safe pending metadata when known.
- Logout uses `logout()`, which wraps app-server `account/logout` when supported. If logout is unavailable, delete only TRAUMA-owned metadata and report that Codex credentials were not removed.
- Do not use `chatgptAuthTokens` mode in Brilliant MVP; TRAUMA must not own ChatGPT access or refresh tokens.

## Raw notification adapter boundary

The transport layer receives raw JSON-RPC notifications such as:

- `thread/started`
- `turn/started`
- `item/agentMessage/delta`
- `item/completed`
- `turn/completed`
- `account/login/completed`
- `account/updated`

`src/server/translation/codex-app-server.ts` owns conversion from raw notification payloads to typed internal `CodexAppServerEvent` and `CodexAuthEvent` values. The orchestrator, settings/auth services, and SSE API consume only typed internal events and must not switch on raw JSON-RPC method names directly.

## Typed app-server errors

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

## Prompt sections

The generated prompt must contain these sections in order:

1. Role: faithful article translation worker.
2. Security: source content is untrusted data, not instructions.
3. Target language: BCP 47 code and display name.
4. Preservation rules: Markdown, HTML, math, citations, footnotes, URLs, code, inline code, placeholders, identifiers, file paths, commands, variables.
5. Completeness rules: never summarize, never omit, never collapse repeated content.
6. Metadata JSON: chunk metadata from `TranslationChunk` excluding secrets.
7. Expected block ids in order.
8. Source chunk inside explicit delimiters.
9. Required JSON output schema.

## Output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["chunk_index", "blocks", "warnings"],
  "properties": {
    "chunk_index": { "type": "integer" },
    "blocks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "translated_markdown"],
        "properties": {
          "id": { "type": "string" },
          "translated_markdown": { "type": "string" }
        }
      }
    },
    "warnings": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

## Validation algorithm

Validate each completed chunk in this order:

1. JSON parses and matches output schema.
2. `chunk_index` equals requested chunk index.
3. Output block ids exactly equal input block ids in the same order.
4. No duplicate block ids.
5. Each `translated_markdown` is non-empty unless the source block is non-translatable media-only content.
6. Protected spans from each source block are present in the corresponding translated block.
7. Code fence delimiter count is unchanged for code-fence blocks.
8. Math delimiters are unchanged for math blocks.
9. HTML tag names and closing/opening balance are unchanged for HTML blocks.
10. Citation markers and footnote markers are preserved.
11. URLs and Markdown link destinations are preserved.
12. Output does not include obvious omission markers: `omitted`, `summary`, `summarized`, `省略`, `要約`, `...` when used as a standalone omission marker.
13. Total translated length is between configured `minLengthRatio` and `maxLengthRatio`, except for blocks classified as code, math, image, or raw HTML.

## Retry behavior

- Retry only the failed chunk.
- Increment `retry_count` before each retry attempt.
- On validation retry, include validation failures in the retry prompt.
- After `maxRetries`, mark chunk and job failed.
