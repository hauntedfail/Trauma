# 18-alpha.2 Shared popup shell foundation

## Goal

Create one shared popup shell that owns popup chrome, anchoring, close
behaviour, layer, animation, and background surface. It must allow different
content bodies: general menu, Add memory composer, and Theme controls.

## Files likely owned

- Create: `src/components/ui/Popup.tsx`
- Create: `tests/components/popup.test.tsx`
- Modify: `src/components/ui/KebabActionMenu.tsx` only if needed to consume the
  shared shell in the same slice
- Optional modify: `src/styles/tailwind.css` only for a reusable utility class
  that cannot stay inside the component

## Component contract

The shared component should expose controlled content without owning domain
state:

```ts
export interface PopupControls {
  close: () => void;
  open: boolean;
}

export interface PopupProps {
  children: (controls: PopupControls) => JSX.Element;
  class?: string;
  disabled?: boolean;
  id: string;
  initialOpen?: boolean;
  label: string;
  mode?: "dialog" | "menu";
  panelClass?: string;
  phonePanel?: boolean;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  trigger: (controls: PopupControls & { toggle: () => void }) => JSX.Element;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}
```

Rules:

- The component owns outside pointer close.
- Escape closes the popup.
- It renders `aria-controls`, `aria-expanded`, and `aria-haspopup` through
  trigger helpers or documented trigger props.
- The panel uses the common popup visual recipe:
  `rounded-[20px]`, `border-trauma-border`, `bg-trauma-bg-elev`, app-theme
  surface continuity, `shadow-trauma-2`, and `animate-trauma-pop-bounce`.
- `mode="menu"` renders `role="menu"`; `mode="dialog"` renders
  `role="dialog"`.
- The component must not hard-code Kebab, Theme, or Add memory labels.
- It must work when nested inside the left rail, phone bottom tabs, and route
  cards without clipping under the main pane.

## Implementation steps

1. Add tests for open/close, Escape, outside pointer, role selection, and
   trigger state.
2. Implement `Popup`.
3. Confirm the component can render arbitrary children without importing memory,
   shell, or theme modules.
4. Keep existing consumers unchanged in this subtask unless a tiny integration
   is required to prove the shell.

## Tests

```sh
mise exec -- bun --bun x vitest run tests/components/popup.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- There is exactly one popup shell component for future popup migrations.
- Popup chrome and interaction rules are implemented once.
- The component is content-agnostic and can host menu, composer, and Theme
  content without domain imports.

