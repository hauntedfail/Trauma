# 18-alpha.3 General action menu migration

## Goal

Migrate general action menus to the shared popup shell while preserving their
current behaviour and design. General action menus are the memory, Moment, and
Flashback meatballs menus, not the special Theme selector UI.

## Files likely owned

- Modify: `src/components/ui/KebabActionMenu.tsx`
- Modify: `src/components/memories/MemoryActionMenu.tsx`
- Modify: `src/components/moments/MomentActionMenu.tsx`
- Create: `src/components/flashbacks/FlashbackActionMenu.tsx`
- Modify: `tests/components/memory-action-menu.test.ts`
- Modify: `tests/components/moment-action-menu.test.ts`
- Create: `tests/components/flashback-action-menu.test.ts`
- Optional create: `src/components/ui/ActionMenu.tsx`
- Optional create: `tests/components/action-menu.test.ts`

## Behaviour contract

- Memory, Moment, and Flashback menus share the same popup shell.
- The trigger remains a meatballs/kebab button with a visible hover/focus state.
- `role="menu"` and item semantics are preserved.
- Menu item styling remains centralized:
  - min touch target height
  - icon/text grid
  - theme-aware hover background
  - error message class for failed actions
- Delete actions rendered from a general action menu must use a shared danger
  item style:
  - label pattern: `Delete memory`, `Delete moment`, or `Delete {domain}`
  - text/icon colour: `text-trauma-danger`
  - icon: shared trash icon from the app icon set, not a text hyphen
  - hover/focus affordance remains visible and theme-aware
- Memory menu keeps:
  - delete confirmation
  - category popover entry
  - backup-failsafe revalidation behaviour from parent handlers
- Moment menu keeps:
  - delete action
  - route navigation behaviour in `/moments`
- Flashback menu keeps:
  - `Delete flashback` as its only first-pass menu item
  - the shared danger item style and trash icon
  - deletion wired through the existing Flashback removal/toggle mutation path
  - no new API route or persistence semantics unless a later workflow update
    explicitly permits that change
- Menu content must not gain composer or Theme-specific styling.

## Implementation steps

1. Add or update tests that assert both memory and Moment menus render through
   the shared popup shell or shared action-menu wrapper.
2. Refactor `KebabActionMenu` to use `Popup`, or replace it with a thin
   `ActionMenu` wrapper around `Popup`.
3. Migrate `MemoryActionMenu`.
4. Migrate `MomentActionMenu`.
5. Add or migrate a Flashback action menu for `/flashbacks` rows.
6. Remove duplicate menu panel class definitions that are no longer needed.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/memory-action-menu.test.ts tests/components/moment-action-menu.test.ts
mise exec -- bun --bun x vitest run tests/components/flashback-action-menu.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- There is one general action-menu popup path.
- Memory, Moment, and Flashback menus still work from their current routes.
- Hover/focus affordance remains visible on browse cards and reader header
  menus.
- Delete menu items use the shared danger style and trash icon across memory,
  Moment, and Flashback menus.
- No Theme or composer internals leak into general menu components.
