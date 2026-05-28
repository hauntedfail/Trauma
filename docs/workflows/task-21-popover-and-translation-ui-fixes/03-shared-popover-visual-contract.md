# Task 21.3: Shared Popover Visual Contract

## Goal

Make the transparent elevated panel currently used by the reader translation
popover the shared `Popup` visual contract.

## Ownership

Primary files:

- Modify `src/components/ui/Popup.tsx`
- Modify `tests/components/popup.test.tsx`
- Modify `tests/components/app-shell.test.ts`
- Modify `docs/references/design-system/components-and-surfaces.md`
- Modify `docs/references/design-system/interaction-and-accessibility.md`
- Modify `docs/references/design-system/verification.md`

Do not modify DB/settings persistence or reader translation behaviour in this
subtask.

## Contract

Update `Popup` so `panelBaseClass` owns the unified panel recipe:

- `z-[70]`
- `rounded-[20px]`
- `border border-trauma-border`
- `bg-trauma-bg-elev/50`
- `shadow-trauma-2`
- `backdrop-blur`
- `animate-trauma-pop-bounce`

Keep placement, phone panel positioning, `mode="dialog"`, `mode="menu"`,
`aria-controls`, `aria-expanded`, `aria-haspopup`, and `role={mode()}`
unchanged.

`panelClass` remains only for consumer-specific width, grid, spacing, text, and
phone/tablet positioning. Consumers must not pass a second opaque background to
restore the old `bg-trauma-bg-elev` panel.

## Implementation Steps

1. Add failing assertions in `tests/components/popup.test.tsx` that require
   `bg-trauma-bg-elev/50` and `backdrop-blur` in `Popup.tsx`.
2. Update existing app shell assertions that assume opaque popover chrome.
3. Change `panelBaseClass` in `src/components/ui/Popup.tsx` to the shared
   transparent recipe.
4. Update design-system docs so Shell Popovers describe translucent elevated
   panels as the app-wide default.
5. Keep existing consumer dimensions in `AppShell.tsx`, `KebabActionMenu.tsx`,
   and `TaxonomyAddControl.tsx` unchanged.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/popup.test.tsx tests/components/app-shell.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- `Popup` is the only file that defines the default transparent panel chrome.
- Existing shell, phone, taxonomy, and action-menu popovers inherit the new
  transparent background without local duplicated background classes.
- Design docs say outside pointer and Escape dismissal are shared popover
  behaviour.
- No DB/settings or reader translation code changes in this subtask.
