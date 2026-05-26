# Task 19T: Codex Translation Model Controls Workflow

## Goal

Add user-controlled Codex translation model and reasoning effort defaults to
Settings, then route source-reader translation through a confirmation popup that
shows the selected model, effort, and language before scheduling Codex-backed
translation.

## Status

- State: Repair workflow draft, tied to Task 19 but separate from the original
  Task 19 execution plan, Task 19R auth repair, and Task 19S protocol repair.
- Base workflow: [Task 19 Codex translation](task-19-codex-translation.md)
- Related repairs:
  [Task 19R Codex app-server auth repair](task-19-codex-translation-auth-repair.md),
  [Task 19S Codex app-server protocol repair](task-19-codex-translation-protocol-repair.md)
- Primary external reference:
  [OpenAI: Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- Local protocol reference: the installed Codex app-server `model/list`,
  `config/read`, and generated schema for the exact app-server version under
  test.

## Required Context

- [Documentation index](../INDEX.md)
- [Task 19 overview](task-19-codex-translation.md)
- [Task 19 app-server integration](task-19-codex-translation/05-codex-app-server-integration.md)
- [Task 19 frontend translation controls and progress UI](task-19-codex-translation/12-frontend-translation-controls-and-progress-ui.md)
- [Task 19 error handling and cancellation](task-19-codex-translation/15-error-handling-and-cancellation.md)
- [Task 19 test plan and fixtures](task-19-codex-translation/16-test-plan-and-fixtures.md)
- [Configuration reference](../references/configuration.md)
- [Design system reference](../references/design-system/DESIGN.md)
- [Verification strategy](../quality/verification.md)
- [Coding standards](../references/coding-standards/INDEX.md)

## Current Behavior To Replace

Current source-reader translation is too implicit:

1. Settings stores only `translation_target_language` and Codex auth state.
2. The source-reader Codex icon starts translation on the first click.
3. The reader sends only `{ "lang_code": "<configured language>" }` to
   `POST /api/memories/:memory_id/translations`.
4. `translation_jobs.model` exists but new jobs currently store `null`.
5. There is no persisted reasoning effort column.
6. `CodexAppServerClient.translateChunk()` sends only prompt, output schema, and
   sandbox/thread settings to `turn/start`; it does not pass model or reasoning
   effort.

The repaired flow must make model, effort, and language visible before the job
starts, while preserving one-click access to the popup trigger.

## Confirmed App-Server Facts

Codex app-server is the source of truth for available model choices. TRAUMA must
not hardcode a fixed model list.

Observed local app-server `model/list` shape includes:

- `id`
- `displayName`
- `description`
- `isDefault`
- `supportedReasoningEfforts`
- `defaultReasoningEffort`

Observed local app-server `config/read` includes model-related settings such as
`model` and profile-level reasoning effort values.

The OpenAI app-server integration article describes Codex app-server as exposing
model discovery and configuration management. This means TRAUMA should ask the
connected app-server for model metadata and treat that catalog as version,
configuration, and account dependent.

## Product And UX Decisions

Settings owns defaults:

- Persist the user's default Codex translation model in TRAUMA settings.
- Persist the user's default Codex translation reasoning effort in TRAUMA
  settings.
- Use `null` model as "Codex app-server default".
- Use `null` reasoning effort as "selected model default".
- Persist only non-secret choices. Do not persist ChatGPT, Codex, OpenAI access,
  or refresh tokens.

Reader owns per-translation confirmation:

- The current translation button must not start translation on click.
- Hovering the button expands only its width, keeps the Codex icon left-aligned,
  and reveals `Translate` text with CSS transition.
- Clicking the expanded trigger opens a popup/dialog.
- The popup shows model, reasoning effort, and target language before the job is
  scheduled.
- The popup's `Translate` button is the submit action that starts translation.
- If the user changes model, effort, or language in the popup, TRAUMA saves those
  choices as the new defaults and uses the same values for the submitted job.
- The popup submit button uses a 50% transparent visual treatment.
- The translation progress component uses the same transparent visual language.

Do not show the translation trigger on translated reader routes or when the
configured target variant already exists.

## Ownership

Primary implementation files:

- `src/server/translation/codex-app-server.ts`
- `src/server/translation/runner.ts`
- `src/server/translation/start-translation-route.ts`
- `src/server/translation/types.ts`
- `src/server/settings/settings.ts`
- `src/server/db/schema.ts`
- `src/server/db/repositories.ts`
- `src/components/settings/SettingsPage.tsx`
- `src/components/settings/settings-loader.ts`
- `src/components/settings/settings-submit.ts`
- `src/components/reader/MemoryReader.tsx`

Routes to add or update:

- Add `src/routes/api/settings/codex-models.ts` or an equivalent settings-scoped
  model catalog route.
- Add `src/routes/api/settings/translation-codex-defaults.ts` or an equivalent
  settings-scoped default update route.
- Update `src/routes/api/memories/[memoryId]/translations.ts`.

Database files:

- Add one new Drizzle SQL migration under `drizzle/`.
- Update the latest Drizzle metadata snapshot.
- Update `src/server/db/bundled-migrations.ts`.

Primary tests:

- `tests/server/translation/codex-app-server.test.ts`
- `tests/server/translation/runner.test.ts`
- `tests/server/translation/api-routes.test.ts`
- `tests/server/translation/translation-repositories.test.ts`
- `tests/server/settings/settings.test.ts`
- `tests/server/routes/api-settings.test.ts`
- `tests/components/settings-page.test.ts`
- `tests/components/memory-reader-actions.test.ts`
- `tests/server/db/schema.test.ts`

Documentation to update only where it currently describes the older implicit
translation trigger or omits model and effort persistence:

- `docs/workflows/task-19-codex-translation.md`
- `docs/workflows/task-19-codex-translation/05-codex-app-server-integration.md`
- `docs/workflows/task-19-codex-translation/12-frontend-translation-controls-and-progress-ui.md`
- `docs/workflows/task-19-codex-translation/15-error-handling-and-cancellation.md`
- `docs/workflows/task-19-codex-translation/16-test-plan-and-fixtures.md`
- `docs/references/configuration.md`, only if new configuration behavior is
  introduced. Do not add model names there.

## Out Of Scope

- Starting, supervising, or auto-installing Codex app-server from TRAUMA.
- Direct OpenAI model-list calls from TRAUMA.
- Replacing Codex app-server with OpenAI Responses API, Codex SDK, or
  `codex exec`.
- Storing ChatGPT, Codex, OpenAI access, or refresh tokens in TRAUMA.
- Making completed translation identity depend on model or effort.
- Re-translating automatically when the user changes the default model or
  effort.
- Per-memory saved model presets beyond the single global default.
- Reworking translation chunking, prompt policy, stitching, or translated reader
  rendering except where required to pass selected model and effort through the
  existing job pipeline.

## Data Model Decision

Add these fields to `app_settings`:

- `codex_translation_model text null`
- `codex_translation_reasoning_effort text null`

Allowed reasoning effort values:

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

Keep both nullable:

- `codex_translation_model = null` means app-server default model.
- `codex_translation_reasoning_effort = null` means selected model default
  effort.

Add this field to `translation_jobs`:

- `reasoning_effort text null`

Keep the existing `translation_jobs.model` column and write the effective
selected model string or `null` when the job uses app-server default. Write
`translation_jobs.reasoning_effort` similarly.

Do not change `translation_jobs_current_complete_idx`. A completed translation
is still current by memory, language, source hash, prompt policy version, and
chunker version. Model and effort are execution metadata, not output identity.

## App-Server Catalog Contract

Add a server-side catalog reader that calls app-server `model/list` after
initialization. The browser must not talk to app-server directly.

Normalize the response before it reaches frontend code:

```json
{
  "models": [
    {
      "id": "gpt-5.5",
      "displayName": "GPT-5.5",
      "description": "Frontier model...",
      "isDefault": true,
      "supportedReasoningEfforts": ["low", "medium", "high", "xhigh"],
      "defaultReasoningEffort": "medium"
    }
  ]
}
```

The normalized route may omit hidden or non-text models if app-server returns
them. If a selected model is hidden but app-server still accepts it, do not
surface it as a normal choice unless the app-server catalog marks it as visible.

Catalog errors:

- Missing socket or refused connection: `app_server_unavailable`.
- Auth/setup required: reuse existing auth/setup error codes.
- Invalid `model/list` response: `app_server_protocol_error`.

Settings UI should render a readable unavailable state when the catalog cannot be
loaded, while leaving auth controls and language settings usable.

## Request Schema Decision

Extend the reader start request body from:

```json
{ "lang_code": "ja-JP" }
```

to:

```json
{
  "lang_code": "ja-JP",
  "model": "gpt-5.5",
  "reasoning_effort": "medium"
}
```

`model` and `reasoning_effort` may be omitted or `null` to use defaults.

Server validation rules:

1. `lang_code` must match the saved or submitted supported target language.
2. `model` must be a string from the current app-server catalog, or `null`.
3. `reasoning_effort` must be one of the selected model's
   `supportedReasoningEfforts`, or `null`.
4. If the model is unavailable, return `translation_model_unavailable`.
5. If the effort is unavailable for that model, return
   `translation_reasoning_effort_unavailable`.
6. Do not silently fall back to another model or effort after the user explicitly
   submits a popup choice.

## Implementation Steps

1. Regenerate and inspect the installed app-server schema.
   - Run `codex --version`.
   - Run `codex app-server generate-json-schema --out <tmpdir>`.
   - Confirm `model/list` response shape.
   - Confirm whether `turn/start` accepts `model` and `effort` in the
     stable schema for the installed version.
   - Record the Codex version and schema facts in the PR notes.

2. Add failing model catalog tests.
   - In `tests/server/translation/codex-app-server.test.ts`, fake `model/list`
     returning multiple models and efforts.
   - Expected result: the client exposes normalized model catalog records.
   - Add invalid payload coverage where `model/list` returns malformed model
     rows.
   - Expected result: `app_server_protocol_error`.

3. Implement model catalog client support.
   - Add typed model catalog structures to
     `src/server/translation/codex-app-server.ts`.
   - Add `listModels()` or an equivalent method on the app-server client.
   - Keep parsing strict enough to catch protocol drift, but tolerant of extra
     app-server fields.

4. Add failing settings persistence tests.
   - In `tests/server/settings/settings.test.ts`, assert default settings include
     `codexTranslationModel: null` and
     `codexTranslationReasoningEffort: null`.
   - Assert updating model and effort persists both values.
   - Assert setting either value back to `null` is supported.

5. Add database migration and repository support.
   - Add nullable `codex_translation_model` and
     `codex_translation_reasoning_effort` columns to `app_settings`.
   - Add nullable `reasoning_effort` to `translation_jobs`.
   - Update `src/server/db/schema.ts`, repositories, bundled migrations, and
     Drizzle metadata.
   - Preserve existing settings rows without forcing a model choice.

6. Add settings API coverage and handlers.
   - Add or extend settings API tests so model/effort defaults can be saved
     independently of language.
   - Add a settings-scoped model catalog route that returns normalized
     `model/list` data.
   - Add a settings-scoped defaults route that validates against the current
     catalog before saving submitted model and effort.

7. Extend translation start API tests.
   - In `tests/server/translation/api-routes.test.ts`, assert the start route
     accepts `lang_code`, `model`, and `reasoning_effort`.
   - Assert unknown keys are still rejected.
   - Assert invalid model maps to `translation_model_unavailable`.
   - Assert invalid effort maps to
     `translation_reasoning_effort_unavailable`.

8. Implement translation start validation.
   - Extend `parseStartTranslationPayload()`.
   - Extend `startTranslationJob()` input with optional model and reasoning
     effort.
   - Validate submitted values against app-server `model/list` before creating a
     job.
   - Save accepted values as the new settings defaults and as job metadata.
   - If an active job already exists, return it without rewriting its model or
     effort.

9. Add runner and Codex payload tests.
   - In `tests/server/translation/runner.test.ts`, assert newly created jobs
     store model and effort.
   - In `tests/server/translation/codex-app-server.test.ts`, capture
     `turn/start` params and assert selected values are forwarded using the
     field names confirmed by the generated schema.
   - Keep existing sandbox, approval, and output-schema assertions intact.

10. Pass selected model and effort through translation execution.
    - Extend `TranslateChunkInput` with optional selected model and reasoning
      effort.
    - Pass job metadata from `runTranslationJob()` to every chunk attempt.
    - Add model and effort fields to `turn/start` only when non-null.
    - Do not add experimental app-server fields unless the generated stable
      schema proves they are required and supported.

11. Add Settings page component coverage.
    - In `tests/components/settings-page.test.ts`, assert model and effort
      controls render from initial settings and catalog state.
    - Assert catalog failure still renders language and auth controls.
    - Assert settings submit helpers call the new defaults endpoint.

12. Implement Settings page controls.
    - Load settings and model catalog through server-safe routes.
    - Render model select with an app-server default option.
    - Render effort select with a selected-model default option.
    - Disable effort choices not supported by the selected model.
    - Save defaults without requiring the user to start a translation.

13. Add reader popup coverage.
    - In `tests/components/memory-reader-actions.test.ts`, assert the source
      reader renders an expandable translation trigger.
    - Assert the trigger no longer calls the translation API directly on the
      first click.
    - Assert popup markup includes model, effort, language, and a submit
      `Translate` button.
    - Assert `startReaderTranslation()` sends `lang_code`, `model`, and
      `reasoning_effort`.

14. Implement reader translation popup.
    - Replace the direct-click source-reader button with a `Popup`-based dialog.
    - Add hover width expansion using CSS transition without layout jumps.
    - Keep icon left-aligned and reveal `Translate` text on hover/focus.
    - Show current language, model, and effort inside the popup.
    - On submit, save changed defaults and start translation with the same
      values.
    - Close the popup only after a successful queue/current response or keep it
      open with an inline error if validation fails.

15. Apply transparent translation visual treatment.
    - Update popup submit button to use a 50% transparent visual style.
    - Update the translation progress component to use transparent surface
      styling consistent with the popup.
    - Preserve accessible focus states, disabled states, and `aria-live` progress
      behavior.

16. Update frontend error copy.
    - Add user-facing copy for `translation_model_unavailable`.
    - Add user-facing copy for `translation_reasoning_effort_unavailable`.
    - Keep `app_server_unavailable`, `auth_required`, and
      `app_server_protocol_error` meanings aligned with Tasks 19R and 19S.

17. Update focused workflow docs.
    - Update Task 19 frontend controls docs so click opens confirmation instead
      of immediate execution.
    - Update app-server integration docs so model catalog comes from
      `model/list`.
    - Update error handling docs with the two new model/effort errors.
    - Do not hardcode current model names in durable docs.

18. Verify focused tests.
    - Run:

      ```bash
      mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
      mise exec -- bun run test tests/server/settings/settings.test.ts
      mise exec -- bun run test tests/server/translation/api-routes.test.ts
      mise exec -- bun run test tests/server/translation/runner.test.ts
      mise exec -- bun run test tests/server/routes/api-settings.test.ts
      mise exec -- bun run test tests/components/settings-page.test.ts
      mise exec -- bun run test tests/components/memory-reader-actions.test.ts
      mise exec -- bun run test tests/server/db/schema.test.ts
      ```

    - Expected: all focused tests pass.

19. Verify full project health.
    - Run:

      ```bash
      mise exec -- bun run verify
      git diff --check
      ```

    - Expected: typecheck, unit tests, build, and whitespace checks pass.

20. Live smoke against Codex app-server.
    - Start app-server:

      ```bash
      codex app-server --listen unix:///tmp/trauma-codex.sock
      ```

    - Start TRAUMA:

      ```bash
      TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:///tmp/trauma-codex.sock mise exec -- bun run dev
      ```

    - Open Settings and confirm model/effort controls load from app-server.
    - Save a non-default model and effort if the catalog offers more than one
      choice.
    - Open a source memory with no target variant.
    - Hover the translation trigger and confirm width-only expansion.
    - Click the trigger and confirm the popup appears without starting a job.
    - Submit from the popup and confirm the job starts, progress appears with
      transparent styling, and completion navigates to the translated reader.

## Acceptance Criteria

- Settings exposes Codex translation model and reasoning effort controls.
- Settings values persist in SQLite and default to app-server/model defaults
  when unset.
- TRAUMA obtains model metadata from Codex app-server `model/list`; it does not
  hardcode model names.
- Reader translation trigger expands on hover/focus and opens a popup on click.
- First click on the reader translation trigger does not start translation.
- Popup displays model, reasoning effort, and language before submission.
- Popup submit saves the selected values as defaults and starts the job with the
  same values.
- Translation jobs persist model and reasoning effort metadata.
- Codex `turn/start` receives the selected model and reasoning effort using the
  installed app-server's stable schema.
- Invalid or stale model and effort choices return specific stable errors, not
  generic app-server availability errors.
- Translation progress component uses transparent styling and keeps accessible
  live progress semantics.
- Focused tests and full `mise exec -- bun run verify` pass.

## PR Handoff

The PR description must include:

- Codex CLI/app-server version used for schema verification.
- `model/list` response fields consumed by TRAUMA.
- Confirmed `turn/start` field names used for model and effort.
- Before/after reader translation trigger behavior.
- Database migration summary for settings and translation job metadata.
- Error-code additions and frontend copy.
- Exact verification commands and outcomes.
