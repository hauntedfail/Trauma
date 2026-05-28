# Task 21.4: Translation Integration Regression Checks

## Goal

Verify that the translation popover UI repair preserves the existing translation
API integration, progress handling, and variant visibility rules.

## Ownership

Primary files:

- Modify `tests/components/memory-reader-actions.test.ts`
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
- Submit sends `POST /api/memories/:memory_id/translations`.
- The request body contains:
  - `lang_code`
  - `model`
  - `reasoning_effort`
- Empty model is sent as `null`.
- Empty reasoning effort is sent as `null`.
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
2. Add assertions that the submit path still calls `startReaderTranslation()`
   with `model` and `reasoningEffort` mapped from empty strings to `null`.
3. Add assertions that stable error-code branching still includes
   `translation_language_required`, `translation_language_mismatch`,
   `translation_model_unavailable`, `translation_reasoning_effort_unavailable`,
   `auth_required`, `setup_required`, `app_server_unavailable`,
   `app_server_protocol_error`, `translation_unavailable`, `timeout`,
   `stream_disconnected`, `invalid_final_output`, `stale_source`,
   `usage_limit`, `context_overflow`, and `validation_failed`.
4. Add Playwright coverage in `e2e/reader.spec.ts` only if existing browser
   tests cannot open the reader translation popover and click outside it.
5. If backend tests fail, inspect the failure before changing server code; this
   branch should be UI-first unless the integration contract is already broken.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/memory-reader-actions.test.ts
mise exec -- bun run test tests/server/translation/api-routes.test.ts tests/server/translation/runner.test.ts
mise exec -- bun run test:e2e e2e/reader.spec.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- UI cancel paths never start translation.
- Submit still reaches the existing translation API with the same payload
  semantics.
- Progress and completion handling remain unchanged after the `Popup`
  migration.
- Trigger visibility still respects source/translation variant state.
- Any backend change made in this subtask is justified by a failing integration
  test, not by the visual refactor itself.
