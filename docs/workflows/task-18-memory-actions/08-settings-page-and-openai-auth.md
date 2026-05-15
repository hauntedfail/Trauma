# 18.8 Settings page and OpenAI auth state

## Goal

Add `/settings` as part of Task 18. The page owns translation target language configuration and OpenAI auth state controls.

This is intentionally not Task 19. It is part of the same user-facing memory workspace expansion as Task 18.

## Files likely owned

- `src/routes/settings.tsx`
- `src/components/settings/SettingsPage.tsx`
- `src/components/settings/settings-loader.ts`
- `src/components/settings/settings-submit.ts`
- `src/components/shell/AppShell.tsx`
- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/server/settings/settings.ts`
- `src/server/settings/openai-auth.ts`
- `src/routes/api/settings.ts`
- `src/routes/api/settings/translation-language.ts`
- `src/routes/api/settings/openai-auth/enable.ts`
- `src/routes/api/settings/openai-auth.ts`
- `tests/server/settings/settings.test.ts`
- `tests/server/routes/api-settings.test.ts`
- `tests/components/settings-page.test.tsx`

## Product contract

Create a new settings page:

```text
/settings
```

The first settings fields are:

- Translation target language
- OpenAI Auth

## Translation target language

Render a select menu for translation target language.

Rules:

- The select menu lists supported language kinds.
- The selected value persists through the settings API.
- The selected value reloads correctly after refresh.
- Invalid language values are rejected by the API.
- Server validation is authoritative.

Recommended initial language options use BCP 47 language codes:

- `ja-JP`: Japanese
- `en-US`: English
- `ko-KR`: Korean
- `zh-CN`: Chinese
- `fr-FR`: French
- `de-DE`: German
- `es-ES`: Spanish
- `it-IT`: Italian
- `pt-BR`: Portuguese

If implementation adds a shared language tuple, both UI and API should import from it.

Canonical API format:

- Persist and return BCP 47 language codes exactly as listed above.
- Do not return ISO 639-1 short codes such as `ja` from settings APIs.
- If implementation accepts a short code for compatibility, normalize it before
  storage and always return the supported BCP 47 value, for example `ja-JP`.

## OpenAI Auth UI

Default disabled state:

- Render a clickable button.
- Button label: `Enable`.
- Clicking calls the OpenAI auth enable API.

Enabled state:

- Render the same button disabled.
- Button label: `Enabled`.
- Under the field, render hint text that communicates OpenAI auth is enabled.
- Render a danger-styled `Delete auth` button to the right of the disabled `Enabled` button.

## OpenAI Auth API validation

Frontend disabled state is not a security boundary.

If a direct API request tries to enable OpenAI auth while auth is already enabled:

- Do not mutate state.
- Do not return an error.
- Return a successful response that explicitly says auth is already enabled.

Recommended response:

```json
{
  "status": "enabled",
  "alreadyEnabled": true,
  "message": "OpenAI auth is already enabled."
}
```

## Data model contract

Add settings persistence if no current equivalent exists.

Recommended schema:

```ts
appSettings: {
  id: "default",
  translationTargetLanguage: SupportedLanguageCode,
  createdAt: Date,
  updatedAt: Date
}
```

OpenAI auth state should not be a cosmetic boolean if real credentials are involved.

Recommended design:

- Store non-secret settings in an app settings singleton row.
- Store OpenAI auth credential material separately from non-secret settings.
- API responses expose only status, never credential material.
- `openaiAuthStatus` is derived from credential presence/validity, not trusted from a client-submitted flag.

If the project does not yet have a real OpenAI auth provider:

- Implement the settings page and API boundary.
- Keep credential handling behind a small server adapter.
- Do not fake an enabled status without a stored/validated auth record.
- If enable cannot complete because provider configuration is missing, return a clear `not_configured` response.

## API contract

### Read settings

```http
GET /api/settings
```

Response:

```json
{
  "translationTargetLanguage": "ja-JP",
  "openaiAuth": {
    "status": "disabled"
  }
}
```

or:

```json
{
  "translationTargetLanguage": "ja-JP",
  "openaiAuth": {
    "status": "enabled"
  }
}
```

### Update translation target language

```http
PATCH /api/settings/translation-language
content-type: application/json

