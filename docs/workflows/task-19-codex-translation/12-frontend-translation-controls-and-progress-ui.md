# 19.12 Frontend translation controls and progress UI

## Goal

Add reader controls for starting Brilliant translation and showing streaming progress.

## Files likely owned

- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/TranslationControls.tsx`
- `src/components/reader/TranslationProgress.tsx`
- `tests/components/reader-translation-controls.test.tsx`
- `tests/components/reader-translation-progress.test.tsx`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/04-api-and-sse.md`

## Rendering contract

Reader UI shows:

- selected target language from persisted settings/page data
- settings-required state when no target language exists
- auth/setup-required state when Codex cannot run
- translate action when ready
- current chunk index and total chunk count while running
- live Codex delta transcript labelled as progress, not saved content
- validation and retry events
- committing state
- completion action to open translated reader variant
- actionable failure state

## Start behaviour

1. Read configured `lang_code` from page/settings data.
2. POST `/api/memories/:memory_id/translations` with `{}` or with `lang_code` as a consistency assertion.
3. If `202`, open the returned `event_url`.
4. If `200 running`, open the returned `event_url` for the active job.
5. If `200 current`, navigate to `/memories/:id?lang=<lang_code>`.
6. If `409 translation_language_required`, link to `/settings`.
7. If `409 translation_language_mismatch`, refresh settings state and ask the user to retry.
8. If `409 setup_required`, show Codex auth setup guidance.

## Tests

Cover:

- target language renders from persisted settings value
- missing language renders settings-required state
- auth unavailable renders setup-required state
- click starts translation API request
- `202` opens SSE progress
- `200 running` opens SSE progress for the reused active job
- `200 current` navigates to translated variant
- progress shows chunk count and current chunk
- delta transcript is labelled non-authoritative
- retry event renders visibly
- failure message is actionable and does not expose secrets

## Verification

```sh
mise exec -- bun run test tests/components/reader-translation-controls.test.tsx
mise exec -- bun run test tests/components/reader-translation-progress.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Reader can start translation from UI.
- UI uses SQLite-backed settings state through backend/page data.
- UI never talks to Codex app-server directly.
- UI does not present partial deltas as saved translation.
