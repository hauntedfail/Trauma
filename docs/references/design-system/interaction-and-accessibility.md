# Interaction And Accessibility

## Route Behaviour

Canonical UI routes:

- `/memories`
- `/flashbacks`
- `/moments`
- `/memories/:id`
- `/settings`

The root route redirects to `/memories`.

Do not add live navigation links to missing `/category`, `/tags`, or `/backup`
routes. Future items may be rendered as disabled controls only.

## Query State

Browse filtering is encoded in the URL query.

Supported browse concerns:

- Search query.
- Category filter.
- Tag filter.
- Flashback shortcut filter.
- List/grid view mode.

Filter buttons should toggle their own query key without clearing unrelated
query state.

The `q` search value is preserved as raw input in the URL and may contain
fielded filters:

- `title:{some title}`
- `url:{example.com}`
- `tag:{sqlite}`
- `category:{research}`
- `flashback:{selected text}`
- standalone `read` or `unread`

Field filters, free-text terms, read-state filters, and explicit right-rail
filters combine with AND semantics. `read unread` intentionally matches no
rows.

## Row Navigation

Memory browse rows are full-row links.

Rules:

- The entire row/card opens the memory.
- Nested controls must stop propagation so action buttons do not trigger row
  navigation.
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
- Reader flashback keyboard toggling must remain explicit and must not trigger
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
- `flashbacks-title`.
- Reader fallback states use `reader-state-title`; ready reader content uses
  a route-local sticky header with only the back control and `Memory` label.
  The memory URL/action row, title, and taxonomy chips live in the main reader
  intro.

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
- TOC and Flashback shortcut lists scroll inside their own bounded list bodies.

Tablet:

- Left rail becomes compact.
- Right rail is hidden.
- Header chrome does not duplicate the brand or filter controls.
- Theme and Add memory stay reachable from compact rail popovers.
- Theme popover controls keep readable text labels and must not collapse into
  icon-only pills inside the popover.
- There is no filter drawer.

Mobile:

- Bottom `Primary tabs` render Memories, Flashbacks, Categories, Tags, Backup,
  Add memory, Theme, and Settings.
- The tab list scrolls horizontally when space is constrained. The page itself
  must not gain horizontal overflow from the tab bar.
- Categories, Tags, Backup, and Settings stay disabled until their route or
  action contracts are implemented.
- Phone tab icons use a larger dedicated icon slot so the tab bar remains
  scannable without enlarging desktop rail icons.
- Phone tab text labels are `sr-only`: names must remain available to assistive
  technology, but labels must not be visible in the bottom bar.
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
