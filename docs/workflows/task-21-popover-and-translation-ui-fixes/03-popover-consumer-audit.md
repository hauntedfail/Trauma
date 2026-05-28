# Task 21.3: Popover Consumer Audit

## Goal

Verify that all anchored popover surfaces use the shared `Popup` component and
that any remaining non-`Popup` dismissable surfaces are intentionally inline
controls rather than app popovers.

## Ownership

Primary files:

- Modify `tests/components/popup.test.tsx`
- Modify `tests/components/app-shell.test.ts`
- Modify `tests/components/taxonomy-add-control.test.tsx`
- Modify `tests/components/memory-reader-actions.test.ts`
- Modify `src/components/ui/KebabActionMenu.tsx` only if the audit finds local
  panel chrome duplication
- Modify `src/components/memories/TaxonomyAddControl.tsx` only if the audit
  finds local popover shell duplication
- Modify `docs/references/design-system/components-and-surfaces.md`

Do not migrate `TaxonomyInlineCreateControl` to `Popup`; it is an inline input
that replaces its own pill and should keep its direct `useDismissableLayer`
close behaviour.

## Audit Targets

Anchored popovers that must use `Popup`:

- `src/components/shell/AppShell.tsx` Add memory rail/phone composer
- `src/components/shell/AppShell.tsx` Theme rail/phone settings
- `src/components/ui/KebabActionMenu.tsx` menus used by Memory, Moment, and
  Flashback action menus
- `src/components/memories/TaxonomyAddControl.tsx` existing taxonomy selector
- `src/components/reader/MemoryReader.tsx` translation confirmation

Intentional non-popover inline surfaces:

- `src/components/memories/TaxonomyInlineCreateControl.tsx`, because it
  transforms the add pill into a small inline form instead of opening a panel

## Implementation Steps

1. Add source-level tests that list the allowed `useDismissableLayer` imports:
   `Popup.tsx` and `TaxonomyInlineCreateControl.tsx`.
2. Add source-level tests that require translation confirmation to use `Popup`
   and forbid local `document.addEventListener("pointerdown"` or local
   `useDismissableLayer` imports in `MemoryReader.tsx`.
3. Add or update app-shell and taxonomy tests so they still assert `Popup`
   usage, role, trigger state, and shared panel layer.
4. Remove any local popover panel background class that duplicates
   `Popup`'s default chrome.
5. Update the design-system surface docs with the audit result and the explicit
   inline exception for taxonomy inline creation.

## Tests

Run:

```bash
mise exec -- bun run test tests/components/popup.test.tsx tests/components/app-shell.test.ts tests/components/taxonomy-add-control.test.tsx tests/components/memory-reader-actions.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- New anchored popovers have one obvious implementation path: use `Popup`.
- Translation, shell, action-menu, and taxonomy selector popovers share
  dismissal, layer, animation, and panel surface.
- The only direct `useDismissableLayer` consumer outside `Popup` is documented
  as an inline control.
- No domain component owns outside-pointer dismissal for an anchored popover.
