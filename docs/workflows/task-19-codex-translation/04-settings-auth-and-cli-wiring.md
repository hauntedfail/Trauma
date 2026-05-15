# 19.4 Settings auth and CLI wiring

## Goal

Wire Codex auth controls into the Task 18 settings page and provide CLI commands for local authentication.

## Files likely owned

- `src/components/settings/SettingsPage.tsx`
- `src/components/settings/settings-loader.ts`
- `src/components/settings/settings-submit.ts`
- `src/routes/api/settings/openai-auth/enable.ts`
- `src/routes/api/settings/openai-auth.ts`
- `src/server/settings/codex-auth.ts`
- `scripts/trauma-codex-auth.ts`
- `package.json`
- `tests/server/routes/api-settings.test.ts`
- `tests/components/settings-page.test.tsx`
- `tests/scripts/trauma-codex-auth.test.ts`

## Settings UI contract

Task 18 settings page already owns the OpenAI/Codex auth field.

Enable button:

- disabled state label: `Enable`
- enabled state label: `Enabled`
- enabled state button is disabled
- enabled state shows hint text
- enabled state shows danger `Delete auth` button

Task 19 changes the backend behind that UI from placeholder auth state to Codex-backed auth state.

## Auth start behaviour

Official docs say `codex login` opens a browser flow.

Implementation options:

1. Settings button starts a local server-side `codex login` process and reports status.
2. Settings button returns a command and instructions if the app cannot safely manage the interactive login process.
3. Settings button uses device-code auth only if Codex CLI supports a stable non-interactive flow on the target environment.

Do not invent a direct ChatGPT OAuth URL flow unless Codex documents a supported interface.

## CLI command contract

Add Bun commands:

```sh
bun run trauma:codex-login
bun run trauma:codex-login:device
bun run trauma:codex-status
```

Expected behaviour:

- `trauma:codex-login` runs `codex login`.
- `trauma:codex-login:device` runs `codex login --device-auth`.
- `trauma:codex-status` checks whether Codex auth is usable without printing secrets.

If package scripts use a different naming convention, follow the repo style.

## Delete auth contract

Deleting auth from the UI must remove or invalidate TRAUMA's Codex auth state.

Because official docs emphasize Codex-managed credential storage, this action must be implemented carefully:

- If Codex exposes a supported logout command, use it.
- If not, clear only TRAUMA metadata and show instructions for manual Codex logout/cache removal.
- Do not delete `~/.codex/auth.json` blindly unless the user configured a TRAUMA-specific `CODEX_HOME` and confirms deletion.

## Tests

Cover:

- settings UI reflects Codex auth status
- enable action does not mark enabled until server verifies Codex
- already-enabled enable request is idempotent
- delete auth does not expose secrets
- CLI scripts invoke the expected Codex command without shell injection

## Verification

```sh
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/components/settings-page.test.tsx
mise exec -- bun run test tests/scripts/trauma-codex-auth.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Settings UI can drive Codex auth status.
- CLI login/status commands exist.
- No raw credential material is stored or displayed.

