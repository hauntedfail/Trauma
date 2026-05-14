# Components And Surfaces

## Shared Class Constants

Small class constants are allowed when they keep repeated Tailwind strings
readable inside the owning component. Do not create a broad global selector
system.

Examples:

- `buttonBase` in `AppShell`.
- `navItemBase` in `AppShell`.
- `themeToggleButton` in `AppShell`.
- `pageFrame`, `pageHeader`, and row constants in route components.

Keep constants component-local unless two or more files genuinely share the
same component contract.

## Buttons

Button shape follows the job:

- Primary command: full pill for shell-level action.
- Compact control: rounded full or rounded-lg with visible border.
- Filter chip/control: full-width rounded control with `aria-pressed`.
- Icon-only affordance: circular icon button with accessible label on the
  button, not the SVG.

Use icons inside buttons when an icon exists. Do not replace familiar icon
actions with verbose text-only controls.

Paper themes add one deliberate material exception for archive actions:

- Add-memory commands and List/Grid view toggles use the
  `trauma-paper-wax-seal` treatment.
- Do not replace theme colours inside this treatment. The button's existing
  semantic background, text, border, hover, and `aria-pressed` classes stay in
  charge of colour.
- Do not use gloss, floating shadows, text shadows, or liquid drips for wax
  buttons.
- Selected or pressed controls should read like wax compressed by a stamp:
  the stamp area follows the component's own dimensions, and the uneven outer
  edge effect is not used.
- The raised wax boundary is an inset band that follows the component shape.
  It is filled wax, not a line border, and must not expand outside the control
  box. The pressed face should cover almost the full control instead of
  becoming a small circular mark.
- Wax material layers must stay behind readable labels and icons. Use the
  button content layer, or `trauma-paper-wax-label` for text-only children,
  so sun paper selected controls keep high-contrast text.
- Use `WaxSealButton` and `WaxSealLabel` for new wax controls. Do not repeat
  the raw `trauma-paper-wax-*` class contract in route or shell components
  unless the shared component cannot express the required element.

## Shell Popovers

Left-rail transient controls open as anchored popovers rather than global
drawers on desktop shell layouts:

- Theme settings and Add memory composer use the same `role="dialog"` popup
  pattern, `aria-haspopup="dialog"`, `aria-expanded`, and `aria-controls`.
- Popovers close on Escape, outside pointer interaction, or successful
  completion of the contained workflow.
- Add memory keeps the shell-level command globally reachable, but the composer
  itself stays attached to the rail action that opened it.
- The primary rail must allow visible overflow and sit above route panes.
  Anchored popovers use a higher layer than the rail and main pane so their
  content is never clipped beneath the current route.

## Form Inputs

Inputs use semantic surfaces:

- Base input: `bg-trauma-bg-surface` or transparent inside an elevated wrapper.
- Border: `border-trauma-border-strong` for standalone fields.
- Placeholder: `text-trauma-text-placeholder`.
- Minimum height: at least `42px`.

Search inputs:

- The browse route owns the memory search field.
- The right rail does not contain a search field.

## Memory Browse Rows

Memory rows are the primary archive scanning surface.

Current row contract:

- Whole row is the link.
- No trailing `Open` button.
- Border-bottom separation.
- Hover uses `bg-trauma-bg-tint`.
- Avatar/host initial uses an elevated circular token surface.
- Title uses `text-xl font-bold leading-tight`.
- Metadata uses compact muted text.
- URL is shown with an open/link icon and wrap-safe text.

Grid mode reuses the same content and adds:

- Two columns on desktop.
- One column on mobile.
- Minimum card height on desktop.
- Right border between grid cards where applicable.

## Highlight Excerpts

`HighlightExcerpt` is the shared excerpt component for browse cards and the
canonical `/highlights` view.

Contract:

- Rounded quote block.
- Left border uses `border-trauma-quote-bar`.
- Background uses `bg-trauma-quote-bg`.
- Text uses `text-trauma-quote-ink`.
- Highlight text uses `mark` with `bg-trauma-highlight-bg`.
- Optional link wraps the whole excerpt.

Do not hand-roll separate highlight quote treatments for each route.

## Right Rail Sections

Right rail sections are independent islands.

Use them for lightweight filter and shortcut groups:

- Categories.
- Tags.
- Recent highlights.
- Reader table of contents, only as route-specific right rail content on a
  concrete memory route.

They should not become dense forms, search panels, settings pages, or broad
route content containers. Contextual route content must stay small enough to
act as a right rail aid rather than a second main pane.

When an island contains an unbounded list, the list body must be a bounded
scroll region. This is required for Recent highlights and reader TOC. Do not
let those islands grow vertically for every item.

Reader TOC should make overflow discoverable. When its bounded list can still
scroll downward, use a low-contrast bottom spotlight shadow anchored to the
bottom of the TOC island itself. The spotlight shadow is neutral black, not the
primary/accent colour. Do not anchor that shadow to the inner list body,
because the island padding makes it appear detached from the component.

## Add Memory Composer

The global composer uses the existing `AddMemoryForm` and existing
`POST /api/memories` flow.

Rules:

- The shell opens the composer as an anchored popover/dialog from the rail
  action on desktop shell layouts.
- The composer popover renders above the rail and main pane layers and must not
  be clipped by route content.
- The form accepts only URL input.
- Successful creation navigates to the created memory.
- On backup-failsafe errors, revalidate the backup alert.
- Do not add edit fields for title/body/tags in this composer.

## Backup Failsafe Banner

The backup failsafe banner is a route-global status surface rendered above
route content. It is an operational warning, not normal decoration.

Rules:

- Keep it visible above route content.
- Use state/severity tokens rather than route-specific styling.
- Keep recovery actions concrete and aligned with server behaviour.

## Empty, Loading, And Error States

State surfaces should be plain and content-oriented:

- Use route frame padding.
- Use `text-trauma-text-secondary` for explanatory text.
- Use `text-trauma-text-primary` for state headings.
- Avoid decorative cards unless the state is part of a framed tool.

Examples:

- Browse empty state: "No matching memories".
- Highlights empty state: "No highlights yet".
- Reader fallback state: status message with route frame padding.
