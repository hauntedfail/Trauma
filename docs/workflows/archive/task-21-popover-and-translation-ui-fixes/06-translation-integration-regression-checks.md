# Task 21.6: Translation Integration Regression Checks

## Goal

Verify that the translation popover UI repair preserves settings persistence,
translation API integration, progress handling, and variant visibility rules.

## Ownership

Primary files:

- Modify `tests/components/memory-reader-actions.test.ts`
- Modify `tests/server/routes/api-settings.test.ts`
- Modify `tests/server/translation/api-routes.test.ts` only if a component test
  exposes a request/response contract mismatch
- Modify `tests/server/translation/runner.test.ts` only if a component test
  exposes a job snapshot/progress contract mismatch
- Modify `e2e/reader.spec.ts` if browser coverage for translation popover
  open/cancel/submit is missing

Do not change backend translation contracts unless the tests reveal an actual
integration regression.

## Integration Contract

The reader translation popover must preserve these existing contracts:

- The first trigger click opens settings and does not start translation.
- A remembered DB-backed model and effort seed the select menus when the popover
  opens.
- A successful submit with explicit model/effort persists those defaults for
  future reader openings.
- Submit sends `POST /api/memories/:memory_id/translations`.
- The request body contains:
  - `lang_code`
  - `model`
  - `reasoning_effort`
- Empty model is sent as `null`.
- Empty reasoning effort is sent as `null`.
- Non-empty model is sent and persisted using the canonical catalog `model`
  value, for example `gpt-5.5`.
- `202` starts SSE progress through the returned `event_url`.
- `200 active` starts SSE progress through the reused active job `event_url`.
- `200 current` navigates to `reader_url`.
- API failures branch on stable `code` values.
- The browser never calls Codex app-server directly.
- Completed target variants still hide the source-reader translation trigger.
- Translated reader routes still hide the translation trigger.

Cancel paths must preserve these integration boundaries:

- Cancel button does not call `fetch`.
- Outside pointer dismissal does not call `fetch`.
- Escape dismissal does not call `fetch`.
- Cancel paths do not create or close translation `EventSource` instances.

## Implementation Steps

1. Extend `tests/components/memory-reader-actions.test.ts` so the source and
   rendered contracts distinguish open/cancel from submit.
2. Add assertions that remembered `translationModel` and
   `translationReasoningEffort` props seed the selected `<select>` options.
3. Add assertions that a successful submit refreshes/revalidates settings state
   or otherwise uses the returned persisted defaults for future opens.
4. Add assertions that the submit path still calls `startReaderTranslation()`
   with `model` and `reasoningEffort` mapped from empty strings to `null`.
5. Add assertions that stable error-code branching still includes
   `translation_language_required`, `translation_language_mismatch`,
   `translation_model_unavailable`, `translation_reasoning_effort_unavailable`,
   `auth_required`, `setup_required`, `app_server_unavailable`,
   `app_server_protocol_error`, `translation_unavailable`, `timeout`,
   `stream_disconnected`, `invalid_final_output`, `stale_source`,
   `usage_limit`, `context_overflow`, and `validation_failed`.
6. Add API assertions that persisted defaults are visible through the settings
   read route after translation submit or settings PATCH.
7. Add Playwright coverage in `e2e/reader.spec.ts` only if existing browser
   tests cannot open the reader translation popover and click outside it.
8. If backend tests fail, inspect the failure before changing server code; this
   branch should be UI-first unless the integration contract is already broken.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/memory-reader-actions.test.ts
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/server/translation/api-routes.test.ts tests/server/translation/runner.test.ts
mise exec -- bun run test:e2e e2e/reader.spec.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- UI cancel paths never start translation.
- Submit still reaches the existing translation API with the same payload
  semantics.
- Explicit selected model/effort values persist to DB-backed defaults and seed
  future popover opens.
- Progress and completion handling remain unchanged after the `Popup`
  migration.
- Trigger visibility still respects source/translation variant state.
- Any backend change made in this subtask is justified by a failing integration
  test, not by the visual refactor itself.
