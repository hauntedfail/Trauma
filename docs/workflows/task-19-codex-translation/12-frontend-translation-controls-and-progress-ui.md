# 19.12 Frontend translation controls and progress UI

## Goal

Add Reader UI controls for starting translation and showing streaming progress.

## Scope

Implement reader-page controls, auth/setup states, target-language display, progress transcript, chunk count display, validation/retry messages, completion state, and failure state. This subtask does not implement translated document rendering itself.

## Inputs

- Task 18 settings language and auth surfaces
- 19.6 auth status API
- 19.7 SSE event envelope
- 19.3 job status API

## Outputs

- Translate button on memory reader pages.
- Login/setup required state when Codex auth is unavailable.
- Progress panel driven by SSE and job state.
- Failure UI with actionable message.

## Dependencies

- 19.6 for auth/setup API shape.
- 19.7 for event envelope.
- 19.13 for final render navigation details.

## Acceptance criteria

- The translate action uses the configured target `lang_code` from settings.
- If no target language is configured, the UI shows a settings-required state.
- If Codex auth is disabled, unknown, or setup-required, the UI shows auth/setup guidance instead of starting a job blindly.
- Starting translation calls `POST /api/memories/:memory_id/translations`.
- While translating, the UI shows current chunk index and total chunk count.
- Live Codex deltas or a native-client-like transcript are shown as non-authoritative progress.
- Validation and retry events are visible.
- Job completion reloads or links to the committed translated reader view.
- Job failure shows an actionable error and does not claim partial content was saved.
- The UI does not read `.work` artifacts or Codex app-server directly.

## Parallelization notes

This can run after 19.6 and 19.7 stabilize. It can run in parallel with 19.13 if navigation/query contracts are fixed.

## Implementation risks

- Showing streamed deltas as saved content would misrepresent unvalidated output.
- Starting jobs without auth checks creates avoidable backend failures.
- UI state must tolerate page refresh and reconnect through job-state API.
