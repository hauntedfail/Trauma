# 18-alpha.4 Composer and Theme popup migration

## Goal

Migrate Add memory composer and Theme popovers to the shared popup shell while
keeping their domain-specific content components intact.

## Files likely owned

- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/memories/AddMemoryForm.tsx` only if class props need
  a cleaner boundary
- Modify: `tests/components/app-shell.test.ts`
- Modify: `tests/components/add-memory-form.test.ts` only if form class
  boundaries change
- Optional create: `src/components/shell/ShellPopovers.tsx` if extracting from
  `AppShell.tsx` reduces file weight without changing shell behaviour

## Behaviour contract

- `AddMemoryComposerButton` uses the shared popup shell for:
  - rail mode
  - compact rail mode
  - phone bottom-tab mode
- `ThemeNavButton` uses the same popup shell for:
  - rail mode
  - phone bottom-tab mode
- `ThemeBlock` keeps its segmented toggle buttons and theme-specific icon
  rules. It is not converted into a generic menu.
- Composer content keeps `AddMemoryForm` and the existing `POST /api/memories`
  flow.
- Both popovers inherit the common action-menu background surface recipe rather
  than using a separate bespoke panel background.
- Popovers must render above rail, main pane, and phone bottom bar.
- Opening state must apply the existing selected/pressed visual treatment to
  the trigger.

## Implementation steps

1. Update shell tests to assert Add memory and Theme use the shared popup shell
   contract.
2. Replace duplicated outside-pointer and Escape handling in
   `AddMemoryComposerButton` and `ThemeNavButton` with `Popup`.
3. Move only small shell-local constants if required for readability.
4. Keep `ThemeBlock` content unchanged except for panel wrapper removal.
5. Keep `AddMemoryForm` submit behaviour unchanged.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/mobile-responsive-contract.test.ts
mise exec -- bun --bun x vitest run tests/components/add-memory-form.test.ts tests/components/add-memory-submit.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Add memory and Theme popovers share the same popup shell and panel surface.
- Theme selector remains visually and behaviourally distinct inside the shared
  shell.
- Phone and compact rail layouts do not clip the popovers.
- Existing theme persistence and add-memory creation behaviour remain intact.

