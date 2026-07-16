# Task 21.1: Codex Default Persistence Contract

## Goal

Make Codex translation model and reasoning effort defaults an explicit
DB-backed settings contract before touching reader popover UI.

## Ownership

Primary files:

- Modify `src/server/db/schema.ts`
- Modify `src/server/db/repositories.ts`
- Modify `src/server/settings/settings.ts`
- Modify `tests/server/db/schema.test.ts`
- Modify `tests/server/settings/settings.test.ts`
- Modify `tests/server/translation/translation-repositories.test.ts`
- Modify `docs/architecture/data-and-storage.md`
- Modify `docs/references/configuration.md` only if the docs currently omit the
  persisted settings fields.

Do not modify `src/components/reader/MemoryReader.tsx` in this subtask.

## Contract

The durable default state lives in SQLite settings:

- `app_settings.codex_translation_model`
  - nullable text
  - `null` means Codex app-server default model
  - non-null values should be normalized to the catalog `model` string when the
    current catalog is available
- `app_settings.codex_translation_reasoning_effort`
  - nullable text
  - `null` means selected-model default effort
  - non-null values must be one of the shared `CodexReasoningEffort` values

Each translation job also records the resolved runtime choice:

- `translation_jobs.model`
- `translation_jobs.reasoning_effort`

Settings defaults and job-attempt status are related but separate:

- Updating the default affects future popover selections and future jobs.
- A completed or failed job keeps the resolved values it used at creation.
- Changing defaults must not rewrite existing `translation_jobs` rows.

## Implementation Steps

1. Add failing persistence tests that write `codexTranslationModel: "gpt-5.5"`
   and `codexTranslationReasoningEffort: "high"` through the settings
   repository, then read settings back and expect the same values.
2. Add failing tests that update only one default and preserve the other value.
   For example, updating `model: "gpt-5.5"` without an effort must leave an
   existing `codexTranslationReasoningEffort: "medium"` unchanged.
3. Add failing schema tests that reject unsupported
   `codex_translation_reasoning_effort` values.
4. Add failing translation repository tests that a created job records the
   resolved `model` and `reasoning_effort`, and that later settings updates do
   not mutate the job row.
5. If the columns and repository methods already exist, tighten tests around the
   exact default-state semantics instead of adding a new migration.
6. If any column is missing on the branch being executed, add a Drizzle
   migration and update bundled migrations before implementation continues.
7. Update data/storage docs to state that settings defaults are current UI state
   while job rows are historical attempt state.

## Tests

Run:

```bash
mise exec -- bun run test tests/server/settings/settings.test.ts tests/server/db/schema.test.ts tests/server/translation/translation-repositories.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- DB-backed settings can persist and read the selected model and reasoning
  effort.
- Partial settings updates preserve omitted default fields.
- Unsupported persisted effort values are rejected by schema or repository
  boundaries.
- Translation job rows keep the resolved model/effort used for that attempt.
- No reader UI code is changed in this subtask.
