# Task 21: Popover and Translation UI Fixes Workflow

Implement these subtasks sequentially on `fix/anything`, which is derived from
`fix/perform`.

## Goal

Unify TRAUMA popovers around the transparent reader-translation popover design,
make the reader translation confirmation popover dismiss as cancel on outside
interaction, and verify the existing translation start/progress integration
still behaves correctly.

## Architecture

`src/components/ui/Popup.tsx` remains the one shared popover shell for anchored
dialog and menu surfaces. Domain components own their forms, actions, and data
loading, but they do not own outside-click dismissal, Escape dismissal, layer
z-index, or the common panel chrome. The translucent reader-translation panel
becomes the default popover visual recipe across shell, taxonomy, action-menu,
and reader translation uses.

## Required Context

- [Documentation index](../../INDEX.md)
- [UI and routing architecture](../../architecture/ui-and-routing.md)
- [Design system reference](../../references/design-system/INDEX.md)
- [Design system interactions](../../references/design-system/interaction-and-accessibility.md)
- [Design system surfaces](../../references/design-system/components-and-surfaces.md)
- [Design system verification](../../references/design-system/verification.md)
- [SolidStart UI rules](../../references/coding-standards/solidstart-ui.md)
- [Testing and verification rules](../../references/coding-standards/testing-verification.md)
- [Archived shared popup foundation](../archive/task-18-alpha-ui-routing-refresh/02-shared-popup-shell-foundation.md)
- [Archived translation model controls](../archive/task-19-codex-translation-model-controls.md)
- [Archived frontend translation controls](../archive/task-19-codex-translation/12-frontend-translation-controls-and-progress-ui.md)

## Scope

In scope:

- Make the shared `Popup` panel use the transparent elevated surface treatment
  that currently makes the reader translation popover feel integrated.
- Keep popover dismissal centralized in `Popup` and `useDismissableLayer`.
- Migrate the reader translation confirmation form to `Popup`.
- Treat outside pointer dismissal and Escape on the reader translation popover
  as cancel: close the popover, reset unsaved form edits, and do not start a
  translation job.
- Increase the contrast of the submit `Translate` button inside the translation
  popover so it reads as an enabled primary action.
- Audit current popover-like surfaces and keep all anchored popovers on the
  shared component unless a surface is intentionally inline.
- Add focused component and browser verification for the reader translation
  popover and existing translation start/progress integration.

Out of scope for this branch:

- Reworking translation chunking, validation, stitching, projection, or storage.
- Changing Codex app-server protocol payloads beyond preserving the current
  `lang_code`, `model`, and `reasoning_effort` request.
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
- Browser code must not call Codex app-server directly. Model catalog and
  translation start flows continue through existing TRAUMA API routes.
- Translated reader routes and source readers with an existing current target
  variant must keep hiding the translation trigger.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 21.1 | [Shared popover visual contract](01-shared-popover-visual-contract.md) | S | Move the transparent panel recipe into `Popup` and align docs/tests. |
| 21.2 | [Reader translation popover migration](02-reader-translation-popover-migration.md) | M | Replace the bespoke translation form wrapper with `Popup`, outside-cancel, and primary button contrast. |
| 21.3 | [Popover consumer audit](03-popover-consumer-audit.md) | S | Confirm anchored popovers use the shared shell and intentionally inline controls stay inline. |
| 21.4 | [Translation integration regression checks](04-translation-integration-regression-checks.md) | M | Verify the popup migration preserves API payloads, progress handling, and variant hiding rules. |
| 21.5 | [Browser verification and handoff](05-browser-verification-and-handoff.md) | M | Run visual/browser checks, full verification, docs sync, and PR handoff. |

## Implementation Rules

- Implement all subtasks on `fix/anything`, but keep commits grouped by the
  subtask boundaries above.
- Start each subtask from the required context and owned files listed in that
  subtask.
- Use TDD for component behaviour that can regress: popup chrome contract,
  translation close/reset, submit payload, trigger visibility, and error/progress
  integration.
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