{
  "language": "ja-JP"
}
```

Responses:

- `200` with updated settings
- `400` for malformed body
- `400` for unsupported language

### Enable OpenAI auth

```http
POST /api/settings/openai-auth/enable
```

Responses:

- `200` with `{ "status": "enabled", "alreadyEnabled": false }` after a successful enable operation
- `200` with `{ "status": "enabled", "alreadyEnabled": true, "message": "OpenAI auth is already enabled." }` if already enabled
- `409` or `503` with a clear `not_configured`-style response when auth cannot be enabled because a real provider/configuration is unavailable

Security rule:

- The route must load current auth state server-side before mutation.
- If already enabled, return the idempotent already-enabled response and do not overwrite credential state.
- If no real auth provider exists yet, do not create a cosmetic enabled row.
  Return `not_configured` and keep status disabled.

### Delete OpenAI auth

```http
DELETE /api/settings/openai-auth
```

Responses:

- `200` with `{ "status": "disabled" }` after deleting auth
- `200` with `{ "status": "disabled", "alreadyDisabled": true }` if no auth existed

Rules:

- Require a deliberate UI action from the danger button.
- Do not return deleted credential data.
- Deleting auth should only remove OpenAI auth state, not other settings.

## UI contract

Navigation:

- Add `Settings` to the app shell navigation.
- Route path is `/settings`.

Page layout:

- Use the existing app shell and project visual language.
- Do not redesign the global shell as part of this subtask.
- Keep fields grouped and readable.

Translation field:

- Label clearly describes translation target language.
- Select menu contains supported language options.
- Persist on change or via an explicit save action. Prefer explicit save if current form patterns expect it; otherwise on-change is acceptable if error handling is clear.
- Show inline failure text if API update fails.

OpenAI Auth field:

- Disabled state:
  - button label `Enable`
  - button clickable
  - no `Delete auth` button

- Enabled state:
  - disabled button label `Enabled`
  - hint text under field, for example `OpenAI auth is enabled.`
  - danger `Delete auth` button immediately to the right of the disabled button

Delete auth:

- Use danger styling.
- Confirm before deleting if the project already uses confirmation patterns.
- On success, update UI to disabled state.

## Backend service contract

Repository/service methods:

```ts
getSettings(): Promise<AppSettings>
updateTranslationTargetLanguage(language: SupportedLanguageCode): Promise<AppSettings>
getOpenAiAuthStatus(): Promise<"disabled" | "enabled">
enableOpenAiAuth(): Promise<{ status: "enabled"; alreadyEnabled: boolean }>
deleteOpenAiAuth(): Promise<{ status: "disabled"; alreadyDisabled: boolean }>
```

Validation:

- Shared supported-language guard.
- Request body shape validation.
- Idempotent OpenAI auth enable validation.
- Auth enable route must not overwrite enabled auth state.
- No API response may include secrets.

## Tests

Backend tests:

- settings singleton initializes with default translation target language
- valid translation language update persists
- unsupported translation language is rejected
- malformed translation body is rejected
- OpenAI auth enable succeeds from disabled state only when a real provider or stored auth record is available
- OpenAI auth enable from disabled state returns `not_configured` without enabling auth when no provider exists
- OpenAI auth enable while already enabled returns `alreadyEnabled: true`
- OpenAI auth enable while already enabled does not overwrite auth state
- OpenAI auth delete succeeds from enabled state
- OpenAI auth delete from disabled state returns `alreadyDisabled: true`
- settings API never returns credential material

Frontend/component tests:

- `/settings` renders translation language select
- language select shows all supported language kinds
- disabled OpenAI auth state renders clickable `Enable`
- enabled OpenAI auth state renders disabled `Enabled`
- enabled state renders hint text
- enabled state renders danger `Delete auth` button
- delete auth success returns UI to disabled state
- enable already-enabled response keeps UI enabled without surfacing an error

## Verification

```sh
mise exec -- bun run test tests/server/settings/settings.test.ts
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/components/settings-page.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- `/settings` route exists.
- App navigation exposes Settings.
- Translation target language is selectable and persisted.
- Settings APIs persist and return BCP 47 language codes such as `ja-JP`.
- Unsupported languages are rejected server-side.
- OpenAI auth disabled state shows clickable `Enable`.
- OpenAI auth enabled state shows disabled `Enabled`, enabled hint text, and danger `Delete auth`.
- Direct API enable requests while already enabled return a successful already-enabled response and do not mutate credential state.
- If no real OpenAI auth provider exists, enable returns a clear not-configured response and does not fake enabled state.
- Deleting OpenAI auth removes only auth state.
- No secret material is rendered or returned by the settings API.
