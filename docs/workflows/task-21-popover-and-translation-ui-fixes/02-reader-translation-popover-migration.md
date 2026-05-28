# Task 21.2: Reader Translation Popover Migration

## Goal

Migrate the memory reader translation confirmation form to the shared `Popup`
component, make outside dismissal cancel the form, and make the submit button
visibly enabled.

## Ownership

Primary files:

- Modify `src/components/reader/MemoryReader.tsx`
- Modify `tests/components/memory-reader-actions.test.ts`
- Modify `tests/components/reader-style-contract.test.ts` only if style
  contract assertions need to move from source strings into this focused area.

Do not change translation server modules in this subtask.

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

- reset form language, model, and reasoning effort from current props
- refresh the Codex model catalog when the local catalog is empty
- mirror open state only if reader logic still needs a signal for tests or
  disabled/progress display

Closing the popover must:

- happen through `Popup` for the Cancel button, outside pointer dismissal, and
  Escape
- reset unsaved language/model/effort edits back to current props
- not call `startReaderTranslation`
- not open an EventSource
- not mutate translation progress

Submitting the form must:

- prevent default form submission
- call the existing `startTranslation` path with `langCode`, `model`, and
  `reasoningEffort`
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
2. Add failing tests that assert the bespoke absolute translation `<form>` is
   gone from `MemoryReader.tsx`, including the old local panel class containing
   `bg-trauma-bg-elev/50`.
3. Add failing tests that assert the translation `Translate` submit button uses
   `bg-trauma-accent` and not `bg-trauma-accent/50`.
4. Add failing tests that assert the reader source contains one shared close
   path for Cancel, outside pointer dismissal through `Popup`, and successful
   submit close.
5. Import `Popup` from `../ui/Popup`.
6. Replace the `Show when={translationDialogOpen()}` absolute form with a
   `Popup` whose trigger is the current Codex translation button.
7. Split the current `openTranslationDialog()` logic into a preparation helper
   that can run from `Popup` `onOpenChange` when `open === true`.
8. Add a reset helper for the close/cancel path and call it when
   `onOpenChange(false)` runs.
9. Pass the `close` control from `Popup` into the submit path so successful
   starts close the actual popover, not only a mirror signal.
10. Keep `startReaderTranslation()` payload shape unchanged.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/memory-reader-actions.test.ts tests/components/reader-style-contract.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Reader translation confirmation is rendered through `Popup`.
- Clicking outside the translation popover is equivalent to pressing Cancel.
- Escape is equivalent to pressing Cancel through the shared dismissable layer.
- Enabled translation submit visually reads as a primary clickable button.
- Existing translation trigger hiding rules still pass.
- Existing translation API payload tests still pass.
