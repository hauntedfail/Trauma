# 19.6 Codex auth and device-code setup flow

## Goal

Expose Codex managed ChatGPT sign-in state through TRAUMA settings without TRAUMA owning credential material.

## Files likely owned

- `src/server/settings/codex-auth.ts`
- current settings API routes under `src/routes/api/settings*`
- `src/components/settings/SettingsPage.tsx`
- `tests/server/settings/codex-auth.test.ts`
- `tests/components/settings-codex-auth.test.tsx`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/04-api-and-sse.md`
- `contracts/06-codex-prompt-and-validation.md`

## Instruction alignment

Scope: Codex managed ChatGPT sign-in state surfaced through settings without TRAUMA owning credential material.

Inputs: current settings UI/API, `CodexAppServerClient`, `account/read`, `account/login/start`, login notifications, and logout support.

Outputs: settings-visible auth status, safe device-code setup metadata, login cancellation behaviour, and logout/delete semantics.

Dependencies: 19.5 provides app-server auth methods; current settings routes provide the UI/API surface.

Parallelization notes: can run beside 19.5 only after shared auth types are frozen; do not edit translation chunking or persistence.

Implementation risks: storing ChatGPT tokens, printing credential paths, or faking enabled state would violate the instruction's auth boundary.

## Auth boundary contract

Rules:

- Codex owns ChatGPT credentials through its managed auth flow.
- TRAUMA stores only non-secret auth metadata and status.
- TRAUMA does not read, parse, print, copy, or back up Codex credential files.
- Frontend responses never include access tokens, refresh tokens, auth file contents, or sensitive credential paths.
- Auth state and `translation_target_lang_code` may share the settings page but must remain separate values.

## Device-code setup contract

If auth is missing and app-server supports `chatgptDeviceCode`, return safe setup metadata for the settings UI. The UI can show user code and verification URL if provided by Codex app-server.

Do not invent a direct ChatGPT OAuth URL flow outside Codex app-server.

App-server methods:

- Read status through `CodexAppServerClient.checkAuth()`, backed by `account/read`.
- Start device-code login through `CodexAppServerClient.startDeviceCodeLogin()`, backed by `account/login/start` and `{ "type": "chatgptDeviceCode" }`.
- Return only `loginId`, `verificationUrl`, and `userCode` to the frontend.
- Treat typed `auth.login.completed` and `auth.account.updated` events from `CodexAppServerClient.observeAuthEvents()` as setup progress, then confirm enabled state with `checkAuth()`.
- Cancel a pending login through `CodexAppServerClient.cancelDeviceCodeLogin({ loginId })` when the user abandons setup and `loginId` is known.
- Delete auth through `CodexAppServerClient.logout()`, which wraps app-server `account/logout` when supported.

The settings/auth service must not subscribe to raw JSON-RPC notifications or call app-server methods directly. Raw JSON-RPC payloads are adapted only inside `src/server/translation/codex-app-server.ts`.

Backend API shape:

- `GET /api/settings/codex-auth`
- `POST /api/settings/codex-auth/device-code`
- `POST /api/settings/codex-auth/device-code/cancel`
- `DELETE /api/settings/codex-auth`

If existing Task 18 settings UI or routes still use `OpenAI Auth` or
`openai-auth` naming for compatibility, those routes delegate to the same
`codex-auth` service and return the same response shapes.

Status response:

```json
{
  "status": "enabled",
  "provider": "codex",
  "message": "Codex ChatGPT sign-in is enabled."
}
```

Setup-required response:

```json
{
  "status": "setup_required",
  "provider": "codex",
  "reason": "codex_app_server_unavailable"
}
```

Device-code start response:

```json
{
  "status": "login_started",
  "provider": "codex",
  "loginId": "login_018f...",
  "verificationUrl": "https://...",
  "userCode": "ABCD-EFGH"
}
```

Rules:

- Server stores only non-secret pending-login metadata needed to correlate `loginId` and cancellation.
- Frontend never receives tokens, credential paths, app-server URL, app-server transport details, or raw account payloads.
- While login is pending, refreshes call `account/read` and return confirmed enabled state if available.
- If login is still pending and the server has known pending metadata, refresh returns non-secret pending state with `status: "login_started"`, `loginId`, `verificationUrl`, and `userCode`.
- If login is still pending but pending metadata was lost, refresh returns latest confirmed `account/read` state instead of inventing a pending login.
- `auth.login.completed` and `auth.account.updated` events are progress signals only; enabled state is set only after a successful `checkAuth()`.
- Start `CodexAppServerClient.observeAuthEvents()` only while a device-code login is pending.
- Correlate completion with pending `loginId` when the event includes one; otherwise treat `auth.account.updated` as a prompt to call `checkAuth()` and confirm state.
- Stop the observer when login completes, is canceled, fails, times out, or the process/request scope is disposed.
- Server restart or listener loss does not expose secrets and does not fake failure. `GET /api/settings/codex-auth` calls `checkAuth()` and returns confirmed enabled state, safe pending metadata if still known, or setup-required/unknown state.
- Multiple concurrent login starts for the same user/session reuse the existing pending login metadata instead of creating duplicate observers.

## Enable/delete behaviour

- Enable does not mark auth as enabled until the server verifies Codex can run an authenticated operation.
- If provider setup is missing, return a normal `setup_required` or `not_configured` response rather than a fake enabled state.
- Already-enabled enable requests are idempotent.
- Delete auth calls app-server `account/logout` when supported. If app-server logout is unavailable, delete only TRAUMA-owned metadata and explicitly report that Codex-owned credentials were not removed.

## Tests

Cover:

- auth status disabled, enabled, setup-required, unknown, and error
- enable verifies server-side auth before marking enabled
- provider-missing enable does not fake enabled state
- already-enabled enable is idempotent
- device-code response contains only safe fields
- device-code response includes `loginId`, `verificationUrl`, and `userCode`
- device-code login completion waits for app-server notifications and confirms with `account/read`
- auth service consumes typed `CodexAuthEvent` values, not raw JSON-RPC notification names
- auth observer is active only during pending login and is cleaned up on completion, cancel, failure, timeout, or scope disposal
- listener loss/restart falls back to `checkAuth()` plus safe pending metadata
- pending device-code status refresh returns safe pending metadata when known and confirmed `account/read` state otherwise
- login cancel calls `account/login/cancel` only with a known `loginId`
- logout uses `account/logout` when supported
- delete auth does not delete arbitrary `~/.codex` files
- no secret material is returned to frontend

## Verification

```sh
mise exec -- bun run test tests/server/settings/codex-auth.test.ts
mise exec -- bun run test tests/components/settings-codex-auth.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Settings UI can explain Codex setup state.
- Auth verification is server-side.
- TRAUMA does not own raw Codex credentials.
- SQLite-backed target-language settings remain independent from auth metadata.
