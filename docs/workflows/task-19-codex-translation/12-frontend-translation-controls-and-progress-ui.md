# 19.12 Frontend translation controls and progress UI

## Goal

Add reader controls for starting Brilliant translation and showing streaming progress.

## Files likely owned

- `src/components/reader/MemoryReader.tsx`
- `tests/components/memory-reader-actions.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/04-api-and-sse.md`

## Instruction alignment

Scope: source reader translation trigger, progress UI, Codex setup state, and variant tabs.

Inputs: page settings data, current variant metadata, translation API responses, SSE events, and completed `reader_url`.

Outputs: title-edge Codex translation trigger, confirmation popup,
setup/failure/progress states, SSE subscription, and tab navigation for current
variants.

Dependencies: 19.7 freezes event payloads; 19.13 provides reader variant metadata; current settings UI/API provides target language.

Parallelization notes: can run with 19.13 after page-data types are frozen; do not talk to Codex app-server from browser code.

Implementation risks: rendering the icon on translated routes, hiding the icon for stale files, or navigating without `reader_url` creates route/content mismatches.

## Rendering contract

Reader UI shows:

- selected target language from persisted settings/page data
- Codex trigger at the right edge of the source reader title when the configured target-language `CONTENT.md` variant is missing
- hover expands only the trigger width, keeps the Codex icon left-aligned, and reveals `Translate`
- click opens a confirmation popup instead of starting translation directly
- popup shows and can submit target language, Codex model, and reasoning effort
- popup submit button uses the 50% transparent visual treatment shared with translation progress
- tooltip text `Translate to <lang_code>` or the Japanese UI equivalent `<lang_code>に翻訳する`
- no Codex translation icon on translated reader routes
- settings-required state when no target language exists
- auth/setup-required state when Codex cannot run
- translate action when ready, triggered by submitting the popup
- current chunk index and total chunk count while running
- live Codex delta transcript labelled as progress, not saved content
- validation and retry events
- committing state
- unavailable state when a job snapshot reports `status = "unavailable"` or `error.code = "translation_unavailable"`
- completion action to open translated reader variant
- actionable failure state

## Start behaviour

1. Read configured `lang_code` from page/settings data.
2. Read reader variant metadata from page data. Variant metadata must be current, meaning the translated file exists, its completed `translation_jobs.source_hash` matches the current source hash, and the file hash matches `translation_jobs.output_hash`.
3. If the current reader route is translated, do not render the Codex icon.
4. If a current translated variant for `memories/<memory_id>/<lang_code>/CONTENT.md` already exists, do not render the Codex icon for that language.
5. If the configured target-language variant is missing on the source reader route, render the Codex trigger at the title right edge.
6. On trigger click, open the confirmation popup. Do not start translation on this click.
7. The popup reads the current settings defaults for `lang_code`, `model`, and `reasoning_effort`; model options are loaded through `/api/settings/codex-models`, never by calling app-server from browser code.
8. On popup submit, POST `/api/memories/:memory_id/translations` with `lang_code`, `model`, and `reasoning_effort`. `model` and `reasoning_effort` may be `null` to use app-server/model defaults.
9. If `202`, open the returned `event_url`.
10. If `200 active`, open the returned `event_url` for the reused active job and use `job_status` plus the first snapshot to render the exact progress state.
11. If `200 current`, navigate to the response `reader_url`.
12. For non-2xx responses, branch on the stable response `code` field, not free-form `message`.
13. If `code = "translation_language_required"`, link to `/settings`.
14. If `code = "translation_language_mismatch"`, refresh settings state and ask the user to retry.
15. If `code = "translation_model_unavailable"` or `code = "translation_reasoning_effort_unavailable"`, tell the user to update Codex translation defaults in settings.
16. If `code = "setup_required"` or `code = "auth_required"`, show Codex auth setup guidance.
17. If `code = "app_server_unavailable"`, tell the user Codex app-server is unavailable and offer retry after setup is fixed.
18. If `code = "app_server_protocol_error"`, tell the user Codex app-server rejected the translation request and do not show app-server startup guidance.
19. If `code = "translation_unavailable"` or `action = "start_fresh_translation"`, tell the user the translated output is no longer available, navigate to the source reader route `/memories/:id` if necessary, and start a fresh translation through `POST /api/memories/:memory_id/translations`.
20. If `code = "timeout"`, tell the user the Codex turn timed out and offer retry.
21. If `code = "stream_disconnected"`, tell the user the Codex stream disconnected and offer retry or fresh translation depending on job status.
22. If `code = "invalid_final_output"`, tell the user Codex returned invalid final output and offer retry.
23. If `code = "stale_source"`, tell the user the source changed and offer to start a fresh translation.
24. If `code = "cancellation_conflict"`, tell the user cancellation is already in progress and offer retry after cancellation completes.

