# 19.12 Frontend translation controls and progress UI

## Goal

Add Reader UI controls for starting Brilliant translation and showing streaming progress.

## Scope

Implement reader-page controls, auth/setup states, target-language display, progress transcript, chunk count, validation/retry messages, completion state, and failure state. This subtask does not implement translated document parsing.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- Task 18 settings language and auth surfaces
- 19.6 auth status API
- 19.7 SSE envelope
- 19.3 job status API

## Outputs

- Modify: `src/components/reader/MemoryReader.tsx`
- Create: `src/components/reader/TranslationControls.tsx`
- Create: `src/components/reader/TranslationProgress.tsx`
- Test: `tests/components/reader-translation-controls.test.tsx`
- Test: `tests/components/reader-translation-progress.test.tsx`

## Dependencies

- 19.6 for auth/setup API shape.
- 19.7 for event envelope.
- 19.13 for final navigation details.

## Concrete UI states

```text
idle_current_source
settings_required
auth_required
ready_to_translate
starting
running
retrying
committing
completed
failed
canceled
```

Start action:

1. Read configured `lang_code`.
2. POST `/api/memories/:memory_id/translations` with `{}` or with the configured `lang_code` as a consistency assertion.
3. If `202`, open SSE `event_url`.
4. If `200 current`, navigate to `/memories/:id?lang=<lang_code>`.
5. If `409 setup_required`, show auth/setup callout.
6. If `409 translation_language_required`, link the user to `/settings`.
7. If `409 translation_language_mismatch`, refresh settings state and ask the user to retry.

## Acceptance criteria

- The translate button uses settings target language.
- The displayed target language comes from the persisted settings value loaded through the settings/page-data API.
- Missing target language shows settings-required state.
- Auth unavailable shows setup guidance without starting blindly.
- Progress shows chunk index and total chunk count.
- Delta transcript is labelled as live progress, not saved content.
- Validation and retry events are visible.
- Completion navigates or links to translated reader variant.
- Failure displays actionable error without tokens, raw prompts, or secret paths.
- UI never reads `.work` files or Codex app-server directly.

## Parallelization notes

Can run after 19.6 and 19.7 stabilize. Can run in parallel with 19.13 if URL/query contract is fixed.

## Implementation risks

- Displaying deltas as saved content misrepresents unvalidated output.
- Page refresh must recover via job status endpoint.
- Auth-required state must not leak internal Codex setup details.
