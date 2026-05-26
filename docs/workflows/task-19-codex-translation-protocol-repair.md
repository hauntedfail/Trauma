# Task 19S: Codex App-Server Protocol Repair Workflow

## Goal

Repair the Brilliant translation app-server path so TRAUMA sends only the
stable Codex app-server request schema it negotiated, classifies reachable
app-server request rejections accurately, and stops showing protocol-contract
failures as app-server availability failures.

## Status

- State: Repair workflow draft, tied to Task 19 but separate from the original
  Task 19 execution plan and Task 19R auth repair.
- Base workflow: [Task 19 Codex translation](task-19-codex-translation.md)
- Related repair: [Task 19R Codex app-server auth repair](task-19-codex-translation-auth-repair.md)
- Primary external reference:
  [OpenAI Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- Local protocol reference: generated schema from the installed Codex CLI via
  `codex app-server generate-json-schema --out <tmpdir>` and
  `codex app-server generate-json-schema --out <tmpdir> --experimental`.

## Required Context

- [Documentation index](../INDEX.md)
- [Task 19 overview](task-19-codex-translation.md)
- [Task 19 app-server integration](task-19-codex-translation/05-codex-app-server-integration.md)
- [Task 19 error handling and cancellation](task-19-codex-translation/15-error-handling-and-cancellation.md)
- [Task 19 test plan and fixtures](task-19-codex-translation/16-test-plan-and-fixtures.md)
- [Task 19 prompt and validation contract](task-19-codex-translation/contracts/06-codex-prompt-and-validation.md)
- [Configuration reference](../references/configuration.md)
- [Verification strategy](../quality/verification.md)
- [Coding standards](../references/coding-standards/INDEX.md)

## Current Failure To Reproduce

Precondition: start Codex app-server with the Unix listener and run TRAUMA with
that endpoint.

```bash
codex app-server --listen unix:///tmp/trauma-codex.sock
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:///tmp/trauma-codex.sock bun run dev
```

Observed failure after auth succeeds and translation starts:

```json
{
  "code": "app_server_unavailable",
  "message": "thread/start.environments requires experimentalApi capability",
  "action": "retry"
}
```

The app-server is not unavailable in this case. It is reachable and rejecting a
request field that belongs to the experimental schema, while TRAUMA initialized
the connection without `experimentalApi`.

## Confirmed Protocol Facts

The app-server protocol is JSON-RPC-shaped, but the wire envelope intentionally
does not include a top-level `jsonrpc` field.

Stable initialization:

```json
{
  "id": "1",
  "method": "initialize",
  "params": {
    "clientInfo": { "name": "TRAUMA Brilliant", "version": "0.2.0" },
    "capabilities": null
  }
}
```

After successful initialization, the client sends:

```json
{ "method": "initialized" }
```

Stable `thread/start` fields consumed by Brilliant:

- `cwd`
- `ephemeral`
- `approvalPolicy`
- `approvalsReviewer`
- `sandbox`
- `threadSource`

Fields that must not be sent in the stable `thread/start` request:

- `environments`
- `experimentalRawEvents`
- `persistExtendedHistory`

Stable `turn/start` fields consumed by Brilliant:

- `threadId`
- `input`
- `approvalPolicy`
- `approvalsReviewer`
- `sandboxPolicy`
- `outputSchema`

Fields that must not be sent in the stable `turn/start` request:

- `environments`

`outputSchema` is present in the stable `turn/start` schema and should remain
part of the structured-output attempt. If an app-server build rejects
`outputSchema`, that remains output-mode negotiation and should fall back to
prompt-only JSON mode without consuming chunk retry budget.

## Root Causes

1. `src/server/translation/codex-app-server.ts` initializes with
   `capabilities: null`, but then sends experimental fields in `thread/start`
   and `turn/start`.
2. Focused fixtures show the intended stable payload, but the fake app-server
   tests do not assert the actual params sent by the client, so protocol drift
   was not caught.
3. `createCodexWireError()` maps otherwise unknown JSON-RPC errors to
   `app_server_unavailable`, even when the socket is connected and the
   app-server returned a valid error response.
4. API and UI layers share the same coarse error code, so the reader tells the
   user to start app-server for a request-schema bug.
5. Existing documentation lists `app_server_unavailable` but does not define a
   separate app-server protocol or request-contract failure category.

## Ownership

Primary implementation files:

- `src/server/translation/codex-app-server.ts`
- `src/server/translation/types.ts`
- `src/server/translation/start-translation-route.ts`
- `src/components/reader/MemoryReader.tsx`

Primary tests:

- `tests/server/translation/codex-app-server.test.ts`
- `tests/server/translation/api-routes.test.ts`
- `tests/components/settings-page.test.ts`
- `tests/fixtures/translation/codex-app-server-protocol.focused.json`

Documentation to update only where it currently contradicts the stable protocol
or error taxonomy:

- `docs/workflows/task-19-codex-translation/05-codex-app-server-integration.md`
- `docs/workflows/task-19-codex-translation/15-error-handling-and-cancellation.md`
- `docs/workflows/task-19-codex-translation/16-test-plan-and-fixtures.md`
- `docs/workflows/task-19-codex-translation/contracts/04-api-and-sse.md`
- `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`

## Out Of Scope

- Starting, supervising, or auto-installing Codex app-server from TRAUMA.
- Opting TRAUMA into Codex experimental app-server APIs to preserve unnecessary
  experimental fields.
- Replacing Codex app-server with OpenAI Responses API, Codex SDK, or
  `codex exec`.
- Reworking auth semantics already covered by Task 19R.
- Reworking translation prompt, chunking, stitching, persistence, or translated
  reader rendering unless needed to verify the repaired app-server path.
- Storing Codex, ChatGPT, OpenAI access, or refresh tokens in TRAUMA.

## Error Taxonomy Decision

Keep `app_server_unavailable` narrow. Use it only for transport and process
availability failures such as a missing Unix socket listener, connection
refusal, connection open failure, or a connection that cannot be established.

Add `app_server_protocol_error` for reachable app-server failures where the
client request contract is incompatible with the negotiated protocol, including:

- invalid params
- unknown or gated request fields
- missing capability opt-in such as `requires experimentalApi capability`
- stable fixture or generated-schema drift
- unsupported method where TRAUMA expected a stable app-server method

Suggested HTTP mapping:

- `app_server_unavailable`: `503`
- `stream_disconnected`: `503`
- `timeout`: `504`
- `app_server_protocol_error`: `502`
- `invalid_final_output`: `502`

Suggested frontend copy:

- `app_server_unavailable`: `Codex app-server is unavailable. Start it and try again.`
- `app_server_protocol_error`: `Codex app-server rejected the translation request. Update the integration and retry.`

Protocol errors should not use retry-oriented action text unless the retry will
first use a corrected request. For persisted job errors, prefer `action: "none"`
or another non-misleading action over `retry`.

## Implementation Steps

1. Regenerate and inspect installed Codex app-server schemas.
   - Run `codex --version`.
   - Run `codex app-server generate-json-schema --out <stable_tmpdir>`.
   - Run `codex app-server generate-json-schema --out <experimental_tmpdir> --experimental`.
   - Confirm stable `thread/start` omits `environments`,
     `experimentalRawEvents`, and `persistExtendedHistory`.
   - Confirm stable `turn/start` omits `environments` and includes
     `outputSchema`.
   - Record the Codex CLI version and schema facts in the PR notes.

2. Add failing protocol payload tests.
   - Extend the fake app-server in
     `tests/server/translation/codex-app-server.test.ts` to capture full
     request messages, not only method names.
   - Add an assertion that `initialize.params.capabilities` does not request
     `experimentalApi`.
   - Add an assertion that `thread/start.params` has no `environments`,
     `experimentalRawEvents`, or `persistExtendedHistory`.
   - Add an assertion that `turn/start.params` has no `environments`.
   - Keep assertions that `turn/start.params.outputSchema` is present when the
     caller supplies an output schema.

3. Add a failing gated-field rejection test.
   - In the fake app-server, reject `thread/start` if params include
     `environments` with:

     ```json
     {
       "error": {
         "code": -32602,
         "message": "thread/start.environments requires experimentalApi capability"
       }
     }
     ```

   - Expected result: the client throws `CodexAppServerError` with
     `code === "app_server_protocol_error"`, not
     `app_server_unavailable`.

4. Fix stable request construction.
   - Remove `environments`, `experimentalRawEvents`, and
     `persistExtendedHistory` from `thread/start`.
   - Remove `environments` from `turn/start`.
   - Do not change `initialize` to request `experimentalApi`.
   - Keep the read-only `sandbox` and `sandboxPolicy` settings already covered
     by the stable schema.

5. Add and propagate `app_server_protocol_error`.
   - Extend `CodexAppServerError.code` in `codex-app-server.ts`.
   - Extend `TranslationErrorCode` and
     `PersistableTranslationErrorCode` in `types.ts`.
   - Update the translation runner error normalization if it currently assumes
     every Codex app-server unknown error is availability-related.
   - Update API route status mapping to return `502`.
   - Update reader UI copy so protocol errors do not tell the user to start
     app-server.

6. Refine wire error classification.
   - Classify explicit auth, usage, context, timeout, and stream errors as
     their existing specific codes.
   - Classify request-schema and capability-gating messages as
     `app_server_protocol_error`.
   - Treat valid JSON-RPC errors from a connected app-server as protocol or
     upstream execution errors, not transport availability failures.
   - Preserve the special `outputSchema` fallback path. A one-time
     `outputSchema` rejection should still trigger prompt-only JSON mode
     instead of becoming a terminal protocol error.

7. Align route, persistence, and UI tests.
   - In `tests/server/translation/api-routes.test.ts`, assert
     `app_server_protocol_error` maps to `502` and the response body preserves
     the code.
   - Add or update component coverage so the reader maps
     `app_server_protocol_error` to protocol-copy, not availability-copy.
   - Add repository or runner coverage only if persisted error normalization is
     not already covered through the runner tests.

8. Update focused fixtures and docs.
   - Update `tests/fixtures/translation/codex-app-server-protocol.focused.json`
     so stable request examples match the generated stable schema.
   - Update Task 19 app-server integration docs to state that Brilliant defaults
     to stable protocol and does not request `experimentalApi`.
   - Update error handling docs and API/SSE contract docs to include
     `app_server_protocol_error`.
   - Remove stale wording that implies every app-server JSON-RPC error is
     `app_server_unavailable`.

9. Verify with focused tests.
   - Run:

     ```bash
     mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
     mise exec -- bun run test tests/server/translation/api-routes.test.ts
     mise exec -- bun run test tests/components/settings-page.test.ts
     ```

   - Expected: focused tests pass and the fake app-server no longer observes
     stable-protocol experimental fields.

10. Verify full project health.
    - Run:

      ```bash
      mise exec -- bun run verify
      git diff --check
      ```

    - Expected: typecheck, unit tests, build, and whitespace checks pass.

11. Live smoke against Codex app-server.
    - Start app-server:

      ```bash
      codex app-server --listen unix:///tmp/trauma-codex.sock
      ```

    - Start TRAUMA:

      ```bash
      TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:///tmp/trauma-codex.sock mise exec -- bun run dev
      ```

    - With an already authenticated account, start translation for a known
      memory.
    - Expected: the job no longer fails with
      `thread/start.environments requires experimentalApi capability`.
    - If translation still fails, inspect `translation_jobs.error` and
      `translation_chunks.last_error` before changing code.

## Parallelization Opportunities

This repair is small enough for one worker, but execution can be split safely:

- Worker A: protocol request-shape tests, fixture refresh, and stable request
  construction.
- Worker B: error taxonomy, API route mapping, reader copy, and related tests.
- Worker C: docs stale cleanup after A and B land, using their final code and
  test names as source of truth.

Do not run A and B in the same working tree concurrently. If using subagents,
create isolated worktrees before parallel implementation and merge through a
single review point.

## Acceptance Criteria

- TRAUMA initializes the app-server connection without `experimentalApi`.
- `thread/start` stable requests omit `environments`, `experimentalRawEvents`,
  and `persistExtendedHistory`.
- `turn/start` stable requests omit `environments` and still pass
  `outputSchema` when structured output is attempted.
- A reachable app-server rejection such as
  `thread/start.environments requires experimentalApi capability` is persisted
  and surfaced as `app_server_protocol_error`, not
  `app_server_unavailable`.
- `app_server_protocol_error` maps to HTTP `502`.
- Reader UI no longer tells the user to start app-server for protocol-contract
  failures.
- Existing output-schema fallback behavior remains intact and does not consume
  chunk retry budget.
- Focused protocol fixtures and Task 19 docs reflect the stable schema and the
  refined error taxonomy.
- Focused tests, full `bun run verify`, and `git diff --check` pass.
