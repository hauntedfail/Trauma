# 24.9 Completion Audit

This audit maps the workflow exec-plan to current implementation evidence.
Status values follow the Task 24 completion rules:

- `Satisfied`: direct current code, test, doc, or browser evidence proves the
  requirement.
- `Mapped`: the plan named a likely file, but the implemented coverage lives in
  another focused file named below.
- `Missing`: no current evidence proves the requirement. This audit has no
  `Missing` rows.

## Verification Evidence

Fresh verification for the final implementation state:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts tests/components/psychiatrist-dock.test.tsx
mise exec -- bun run test:e2e e2e/reader.spec.ts -g "psychiatrist"
mise exec -- bun run test:e2e e2e/reader.spec.ts
mise exec -- bun run test:e2e e2e/cross-device-responsive.spec.ts
git diff --check
mise exec -- bun run verify
```

Results:

- `typecheck`: passed.
- Focused server/component tests: passed, 2 files and 35 tests.
- Focused Psychiatrist E2E: passed, 3 tests.
- Reader E2E: passed, 16 tests.
- Cross-device responsive E2E: passed, 10 tests. A prior parallel run failed
  before tests because two Playwright web servers raced on Vinxi temporary app
  config cleanup; the single rerun passed.
- `git diff --check`: passed.
- `verify`: passed, including typecheck, 114 test files, 910 passed tests, 5
  todo tests, and build. Build emitted the existing Defuddle/Temml `DEP0155`
  warning and exited 0.

Final pushed commit for the stopped-Regenerate fix and audit-plan clarification:
`5e009ad91ac06c3745c30602390a3993850e0ee5`.

## Audit Matrix

| Area | Workflow Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 24.1 Codex adapter | Shared Codex app-server client supports generic conversation turns without exposing app-server details to the browser. | Satisfied | `src/server/translation/codex-app-server.ts`; `tests/server/translation/codex-app-server.test.ts` cases `runs a new Psychiatrist conversation turn with locked-down defaults`, `reuses an existing Psychiatrist thread and enables network only after explicit approval`, and protocol/close/error tests. |
| 24.1 Codex adapter | Psychiatrist turns use locked-down defaults: no shell, no local file editing, no local filesystem roots, and network disabled unless user approved web sources for that turn. | Satisfied | `tests/server/translation/codex-app-server.test.ts` locked-down defaults and approved-network tests; `docs/references/configuration.md`; `.agents/skills/psychiatrist/SKILL.md`. |
| 24.1 Codex adapter | Safe process/status events may stream, while hidden chain-of-thought, raw app-server payloads, credential paths, local paths, and tool internals are not forwarded. | Satisfied | `tests/server/translation/codex-app-server.test.ts` case `forwards safe Psychiatrist process events while filtering hidden reasoning`; `tests/server/psychiatrist/events.test.ts` case `filters unsafe process events before writing JSONL replay`. |
| 24.1 Codex adapter | Translation still uses the existing `TranslationClient` surface. | Satisfied | `CodexAppServerClient` remains the shared implementation in `src/server/translation/codex-app-server.ts`; existing translation app-server tests pass in `verify`. |
| 24.2 Context | Source context loads memory `CONTENT.md` and includes title, URL, tags, categories, hash, TOC/section data, and bounded section Markdown. | Satisfied | `src/server/psychiatrist/context.ts`; `tests/server/psychiatrist/context.test.ts` source-context coverage; `tests/server/psychiatrist/prompt.test.ts` prompt metadata and sections coverage. |
| 24.2 Context | Translated context uses current translated `CONTENT.md`; stale, missing, or hash-mismatched translated content is rejected. | Satisfied | `tests/server/psychiatrist/context.test.ts`; `tests/server/psychiatrist/api-routes.test.ts` translated thread creation and stale-context cases. |
| 24.2 Context | Prompt construction is deterministic, memory-scoped, policy-scoped, and treats memory Markdown as untrusted data. | Satisfied | `src/server/psychiatrist/prompt.ts`; `tests/server/psychiatrist/prompt.test.ts` cases for locked-down policy, untrusted delimiters, delimiter neutralization, and oversized context selection. |
| 24.2 Context | Pair history is loaded from memory-local pair storage and does not synthesize unstored assistant messages. | Satisfied | `tests/server/psychiatrist/prompt.test.ts` case `includes stored pair history without inventing missing assistant messages`; `src/server/psychiatrist/thread-store.ts`. |
| 24.2 Context | Regenerate prompt uses the stored prompt and stored context snapshot for the existing pair, not current memory substitution or empty context. | Satisfied | `tests/server/psychiatrist/prompt.test.ts` case `marks regenerate turns and uses the stored user prompt`; `tests/server/psychiatrist/api-routes.test.ts` case `regenerates a completed pair by reusing prompt context and overwriting the response artifact`, which inspects fake app-server input for non-empty stored section context. |
| 24.2 Context | Web-source policy defaults to denied and only a user-approved turn may include web-source instructions. | Satisfied | `tests/server/psychiatrist/prompt.test.ts` default-denied web-source test; `tests/server/psychiatrist/api-routes.test.ts` approved and permission-required tests; `e2e/reader.spec.ts` web-source approval test. |
| 24.3 Storage/API | Thread artifacts live under the owning memory directory, including `THREAD.json`, `THREAD.md`, `PAIRS.jsonl`, pair prompt/context/response files, turn metadata, and stream JSONL. | Satisfied | `src/server/psychiatrist/thread-store.ts`; `tests/server/psychiatrist/thread-store.test.ts` source artifact creation and pair revision tests; `tests/server/psychiatrist/api-routes.test.ts` message and regenerate artifact assertions. |
| 24.3 Storage/API | Source and translated threads record variant metadata and are resumed by memory variant and content hash. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` source, translated, resume, and active-turn tests; `tests/server/psychiatrist/thread-store.test.ts` latest matching ready thread test. |
| 24.3 Storage/API | Message route accepts a prompt, creates a pending pair before Codex execution, persists completed response, writes replayable stream events, and enqueues thread backup. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` case `sends a message, persists the pair, and records replayable stream events`. |
| 24.3 Storage/API | Event route replays stored stream rows, supports resume after event id, streams live events after replay, and closes terminal replays. | Satisfied | `src/server/psychiatrist/events-route.ts`; `tests/server/psychiatrist/events.test.ts` replay and live stream tests. |
| 24.3 Storage/API | Cancel route is explicit Stop only, calls app-server interrupt when possible, appends `turn_stopped`, and stores safe stopped metadata. | Satisfied | `src/server/psychiatrist/cancel-route.ts`; `tests/server/psychiatrist/api-routes.test.ts` cases `cancels only an explicitly requested active turn` and `keeps the previous completed answer visible when regenerate is stopped`. |
| 24.3 Storage/API | Stale, missing, malformed, oversized, duplicate-active-turn, and Codex failure cases return safe typed errors and do not write orphan assistant responses. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` malformed create, empty/oversized messages, duplicate active turn, stale thread, stale context, network permission, and Codex failure cases. |
| 24.3 Storage/API | Planned thread behavior named for `tests/server/psychiatrist/threads.test.ts` is covered. | Mapped | Thread creation/loading/reduction coverage is in `tests/server/psychiatrist/thread-store.test.ts`; route-level thread behavior is in `tests/server/psychiatrist/api-routes.test.ts`. |
| 24.4 UI | Psychiatrist is reader-only, visible on ready source and translated readers, and absent from browse/settings/non-ready states. | Satisfied | `src/components/reader/PsychiatristDock.tsx`; `tests/components/memory-reader-actions.test.ts` reader-only, translated lang, and non-ready tests; `docs/architecture/ui-and-routing.md`. |
| 24.4 UI | Collapsed affordance is the bottom-centered home bar; expanded chat supports keyboard close, pointer interaction, reduced motion, and mobile viewport constraints. | Satisfied | `tests/components/psychiatrist-dock.test.tsx` home-bar, source wiring, reduced motion source assertions; `e2e/cross-device-responsive.spec.ts`; `docs/references/design-system/reader-and-content.md`. |
| 24.4 UI | Opening the dock creates/resumes a source or translated thread with network denied by default. | Satisfied | `tests/components/psychiatrist-dock.test.tsx` create/resume source and translated thread tests; `src/components/reader/psychiatrist-requests.ts`. |
| 24.4 UI | Sending a message, stopping a turn, and regenerating a completed pair call the planned routes with planned payloads. | Satisfied | `tests/components/psychiatrist-dock.test.tsx` case `sends messages, stops turns, and regenerates completed pairs through planned routes`. |
| 24.4 UI | Stream events render safe process rows and answer text, add live pairs after started events, and close EventSource on lifecycle cleanup without cancellation. | Satisfied | `tests/components/psychiatrist-dock.test.tsx` stream conversion, live pair, cleanup, and safe message mapping tests. |
| 24.4 UI | Regenerate stays in the same pair and replaces the visible previous answer on the first new answer delta. | Satisfied | `src/components/reader/psychiatrist-transcript.ts`; `tests/components/psychiatrist-dock.test.tsx` case `keeps regenerate in the same pair and replaces the visible answer on first delta`; `e2e/reader.spec.ts` regenerate test. |
| 24.4 UI | Failed or stopped Regenerate keeps the previous completed response visible and allows Regenerate again. | Satisfied | `src/components/reader/psychiatrist-transcript.ts`; `e2e/reader.spec.ts` failed and stopped Regenerate reload coverage; `tests/server/psychiatrist/api-routes.test.ts` failed/stopped storage coverage. |
| 24.4 UI | Network-required state prompts for user approval and approved retry is scoped to that turn only. | Satisfied | `tests/components/psychiatrist-dock.test.tsx` web-source approval and network-required stream tests; `e2e/reader.spec.ts` web-source approval test. |
| 24.5 Safety | Context freshness is checked before each turn; stale threads are marked stale and block Codex execution before accepting a message. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` stale thread and changed context hash tests; `src/server/psychiatrist/message-route.ts`. |
| 24.5 Safety | Prompt injection boundaries prevent source Markdown from overriding runtime policy. | Satisfied | `tests/server/psychiatrist/prompt.test.ts` untrusted context delimiter and delimiter neutralization tests; `.agents/skills/psychiatrist/SKILL.md`. |
| 24.5 Safety | Errors are safe and do not expose store paths, prompts, raw app-server details, or backup internals. | Satisfied | `src/server/psychiatrist/errors.ts`; `tests/server/psychiatrist/api-routes.test.ts` Codex failure, backup failure, network permission, malformed payload, and stale tests; `tests/components/psychiatrist-dock.test.tsx` safe reader messages test. |
| 24.5 Safety | Backup enqueue failure preserves completed response and exposes only safe warning state. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` case `keeps a completed answer when backup enqueue fails`. |
| 24.5 Safety | Regenerate integrity rejects non-completed pairs and failed/stopped Regenerate attempts do not overwrite prior completed responses. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` non-completed reject, failed Regenerate preserve, and stopped Regenerate preserve tests. |
| 24.6 Docs | Durable docs describe architecture, routing, design-system, configuration, glossary, and workflow status. | Satisfied | `docs/architecture/flows.md`; `docs/architecture/ui-and-routing.md`; `docs/references/configuration.md`; `docs/references/design-system/reader-and-content.md`; `docs/references/glossary.md`; `docs/workflows/README.md`. |
| 24.6 Browser | Source and translated readers show the dock, non-reader routes do not, and desktop/mobile behavior is covered. | Satisfied | `tests/components/memory-reader-actions.test.ts`; `e2e/reader.spec.ts`; `e2e/cross-device-responsive.spec.ts`; docs in `docs/references/design-system/reader-and-content.md`. |
| 24.6 Browser | Running turn survives navigation away/back and browser reload, reconnects to the same `turn_id`, and Stop is triggered only by the visible Stop button. | Satisfied | `e2e/reader.spec.ts` case `keeps a running psychiatrist turn alive across navigation, reload, and explicit Stop`; component cleanup test confirms lifecycle cleanup closes EventSource only. |
| 24.6 Browser | Regenerate overwrites the same response artifact, keeps pair/thread ids, and failed/stopped Regenerate keeps previous completed answer visible after reload. | Satisfied | `e2e/reader.spec.ts` regenerate test; `tests/server/psychiatrist/api-routes.test.ts` completed, failed, and stopped Regenerate storage tests. |
| 24.6 Browser | Network-required response occurs before approval with network disabled; approved retry records `web_source_policy` and source citation metadata. | Satisfied | `e2e/reader.spec.ts` web-source approval test; `tests/server/psychiatrist/api-routes.test.ts` network permission and approved-web-source tests. |
| 24.7 Skill/policy | Repo-local `psychiatrist` skill documents product language, non-medical boundary, memory-only scope, pair discipline, no writes, no shell/file access, Stop semantics, and web-source approval policy. | Satisfied | `.agents/skills/psychiatrist/SKILL.md`; `tests/skills/psychiatrist.test.ts`. |
| 24.7 Runtime policy | Runtime prompt mirrors skill policy deterministically, including no medical role, memory scope, no writes, no tools, no shell/file access, and per-turn network approval. | Satisfied | `src/server/psychiatrist/prompt.ts`; `tests/server/psychiatrist/prompt.test.ts`; `tests/server/translation/codex-app-server.test.ts` locked-down runtime tests. |
| 24.8 Streams | Stream store appends started/process/answer/completed events in turn-local order and filters unsafe payloads. | Satisfied | `src/server/psychiatrist/stream-store.ts`; `tests/server/psychiatrist/events.test.ts`. |
| 24.8 Streams | Event route replays after reload, supports `Last-Event-ID`/`after_event_id`, and browser disconnects do not cancel server turns. | Satisfied | `tests/server/psychiatrist/events.test.ts`; `tests/components/psychiatrist-dock.test.tsx` cleanup test; `e2e/reader.spec.ts` navigation/reload test. |
| 24.8 Regenerate | Completed Regenerate reuses prompt/context, keeps thread and pair ids, creates a new turn id, overwrites `RESPONSE.md`, rewrites `THREAD.md`, appends a regenerate revision, and enqueues `psychiatrist_response_regenerate`. | Satisfied | `src/server/psychiatrist/regenerate-route.ts`; `tests/server/psychiatrist/api-routes.test.ts` completed Regenerate test. |
| 24.8 Failed Regenerate | Failed Regenerate does not overwrite `RESPONSE.md`; fresh thread load still shows the previous completed answer. | Satisfied | `tests/server/psychiatrist/api-routes.test.ts` case `keeps the previous completed answer visible when regenerate fails`; `e2e/reader.spec.ts` failed fake Regenerate reload path. |
| 24.8 Stopped Regenerate | Stopped Regenerate is verified separately from failed Regenerate; explicit Stop writes safe stopped metadata for the new regenerate turn, does not append a hiding canceled pair revision, does not overwrite `RESPONSE.md`, and fresh load/browser reload still shows the previous completed answer. | Satisfied | Commit `5e009ad91ac06c3745c30602390a3993850e0ee5`; `src/server/psychiatrist/thread-store.ts`; `src/components/reader/psychiatrist-transcript.ts`; `tests/server/psychiatrist/api-routes.test.ts` stopped Regenerate test; `e2e/reader.spec.ts` stopped fake Regenerate reload path. |
| 24.8 Backup | Normal thread updates and Regenerate use distinct backup reasons and human-readable actions. | Satisfied | `src/server/backup/index.ts`; `tests/server/backup/git-backup.test.ts` action expansion; `tests/server/psychiatrist/api-routes.test.ts` normal and regenerate backup enqueue assertions. |
| Implementation rules | Product language and paths use `psychiatrist`; no SQLite migration was added for assistant history; transcript history is pair records; existing translation settings behavior is preserved. | Satisfied | `rg psychiatrist`; no Task 24 migration under `drizzle/`; `src/server/psychiatrist/*`; existing full `verify` passed. |
| Implementation rules | Thread ids and turn ids are opaque and not derived from memory ids. | Satisfied | `src/server/psychiatrist/thread-store.ts` and route handlers use generated ids; route tests inject opaque ids and assert payload shape. |
| Security policy | No shell/local-file access or unapproved network access is granted to Psychiatrist app-server turns; browser UI cannot directly reach app-server. | Satisfied | `tests/server/translation/codex-app-server.test.ts`; `src/server/psychiatrist/message-route.ts`; `src/components/reader/psychiatrist-requests.ts`; `docs/architecture/flows.md`. |
| PR handoff | PR must include audit mapping and no `Missing` rows. | Satisfied | This document is the audit matrix; all rows are `Satisfied` or explicitly `Mapped`, with no `Missing` rows. |

## Conclusion

Based on the current workflow exec-plan, implementation files, focused tests,
E2E tests, documentation, and pushed commit state, there are no known
unimplemented or missing Task 24 requirements. Any future scope change must add
a new workflow row instead of treating it as an implicit Task 24 omission.
