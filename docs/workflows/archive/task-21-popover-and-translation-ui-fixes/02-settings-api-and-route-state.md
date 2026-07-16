# Task 21.2: Settings API and Route State

## Goal

Ensure settings API routes validate remembered Codex defaults and reader routes
receive fresh persisted defaults for the translation popover.

## Ownership

Primary files:

- Modify `src/server/settings/codex-model-routes.ts`
- Modify `src/components/settings/settings-submit.ts`
- Modify `src/components/settings/settings-loader.ts`
- Modify `src/routes/api/settings/translation-codex-defaults.ts`
- Modify `src/routes/memories/[id].tsx`
- Modify `src/components/reader/reader-memory-loader.ts` only if route data
  currently drops persisted translation defaults.
- Modify `tests/server/routes/api-settings.test.ts`
- Modify `tests/components/settings-page.test.ts`
- Modify `tests/components/reader-memory-loader.test.ts` or
  `tests/server/reader/page-data.test.ts`, depending on where the route-state
  contract is enforced.

Do not change shared popover chrome in this subtask.

## Contract

Settings API:

- `PATCH /api/settings/translation-codex-defaults` accepts `model` and
  `reasoning_effort`.
- Omitted fields preserve current DB values.
- `null` model resets to Codex app-server default model.
- `null` reasoning effort resets to selected-model default effort.
- Non-null model must exist in the current Codex app-server catalog.
- Non-null reasoning effort must be supported by the selected or persisted model.
- Successful PATCH returns the persisted `codexTranslationModel` and
  `codexTranslationReasoningEffort` values after normalization.

Reader route state:

- Source reader pages pass `translationModel` and
  `translationReasoningEffort` from DB settings into `MemoryReader`.
- The values must reflect the latest successful settings/default update, not a
  stale initial app load snapshot.
- If a user selects `gpt-5.5` and `high`, closes the popover after a successful
  translation start, then opens another source reader page, the popover should
  seed `gpt-5.5` and `high`.

## Implementation Steps

1. Add failing API tests that PATCH `{ "model": "gpt-5.5",
   "reasoning_effort": "high" }` and assert the response and subsequent
   settings read both return those values.
2. Add failing API tests for partial updates:
   - PATCH `{ "model": "gpt-5.5" }` preserves existing effort.
   - PATCH `{ "reasoning_effort": "medium" }` preserves existing model.
   - PATCH `{ "model": null }` resets only the model.
   - PATCH `{ "reasoning_effort": null }` resets only the effort.
3. Add failing API tests for catalog mismatch:
   - unavailable model returns `translation_model_unavailable`
   - unsupported effort for the selected model returns
     `translation_reasoning_effort_unavailable`
4. Add failing route-state tests showing reader page data includes persisted
   `codexTranslationModel` and `codexTranslationReasoningEffort`.
5. Ensure server-side route data reads current settings from SQLite at the
   reader route boundary.
6. If SolidStart cache invalidation is needed after PATCH or translation start,
   use the existing revalidation helper pattern rather than adding ad-hoc global
   state.
7. Keep browser code talking only to TRAUMA settings/translation routes, never
   directly to Codex app-server.

## Tests

Run:

```bash
mise exec -- bun run test tests/server/routes/api-settings.test.ts tests/components/settings-page.test.ts tests/components/reader-memory-loader.test.ts tests/server/reader/page-data.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Settings API persists normalized model and effort defaults.
- Omitted PATCH fields preserve existing DB state.
- Reader route data exposes current persisted defaults to `MemoryReader`.
- No browser code calls Codex app-server directly.
- Shared popover visual code remains unchanged in this subtask.
