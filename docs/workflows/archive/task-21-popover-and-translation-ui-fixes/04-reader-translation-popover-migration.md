# Task 21.4: Reader Translation Popover Migration

## Goal

Migrate the memory reader translation confirmation form to the shared `Popup`
component, seed the model/effort selects from persisted DB-backed defaults,
make outside dismissal cancel the form, and make the submit button visibly
enabled.

## Ownership

Primary files:

- Modify `src/components/reader/MemoryReader.tsx`
- Modify `src/components/settings/settings-submit.ts` only if reader submit
  needs a shared helper to persist defaults before starting translation.
- Modify `tests/components/memory-reader-actions.test.ts`
- Modify `tests/components/reader-style-contract.test.ts` only if style
  contract assertions need to move from source strings into this focused area.

Do not change translation server modules or settings repositories in this
subtask; Tasks 21.1 and 21.2 own those contracts.

## Behaviour Contract

Reader translation uses `Popup` with:

- `mode="dialog"`
- stable id derived from the memory id, for example
  `memory-${props.result.memory.id}-translation-settings`
- `label="Translation settings"`
- `placement="bottom-end"`
- `panelClass` containing only width, grid, gap, padding, and text alignment
- trigger button using the `triggerProps` returned by `Popup`

Opening the popover must:

- reset form language, model, and reasoning effort from the latest persisted
  defaults exposed by route/settings state
- refresh the Codex model catalog when the local catalog is empty
- show the remembered model as the selected option when
  `props.translationModel` is non-null, including `gpt-5.5`
- show the remembered reasoning effort as the selected option when
  `props.translationReasoningEffort` is non-null
- include a fallback option for a remembered model/effort that is not currently
  in the catalog so the UI does not silently fall back to the blank default
- mirror open state only if reader logic still needs a signal for tests or
  disabled/progress display

Closing the popover must:

- happen through `Popup` for the Cancel button, outside pointer dismissal, and
  Escape
- reset unsaved language/model/effort edits back to the latest persisted
  defaults
- not call `startReaderTranslation`
- not open an EventSource
- not mutate translation progress

Submitting the form must:

- prevent default form submission
- call the existing `startTranslation` path with `langCode`, the selected
  canonical `model`, and selected `reasoningEffort`
- persist explicit model/effort choices through the existing backend settings
  update path before future popover opens are seeded
- refresh or revalidate local settings/reader state after successful persistence
  so a still-mounted reader does not reopen with stale defaults
- close the popover only after `current`, `active`, or queued translation start
  succeeds, matching the current success behaviour
- leave the popover available for correction when API start fails

The popover submit button must use an active primary treatment:

- `bg-trauma-accent`
- `text-trauma-accent-ink`
- `hover:bg-trauma-accent-hover`
- disabled opacity only when the button is actually disabled

Do not use `bg-trauma-accent/50` for the enabled submit button.

## Implementation Steps

1. Add failing tests in `tests/components/memory-reader-actions.test.ts` that
   assert `MemoryReader.tsx` imports and renders `Popup` for translation
   settings.
2. Add failing tests that render the reader with
   `translationModel: "gpt-5.5"` and `translationReasoningEffort: "high"`, open
   the translation popover, and assert those options are selected by default.
3. Add failing tests that a remembered catalog model compares against the same
   canonical value used by `<option value={model.model}>`; if a remembered
   legacy `id` appears, the form renders that value as an explicit fallback
   rather than selecting the blank Codex default.
4. Add failing tests that closing by Cancel, outside pointer, or Escape resets
   draft form state to the persisted defaults without calling `fetch`.
5. Add failing tests that successful submit refreshes or revalidates local
   settings state before a later popover open.
6. Add failing tests that assert the bespoke absolute translation `<form>` is
   gone from `MemoryReader.tsx`, including the old local panel class containing
   `bg-trauma-bg-elev/50`.
7. Add failing tests that assert the translation `Translate` submit button uses
   `bg-trauma-accent` and not `bg-trauma-accent/50`.
8. Add failing tests that assert the reader source contains one shared close
   path for Cancel, outside pointer dismissal through `Popup`, and successful
   submit close.
9. Import `Popup` from `../ui/Popup`.
10. Replace the `Show when={translationDialogOpen()}` absolute form with a
   `Popup` whose trigger is the current Codex translation button.
11. Split the current `openTranslationDialog()` logic into a preparation helper
   that can run from `Popup` `onOpenChange` when `open === true`.
12. Add a reset helper for the close/cancel path and call it when
   `onOpenChange(false)` runs.
13. Normalize the selected model value once, at the boundary between the form
   state and `startReaderTranslation()`, so the request body and later persisted
   settings use the catalog `model` value.
14. Pass the `close` control from `Popup` into the submit path so successful
   starts close the actual popover, not only a mirror signal.
15. Keep `startReaderTranslation()` payload shape unchanged.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/memory-reader-actions.test.ts tests/components/reader-style-contract.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Reader translation confirmation is rendered through `Popup`.
- Remembered DB-backed model and reasoning effort defaults are selected when the
  popover opens.
- A user-selected `gpt-5.5` persists and reopens as selected instead of falling
  back to Codex app-server default.
- Clicking outside the translation popover is equivalent to pressing Cancel.
- Escape is equivalent to pressing Cancel through the shared dismissable layer.
- Enabled translation submit visually reads as a primary clickable button.
- Existing translation trigger hiding rules still pass.
- Existing translation API payload tests still pass.
