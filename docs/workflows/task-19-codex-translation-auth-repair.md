# Task 19R: Codex App-Server Auth Repair Workflow

## Goal

Repair the Brilliant Codex auth setup path so a completed Codex app-server
device-code login is detected by TRAUMA, reflected in Settings, and accepted by
the translation runner before scheduling Codex-backed translation work.

## Status

- State: Repair workflow draft, tied to Task 19 but separate from the original
  Task 19 execution plan.
- Base workflow: [Task 19 Codex translation](task-19-codex-translation.md)
- Primary external reference:
  [Codex App Server - OpenAI Developers](https://developers.openai.com/codex/app-server)
- Local protocol reference: generated schema from the installed Codex CLI via
  `codex app-server generate-json-schema --out <tmpdir>`.

## Required Context

- [Documentation index](../INDEX.md)
- [Task 19 overview](task-19-codex-translation.md)
- [Task 19 app-server integration](task-19-codex-translation/05-codex-app-server-integration.md)
- [Task 19 auth setup flow](task-19-codex-translation/06-codex-auth-and-device-code-setup-flow.md)
- [Task 19 prompt and validation contract](task-19-codex-translation/contracts/06-codex-prompt-and-validation.md)
- [Configuration reference](../references/configuration.md)
- [Verification strategy](../quality/verification.md)
- [Coding standards](../references/coding-standards/INDEX.md)

## Current Failure To Reproduce

Precondition: start Codex app-server with the Unix listener.

```bash
codex app-server --listen unix:///tmp/trauma-codex.sock
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:///tmp/trauma-codex.sock bun run dev
```

Observed failure:

1. Settings shows `Start setup`.
2. Clicking `Start setup` returns a device-code login response.
3. TRAUMA renders `verificationUrl` and `userCode`.
4. The user completes sign-in at `https://auth.openai.com/codex/device`.
5. TRAUMA remains in `login_started` UI state and translation still fails with
   auth/setup errors.

Live app-server evidence from `account/read` after device-code completion:

```json
{
  "account": {
    "type": "chatgpt",
    "email": "<redacted>",
    "planType": "prolite"
  },
  "requiresOpenaiAuth": true
}
```

This is a valid authenticated ChatGPT account state. The current implementation
incorrectly treats `requiresOpenaiAuth: true` as unauthenticated before checking
whether `account` exists.

## Root Causes

1. `src/server/translation/codex-app-server.ts` interprets
   `requiresOpenaiAuth === true` as `setup_required` before checking the
   `account` field.
2. Auth notification parsing listens for non-protocol auth-prefixed event names,
   but the official app-server protocol and generated schema use
   `account/login/completed` and `account/updated`.
3. Settings enters `login_started` but does not poll or otherwise refresh
   `/api/settings/codex-auth`, so a successful login is not reflected in the
   frontend unless a separate refresh path happens.
4. Existing tests and Task 19 contract text encode assumptions that are weaker
   than the official app-server auth examples.
5. `checkAuth()` currently calls `account/read` with `refreshToken: true` for
   every auth check. This is too aggressive for Settings polling and should not
   be the default read path.

## Ownership

Primary implementation files:

- `src/server/translation/codex-app-server.ts`
- `src/server/settings/codex-auth.ts`
- `src/components/settings/SettingsPage.tsx`
- `src/components/settings/settings-submit.ts`
- `src/routes/api/settings/codex-auth.ts`
- `src/routes/api/settings/codex-auth/device-code.ts`

Primary tests:

- `tests/server/translation/codex-app-server.test.ts`
- `tests/server/settings/codex-auth.test.ts`
- `tests/components/settings-page.test.ts`
- `tests/server/routes/api-settings.test.ts`

Documentation to update only where it currently contradicts the official
app-server auth contract:

- `docs/workflows/task-19-codex-translation/05-codex-app-server-integration.md`
- `docs/workflows/task-19-codex-translation/06-codex-auth-and-device-code-setup-flow.md`
- `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`
- `tests/fixtures/translation/codex-app-server-protocol.focused.json`

## Out Of Scope

- Starting, supervising, or auto-installing Codex app-server from TRAUMA.
- Storing ChatGPT, Codex, OpenAI access, or refresh tokens in TRAUMA.
- Exposing Codex app-server directly to browser code.
- Replacing Codex app-server with OpenAI Responses API or `codex exec`.
- Reworking translation prompt, chunking, stitching, or reader rendering unless
  needed to prove auth-gated translation startup.
- Multi-user auth or hosted OAuth callback service.

## State And Cache Decision

Codex app-server remains the source of truth for auth. TRAUMA must not persist
"authenticated" as a durable truth in SQLite because that can become stale after
logout, token expiry, app-server restart, or account switching.

Allowed TRAUMA state:

- Process-local pending login metadata: `loginId`, `verificationUrl`, and
  `userCode`, used only while setup is pending.
- Optional process-local short-lived auth status cache, if needed to avoid
  repeated local socket reads during UI polling.
- Non-secret UI messages derived from the latest confirmed app-server state.

If an auth status cache is introduced, keep it narrow:

- Cache only `enabled`, `setup_required`, `disabled`, or `unknown` plus safe
  reason text.
- Use a short TTL measured in seconds.
- Invalidate on `account/login/completed`, `account/updated`, logout, cancel,
  failed connection, and translation start.
- Bypass the cache before scheduling translation work.

For this repair, prefer no persisted auth state and no broad cache. Use
`account/read` as the authoritative check, with `refreshToken: false` for UI
status polling and a deliberate forced refresh only where the translation
preflight needs it.

## Implementation Steps

1. Regenerate and inspect the installed app-server schema.
   - Run `codex --version`.
   - Run `codex app-server generate-json-schema --out <tmpdir>`.
   - Confirm `account/read`, `account/login/start`,
     `account/login/completed`, and `account/updated` method names.
   - Record the Codex CLI version and schema facts in the PR notes.

2. Add failing auth interpretation tests.
   - In `tests/server/translation/codex-app-server.test.ts`, cover
     `account/read` returning both `account` and `requiresOpenaiAuth: true`.
   - Expected result: `CodexAppServerClient.checkAuth()` returns
     `{ status: "enabled" }`.
   - Also cover `account: null` with `requiresOpenaiAuth: true`.
   - Expected result: `setup_required` with `auth_required`.

3. Fix auth interpretation.
   - In `CodexAppServerClient.checkAuth()`, treat a non-null account object as
     authenticated before considering `requiresOpenaiAuth`.
   - Treat `requiresOpenaiAuth: true` as auth-required only when no account is
     present.
   - Treat `requiresOpenaiAuth: false` as runnable without additional OpenAI
     auth.
   - Keep unknown payloads as `unknown`, not enabled.

4. Add failing notification tests.
   - In `tests/server/translation/codex-app-server.test.ts`, simulate
     `account/login/completed` and `account/updated` notifications from the
     fake app-server.
   - Expected result: `observeAuthEvents()` yields typed auth events.
   - Include a canceled/failed login event with `success: false` and safe
     `error` text.

5. Fix auth notification parsing.
   - Parse official methods `account/login/completed` and `account/updated`.
   - Preserve strict typed events inside `codex-app-server.ts`; do not expose
     raw app-server notification names to settings or frontend code.
   - Do not mark auth enabled from the notification alone; call `account/read`
     after notification as the confirmation step.

6. Make `account/read` refresh behavior explicit.
   - Extend `checkAuth()` to accept an options object, for example
     `{ refreshToken?: boolean }`.
   - Use `refreshToken: false` by default.
   - Use `refreshToken: false` for Settings status polling.
   - Use a deliberate preflight choice for translation startup. If forced
     refresh is used there, keep it server-only and do not expose token
     material.

7. Add settings service tests for completed login.
   - In `tests/server/settings/codex-auth.test.ts`, create a fake client that
     starts pending login, emits an `account.login.completed` typed event from
     `observeAuthEvents()`, then returns `{ status: "enabled" }` from
     `checkAuth()`.
   - Expected result: pending metadata is cleared and
     `readCodexAuthStatus()` returns enabled.
   - Add a failure path where `success: false` clears pending metadata without
     returning enabled.

8. Add frontend polling tests.
   - In `tests/components/settings-page.test.ts`, cover the flow where
     `submitEnableOpenAiAuth()` returns `login_started`, then
     `/api/settings/codex-auth` later returns `enabled`.
   - Expected UI: pending code panel disappears, button changes to `Enabled`,
     and enabled copy is visible.
   - Keep polling active only while `codexAuth().status === "login_started"`.

9. Implement frontend auth refresh.
   - Add a `submitReadCodexAuth()` helper that calls
     `GET /api/settings/codex-auth`.
   - In `SettingsPage`, start a cleanup-safe interval or backoff loop while
     `login_started`.
   - Abort or ignore stale requests when the component unmounts or auth state
     changes.
   - On enabled, update local state and call `revalidateSettingsState()`.
   - On setup-required while pending metadata is still known server-side, keep
     showing pending state; do not spam failure messages.

10. Align docs and fixture assumptions.
    - Update Task 19 auth text so `requiresOpenaiAuth` is described as provider
      requirement, not a standalone unauthenticated flag.
    - Update notification names to `account/login/completed` and
      `account/updated`.
    - Refresh the focused protocol fixture facts if they currently omit auth
      notifications or encode stale method names.

11. Verify against fake and live app-server paths.
    - Run focused tests:

      ```bash
      mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
      mise exec -- bun run test tests/server/settings/codex-auth.test.ts
      mise exec -- bun run test tests/components/settings-page.test.ts
      mise exec -- bun run test tests/server/routes/api-settings.test.ts
      ```

    - Run full verification:

      ```bash
      mise exec -- bun run verify
      git diff --check
      ```

    - Live smoke with app-server:

      ```bash
      codex app-server --listen unix:///tmp/trauma-codex.sock
      TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:///tmp/trauma-codex.sock mise exec -- bun run dev
      ```

      Complete device-code login, confirm Settings reaches `enabled`, then
      start a translation and confirm it passes the auth preflight.

## Acceptance Criteria

- `account/read` with a non-null `account` is treated as authenticated even
  when `requiresOpenaiAuth` is `true`.
- `account/read` with no account and `requiresOpenaiAuth: true` remains
  setup/auth required.
- `account/login/completed` and `account/updated` notifications are parsed from
  official app-server method names.
- Settings refreshes from `login_started` to `enabled` without a manual page
  reload after device-code completion.
- Translation startup no longer fails auth preflight after device-code
  completion.
- TRAUMA does not persist ChatGPT/OpenAI/Codex tokens or a durable
  authenticated boolean in SQLite.
- UI polling does not force token refresh on every request.
- Focused tests and full `mise exec -- bun run verify` pass.

## PR Handoff

The PR description must include:

- Codex CLI version used for schema verification.
- Official app-server auth fields and notification methods used by the fix.
- Before/after behavior for device-code completion.
- Whether auth status caching was added; if yes, list TTL and invalidation
  triggers.
- Exact verification commands and outcomes.
