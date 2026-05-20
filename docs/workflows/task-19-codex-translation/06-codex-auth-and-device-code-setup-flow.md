# 19.6 Codex auth and device-code setup flow

## Goal

Expose Codex managed ChatGPT sign-in state through TRAUMA settings without TRAUMA owning credential material.

## Files likely owned

- `src/server/settings/codex-auth.ts`
- settings API routes created by Task 18
- `src/components/settings/SettingsPage.tsx`
- `tests/server/settings/codex-auth.test.ts`
- `tests/components/settings-codex-auth.test.tsx`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/04-api-and-sse.md`
- `contracts/06-codex-prompt-and-validation.md`

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

## Enable/delete behaviour

- Enable does not mark auth as enabled until the server verifies Codex can run an authenticated operation.
- If provider setup is missing, return a normal `setup_required` or `not_configured` response rather than a fake enabled state.
- Already-enabled enable requests are idempotent.
- Delete auth clears only TRAUMA-owned metadata unless Codex exposes a supported logout flow or an app-specific Codex home was explicitly configured and confirmed.

## Tests

Cover:

- auth status disabled, enabled, setup-required, unknown, and error
- enable verifies server-side auth before marking enabled
- provider-missing enable does not fake enabled state
- already-enabled enable is idempotent
- device-code response contains only safe fields
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
- Task 18 target-language settings remain independent from auth metadata.
