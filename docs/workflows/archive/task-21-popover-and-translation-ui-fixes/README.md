# Task 21: Popover and Translation UI Fixes Workflow

Implement these subtasks sequentially on `fix/anything`, which is derived from
`fix/perform`.

## Goal

Unify TRAUMA popovers around the transparent reader-translation popover design,
make the reader translation confirmation popover dismiss as cancel on outside
interaction, persist Codex translation model/effort defaults through DB-backed
settings state, and verify the existing translation start/progress integration
still behaves correctly.

## Architecture

Codex translation defaults are durable settings state, not transient reader UI
state. SQLite `app_settings` owns the remembered model and reasoning effort,
settings-scoped API routes validate selections against the current Codex
app-server catalog, and reader route data passes the current persisted defaults
to `MemoryReader`. `src/components/ui/Popup.tsx` remains the one shared popover
shell for anchored dialog and menu surfaces; domain components own forms,
actions, and data loading, but they do not own outside-click dismissal, Escape
dismissal, layer z-index, or common panel chrome. The translucent
reader-translation panel becomes the default popover visual recipe across shell,
taxonomy, action-menu, and reader translation uses.

## Required Context

- [Documentation index](../../../INDEX.md)
- [UI and routing architecture](../../../architecture/ui-and-routing.md)
- [Design system reference](../../../references/design-system/INDEX.md)
- [Design system interactions](../../../references/design-system/interaction-and-accessibility.md)
- [Design system surfaces](../../../references/design-system/components-and-surfaces.md)
- [Design system verification](../../../references/design-system/verification.md)
- [SolidStart UI rules](../../../references/coding-standards/solidstart-ui.md)
- [Testing and verification rules](../../../references/coding-standards/testing-verification.md)
- [Configuration reference](../../../references/configuration.md)
- [Data and storage architecture](../../../architecture/data-and-storage.md)
- [Archived shared popup foundation](../task-18-alpha-ui-routing-refresh/02-shared-popup-shell-foundation.md)
- [Archived translation model controls](../task-19-codex-translation-model-controls.md)
- [Archived frontend translation controls](../task-19-codex-translation/12-frontend-translation-controls-and-progress-ui.md)

## Scope

In scope:

- Make the shared `Popup` panel use the transparent elevated surface treatment
  that currently makes the reader translation popover feel integrated.
- Keep popover dismissal centralized in `Popup` and `useDismissableLayer`.
- Migrate the reader translation confirmation form to `Popup`.
- Treat outside pointer dismissal and Escape on the reader translation popover
  as cancel: close the popover, reset unsaved form edits, and do not start a
  translation job.
- Treat selected Codex model and reasoning effort as DB-backed settings status.
  If the user selects `gpt-5.5` and `high`, those values must persist through
  the settings repository and reappear as the selected defaults the next time
  the reader translation popover opens.
- Keep translation job rows recording the resolved model and reasoning effort
  used for that job attempt.
- Revalidate or refresh reader/settings state after successful default updates
  so a still-mounted reader does not keep stale prop values.
- Increase the contrast of the submit `Translate` button inside the translation
  popover so it reads as an enabled primary action.
- Audit current popover-like surfaces and keep all anchored popovers on the
  shared component unless a surface is intentionally inline.
- Add focused component and browser verification for the reader translation
  popover and existing translation start/progress integration.

Out of scope for this branch:

- Reworking translation chunking, validation, stitching, projection, or storage.
- Changing Codex app-server protocol payloads beyond preserving and validating
  the current `lang_code`, `model`, and `reasoning_effort` request.
- Reopening archived Task 19 architecture documents as active workflows.
- Creating a second popover abstraction for translation only.
- Replacing confirmation popovers with modal dialogs or drawers.
- Changing Add memory, Theme, taxonomy, Memory action, Moment action, or
  Flashback action domain behaviour except where shared popover chrome affects
  their wrapper.

## Non-Negotiable Contracts

- `Popup` is the only anchored popover shell for dialog/menu popovers.
- Reader translation outside pointer dismissal is cancel. It must not submit,
  schedule, or reuse a translation job.
- The reader translation `Cancel` button, Escape, and outside pointer dismissal
  must reach the same close/reset path.
- The transparent panel design is adopted app-wide through the shared shell,
  not duplicated in `MemoryReader.tsx`.
- The translation submit button must not use opacity or a muted treatment unless
  it is actually disabled.
- `codex_translation_model` and `codex_translation_reasoning_effort` are the
  durable default source for the reader popover. The reader may hold draft form
  state while the popover is open, but closing without submit must not overwrite
  the persisted defaults.
- A successful translation submit with explicit `model` or `reasoning_effort`
  must update persisted defaults before future reader popovers are seeded.
- The model select must compare option values against the same canonical value
  stored in DB. If persistence stores the catalog `model` value, options must
  also use `model`; if an older row stores an `id`, the UI must include a
  fallback option or normalize it server-side before rendering.
- Browser code must not call Codex app-server directly. Model catalog and
  translation start flows continue through existing TRAUMA API routes.
- Translated reader routes and source readers with an existing current target
  variant must keep hiding the translation trigger.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 21.1 | [Codex default persistence contract](01-codex-default-persistence-contract.md) | M | Verify and repair DB/repository ownership for remembered model and reasoning effort defaults. |
| 21.2 | [Settings API and route state](02-settings-api-and-route-state.md) | M | Validate model/effort defaults through API routes and feed fresh persisted values into reader pages. |
| 21.3 | [Shared popover visual contract](03-shared-popover-visual-contract.md) | S | Move the transparent panel recipe into `Popup` and align docs/tests. |
| 21.4 | [Reader translation popover migration](04-reader-translation-popover-migration.md) | M | Replace the bespoke translation form wrapper with `Popup`, outside-cancel, primary button contrast, and persisted default selection. |
| 21.5 | [Popover consumer audit](05-popover-consumer-audit.md) | S | Confirm anchored popovers use the shared shell and intentionally inline controls stay inline. |
| 21.6 | [Translation integration regression checks](06-translation-integration-regression-checks.md) | M | Verify the popup migration preserves settings persistence, API payloads, progress handling, and variant hiding rules. |
| 21.7 | [Browser verification and handoff](07-browser-verification-and-handoff.md) | M | Run visual/browser checks, full verification, docs sync, and PR handoff. |

## Implementation Rules

- Implement all subtasks on `fix/anything`, but keep commits grouped by the
  subtask boundaries above.
- Start each subtask from the required context and owned files listed in that
  subtask.
- Use TDD for component behaviour that can regress: popup chrome contract,
  translation close/reset, persisted default seeding, submit payload, trigger
  visibility, and error/progress integration.
- Keep persistence, API/loader, and reader UI changes in separate commits so a
  worker can review DB/default-state semantics independently from visual popover
  changes.
- Prefer improving `Popup` over adding local outside-click listeners to reader,
  shell, taxonomy, or action menu components.
- Keep `useDismissableLayer` generic. It must not import reader, shell, memory,
  taxonomy, or translation modules.
- Preserve the current progress event names and stable translation error-code
  branching.
- Preserve existing dirty or untracked local files that are unrelated to this
  branch.

## Verification Baseline

Each subtask lists focused commands. Before PR handoff, run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

After the reader UI migration lands, run browser/E2E coverage:

```bash
mise exec -- bun run test:e2e e2e/reader.spec.ts e2e/cross-device-responsive.spec.ts
```

If full verification is blocked by local Codex/app-server state, record the
exact blocker and still run the focused suites listed by each subtask.
