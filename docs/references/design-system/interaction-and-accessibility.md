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

- Open from the left-rail `Theme` tab rather than staying permanently expanded.
- Use `aria-pressed`.
- Persist to `localStorage`.
- Set `data-theme` on `document.documentElement`.
- Do not write to SQLite, markdown files, or `trauma.config.json`.
- Expose the opened panel as a labelled dialog-like popover.
- Close the popover with Escape and outside pointer interaction.

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
- `Primary tabs` on the phone bottom tab bar.
- `Browse filters` on the right rail.
- `Add memory` on the composer popover/dialog.
- `TRAUMA home` on the brand link.
- `Theme` on the theme control section.

Route surfaces should use `aria-labelledby` and stable headings:

- `memories-title`.
- `highlights-title`.
- Reader fallback states use `reader-state-title`; ready reader content uses
  the markdown heading from the stored content rather than a duplicate shell
  header title.

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
- Header chrome does not duplicate the brand or filter controls.
- Theme and Add memory stay reachable from compact rail popovers.
- Theme popover controls keep readable text labels and must not collapse into
  icon-only pills inside the popover.
- There is no filter drawer.

Mobile:

- Bottom `Primary tabs` provide Memories, Highlights, Add memory, and Theme.
- Phone tab icons use a larger dedicated icon slot so the tab bar remains
  scannable without enlarging desktop rail icons.
- Add memory and Theme popovers render above the bottom bar.
- Paper/Hermès active underline decoration is not rendered in the phone tab bar.
- There is no navigation drawer or filter drawer.
- Text and controls must not overflow their containers.

## Motion And Feedback

Use simple transitions for hover and selected state.

Reader TOC entry may use the dedicated popup-style bounce utility. Keep this
motion short, route-entry scoped, and disabled for reduced-motion users.

Hover-specific affordances must be guarded by hover/pointer capability queries.
Reduced-motion preferences must disable non-essential movement while preserving
final selected and opened states.

Do not add decorative motion or animation loops. Any future animation must serve
an interaction state and respect readability.