Progress and reconnect behaviour:

- If `GET /api/translation-jobs/:job_id` or an SSE `translation.job.snapshot` returns `status = "unavailable"`, render the same recovery UI as `code = "translation_unavailable"`.
- The unavailable recovery UI must not link to `reader_url` because unavailable snapshots have `reader_url = null`.
- The primary action is to navigate to the source reader route `/memories/:id` if the user is not already there, then call `POST /api/memories/:memory_id/translations`.

## Variant tab contract

The memory reader header owns variant tabs.

Rules:

- Load available variants from source content plus current translated variants. A translated variant is current only when the file exists, the complete translation row matches the current source hash, and the file hash matches the row `output_hash`.
- Do not render tabs when only the default source `CONTENT.md` exists.
- Render tabs under the memory header when two or more `CONTENT.md` variants exist.
- The default source tab label is `Original` unless a reliable source language label is introduced later.
- Translated tab labels use language display names, not raw codes. For example, `ja-JP` renders as `Japanese`.
- Clicking a translated tab navigates to its `reader_url`, for example `/memories/<lang_code>/<memory_id>`.
- Clicking the default tab navigates to `/memories/:id`.

## Tests

Cover:

- target language renders from persisted settings value
- missing language renders settings-required state
- auth unavailable renders setup-required state
- missing configured target-language variant renders the title-edge Codex icon
- existing configured target-language variant hides the Codex icon
- stale configured target-language file does not hide the Codex icon
- translated reader route hides the Codex icon
- Codex icon tooltip contains the target language code
- trigger click opens the confirmation popup and does not start translation
- popup submit starts translation API request with `lang_code`, `model`, and `reasoning_effort`
- popup submit and progress UI use the transparent visual treatment
- `202` opens SSE progress
- `200 active` opens SSE progress for the reused active job
- reused active response renders from `job_status` and snapshot instead of assuming `running`
- `200 current` navigates to translated reader route
- completion event navigates with `reader_url`
- tabs are hidden when only default `CONTENT.md` exists
- tabs render under the header when translated variants exist
- stale translated files do not render as current tabs
- translated files whose hash differs from `translation_jobs.output_hash` do not render as current tabs
- `ja-JP` tab label renders as `Japanese`
- progress shows chunk count and current chunk
- delta transcript is labelled non-authoritative
- retry event renders visibly
- live job/chunk failure events branch on `data.error.code`
- API failure UI branches on stable `code` values
- job snapshot with `status = "unavailable"` renders a fresh-translation recovery action
- app-server-unavailable failure is rendered separately from auth/setup-required
- timeout and stream-disconnected failures are rendered separately from validation and auth/setup failures
- invalid-final-output failure is rendered separately from generic validation failure
- translation-unavailable failure navigates to the source reader route and starts a fresh translation
- stale-source failure offers a fresh translation action
- cancellation-conflict failure tells the user to retry after cancellation completes
- failure message is actionable and does not expose secrets

## Verification

```sh
mise exec -- bun run test tests/components/memory-reader-actions.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Reader can open a confirmation popup and start translation from its submit action.
- UI uses SQLite-backed settings state through backend/page data.
- UI never talks to Codex app-server directly.
- UI does not present partial deltas as saved translation.
- UI exposes translated variants through tabs only when variants exist.
