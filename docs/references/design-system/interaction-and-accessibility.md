# Interaction And Accessibility

## Route Behaviour

Canonical UI routes:

- `/memories`
- `/highlights`
- `/memories/:id`

The root route redirects to `/memories`.

Do not add live navigation links to missing `/category`, `/tags`, `/backup`,
or `/settings` routes. Future items may be rendered as disabled controls only.

## Query State

Browse filtering is encoded in the URL query.

Supported browse concerns:

- Search query.
- Category filter.
- Tag filter.
- Highlight shortcut filter.
- List/grid view mode.

Filter buttons should toggle their own query key without clearing unrelated
query state.

## Row Navigation

Memory browse rows are full-row links.

Rules:

- The entire row/card opens the memory.
- Nested controls should be avoided inside the row.
- There is no separate trailing `Open` button.
- Keyboard focus must reach the row link.

## Theme Persistence

Theme preference is client-local only.

Storage keys:

- `trauma:brightness`
- `trauma:surface`

Theme controls:

- Use `aria-pressed`.
- Persist to `localStorage`.
- Set `data-theme` on `document.documentElement`.
- Do not write to SQLite, markdown files, or `trauma.config.json`.

## Focus And Keyboard

Rules:

- Interactive controls must be native `button`, `a`, `input`, or form
  controls unless there is a strong reason otherwise.
- Icon-only buttons need accessible labels on the button.
- SVG icons are `aria-hidden`.
- Route rows and reader links must have visible focus treatment.
- Reader highlight keyboard toggling must remain explicit and must not trigger
  during ordinary text navigation.

## Labels And Landmarks

Required shell labels:

- `Primary navigation` on the left rail.
- `Browse filters` on the right rail.
- `Navigation`, `Filters`, and `Add memory` on drawers.
- `TRAUMA home` on the brand link.
- `Theme` on the theme control section.

Route surfaces should use `aria-labelledby` and stable headings:

- `memories-title`.
- `highlights-title`.
- `reader-title`.

## Selected And Disabled State

Selected/toggled controls:

- Use `aria-pressed` when the control toggles a local/filter state.
- Use `aria-current="page"` for the active route link.
- Use visible selected styling that works in every theme.

Disabled future controls:

- Use native `disabled` where possible.
- Add `aria-disabled="true"` when helpful.
- Avoid hover styles that make disabled controls look active.

## Responsive Interaction

Desktop:

- Left rail, main pane, and right rail are visible.
- Reader TOC appears at the top of the right rail only on concrete memory
  reader routes.
- TOC and Recent highlights scroll inside their own bounded list bodies.

Tablet:

- Left rail becomes compact.
- Right rail is hidden.
- Filter drawer remains reachable.

Mobile:

- Top bar provides navigation and filter access.
- Drawers take over rail interactions.
- Text and controls must not overflow their containers.

## Motion And Feedback

Use simple transitions for hover and selected state.

Reader TOC entry may use the dedicated popup-style bounce utility. Keep this
motion short, route-entry scoped, and disabled for reduced-motion users.

Do not add decorative motion or animation loops. Any future animation must
serve an interaction state and respect readability.
