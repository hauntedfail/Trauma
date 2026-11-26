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

## Responsive Container Ownership

Reusable route surfaces should respond to their own available inline size
instead of assuming a device class.

Current shared responsive utilities:

- `trauma-route-surface` establishes a named query container for route-level
  spacing and row density.
- `trauma-memory-list` establishes a container for list/grid memory cards.
- `trauma-reader-surface` establishes a reader-specific query container.
- `trauma-fluid-route-padding`, `trauma-fluid-page-shell`,
  `trauma-fluid-reader-title`, and `trauma-fluid-component-gap` provide
  continuous sizing with `clamp()` and container query units.
- `trauma-safe-area-shell`, `trauma-safe-area-inline`, and
  `trauma-safe-area-bottom` route safe-area insets through layout tokens.

Viewport media queries should not own component layout. Use them for input
capability, user preference, or unavoidable shell chrome transitions only.

## Buttons

Use the shared control styles for actions that recur across routes.

- `trauma-control-primary` marks a commit action such as saving a URL. Pair it with `trauma-control` for the rounded rectangle and the theme’s foreground and accent pair.
- `trauma-control` gives an ordinary action a neutral surface. `trauma-control-quiet` groups repeated row actions without outlines around every label.
- Shape separates a command from a selection. Commands, tools, fields and menu rows share the `rounded-control` radius. Filter chips, taxonomy chips and reader variant tabs stay pill-shaped.
- A selected chip, tab or pressed `trauma-control` uses `accent-soft` with `accent-soft-ink` and an accent border. Solid accent belongs to `trauma-control-primary` alone, so a selection never reads as the commit action.
- Segmented choices sit in a sunken track and raise the selected segment.
- Use the filled navigation icon for the current destination.
- `trauma-tool` gives an icon action a consistent target and visible keyboard focus. Put its accessible name on the interactive element. `trauma-tool-compact` fits a dense card header.
- Moving a memory between lanes looks the same on a browse row and at the end of the reader. The reader marks the current lane with `aria-pressed`.
- Reserve destructive styling for irreversible changes. Archive has Undo and uses the secondary treatment.
- Coarse pointers raise every control and tool to a 44px target.

The Library icon is one open book with a single spine line. Its fold must stay
visible at the rail and phone-tab sizes in both the outline and filled states.

Use icons inside buttons when an icon exists. Do not replace familiar icon
actions with verbose text-only controls.

Read-status controls on memory cards and reader pages are icon-only action
buttons. They keep accessible labels on the button. Open eye means unread
(`read: false`), and closed eye means read (`read: true`).

Paper themes add one deliberate material exception for archive actions:

- Add-memory commands use the `trauma-paper-wax-seal` treatment.
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
  so Paper selected controls keep high-contrast text.
- Use `WaxSealButton` and `WaxSealLabel` for new wax controls. Do not repeat
  the raw `trauma-paper-wax-*` class contract in route or shell components
  unless the shared component cannot express the required element.

## Browse Header

The Memories browse header owns the read-state tabs, not a large route title
or list/grid toggle.

- Render exactly three equal-width tabs: `All`, `Unread`, and `Read`.
- `All` is the default state and removes read-state tokens from the search
  query.
- `Unread` appends the standalone `unread` search token.
- `Read` appends the standalone `read` search token.
- The search bar and URL remain the source of truth for the filter state.
- The active tab uses bold primary text plus a short rounded accent underline
  anchored to the tab bottom. Inactive tabs use muted text.
- The tab strip stays in one sticky row at every route width.
- These tabs are not wax controls. Paper/Hermès wax treatment remains reserved
  for archive commands such as Add memory.

## Shell Popovers

Left-rail transient controls open as anchored popovers rather than global
drawers:

- `Popup` (`src/components/ui/Popup.tsx`) is built on `@kobalte/core/popover`,
  rendering inside `Popover.Portal` on the client and falling back to inline
  `Popover.Content` during SSR (`isServer === true`).
- Theme settings and Add memory composer use the shared `Popup` shell with
  `role="dialog"`, `aria-haspopup`, `aria-expanded`, and `aria-controls`.
- General action menus use the same `Popup` shell with `role="menu"`. Memory,
  Moment, and Flashback delete actions use one danger menu-item treatment and
  the shared trash icon.
- Popup chrome is elevated and translucent by default: `Popup` owns the rounded
  border (`border-trauma-border/90`), `bg-trauma-bg-elev/95`, `backdrop-blur-xl`,
  inset hairline ring, layered shadow, `.trauma-ui-popover` enter transition,
  and `z-[70]` layer. Consumers only provide width, grid, gap, padding, text
  alignment, and placement-specific constraints.
- Popovers close on Escape, outside pointer interaction, or successful
  completion of the contained workflow.
- Opening moves focus into the panel. Escape and successful completion restore
  the opener; outside-pointer dismissal preserves focus on the outside target.
- Menu popovers expose a roving `menuitem` keyboard model for Arrow Up/Down,
  Home, and End, and close when Tab moves focus outside.
- Outside pointer dismissal is a cancel action for confirmation popovers. It
  closes the panel and resets draft form edits without submitting the action.
- Add memory keeps the shell-level command globally reachable, but the composer
  itself stays attached to the rail action that opened it.
- The primary rail must allow visible overflow and sit above route panes.
  Anchored popovers use a higher layer than the rail and main pane so their
  content is never clipped beneath the current route.

Shared modal dialog and sheet primitives follow the same elevated glass-hairline
surface contract:

- `TraumaDialog` (`src/components/ui/Dialog.tsx`) wraps `@kobalte/core/dialog`
  with portalled modal focus trapping, backdrop blur (`.trauma-ui-backdrop`),
  Escape/outside-click dismissal, and `.trauma-ui-dialog` enter transitions.
  `CommandPalette` (`#trauma-command-palette`) mounts inside `TraumaDialog`.
- `TraumaSheet` (`src/components/ui/Sheet.tsx`) wraps `@corvu/drawer` for
  swipeable side/bottom sheets (`modal={false}`, Escape dismissal, touch-drag
  dismissal on narrower viewports, docked without a heavy backdrop at
  `>= 1440px`). `MemoryReader` uses `TraumaSheet` for the on-demand
  Psychiatrist sheet.

## Form Inputs

Inputs use semantic surfaces:

- Base input: `bg-trauma-bg-surface` or transparent inside an elevated wrapper.
- Border: `border-trauma-border-strong` for standalone fields.
- Placeholder: `text-trauma-text-placeholder`.
- Minimum height: at least `42px`.
- `trauma-field` supplies the standalone border, radius and focus outline for
  inputs, selects and textareas in the shell, reader and command palette.

Search inputs:

- The browse route owns the memory search field.
- The focus indicator belongs to the rounded search surface itself, using an
  inset ring so focus corners follow the search bar shape.
- The right rail does not contain a search field.

## Taxonomy Rendering

Use `TaxonomyList` for category/tag chips and right-rail taxonomy filters.

- `mode="chips"` renders attached categories/tags on memory rows and reader
  intros, and the same chip styling is also used for right-rail category/tag
  filters.
- Use `density="compact"` for right-rail chip lists when the section needs
  tighter item spacing than memory-row metadata.
- Selectable chips use `aria-pressed` for active right-rail filters.
- `mode="filters"` remains available for full-width taxonomy controls, but the
  current shell does not use it for the right rail.
- Parents own route/query state; taxonomy rendering components do not know
  browse query keys.

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

## Flashback Excerpts

`FlashbackInlineText` is the shared text primitive for right-rail Flashback
shortcuts and the canonical `/flashbacks` view. `FlashbackExcerpt` is only a
thin browse-card wrapper around the same primitive.

Contract:

- Prefix and suffix context render around the selected Flashback text.
- Context uses theme secondary/tertiary foreground tokens plus the shared
  Flashback context blur/mask treatment, so it stays visibly lower contrast
  than the selected text. The blur belongs to the prefix/suffix text spans, not
  to the whole Flashback card, list, or right-rail island.
- The selected Flashback string uses normal primary readable contrast and a
  semantic `mark` element without becoming a separate highlighter badge.
- Optional link wraps the whole excerpt.

Do not hand-roll separate Flashback text treatments for each route. `/flashbacks`
uses dense route rows: shared inline Flashback text first, then the source
memory title as small supplemental metadata at the bottom.

## Collection Page Controls

Flashbacks and Moments expose compact First/Next link navigation below the
current route rows. The controls operate on URL cursor state and replace the
visible rows. Loading uses `aria-busy`; failed page loads use an assertive alert;
an empty continuation page remains distinct from an empty archive.

## Right Rail Sections

Right rail sections are independent islands.

Use them for lightweight filter and shortcut groups:

- Categories.
- Tags.
- Flashback shortcuts.
- Reader table of contents, only as route-specific right rail content on a
  ready source or translated memory route.

They should not become dense forms, search panels, settings pages, or broad
route content containers. Contextual route content must stay small enough to
act as a right rail aid rather than a second main pane.

When an island contains an unbounded list, the list body must be a bounded
scroll region. This is required for Flashback shortcut lists and reader TOC. Do
not let those islands grow vertically for every item.

Reader TOC should make overflow discoverable. When the bounded TOC can still
scroll in a direction, show a low-contrast blur fade on that edge only. The fade
should make the edge entries look slightly hazy, not like a heavy shadow or
spotlight. Use neutral black in the fade recipe, not the primary/accent colour.
The top fade must start at the scroll body edge so text cannot appear unblurred
between the heading and the fade. Use CSS gradients and masks to soften the fade
boundary. Do not render a fade for a direction that is not currently scrollable.

Flashback shortcut lists do not use TOC scroll-edge overlays. Their focal
treatment is per Flashback item: selected text remains normal and readable,
while the stored prefix/suffix context uses the shared Flashback context
blur/mask classes.

Reader All Flashbacks is a bounded page, not an unbounded shortcut group. Its
list body owns `max-height`, vertical overflow, and overscroll containment, and
its First/Previous/Next controls use rail-local cursor history. Switching to
Current and back to All preserves that local page.

## Add Memory Composer

The global composer uses the existing `AddMemoryForm` and existing
`POST /api/memories` flow.

Rules:

- The shell opens the composer as an anchored popover/dialog from the rail
  action on desktop shell layouts.
- On phone layouts, the same composer opens as a popover above the bottom
  `Primary tabs` bar.
- The composer popover renders above the rail and main pane layers and must not
  be clipped by route content.
- The form accepts only URL input.
- The submit button uses the primary command treatment. The rail trigger uses the icon-tool treatment.
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
- When a config revert suspends storage, disable every recovery action and show
  a persistent instruction to restart the TRAUMA process/server. Do not reload
  the page into the suspended process.

## Empty, Loading, And Error States

State surfaces should be plain and content-oriented:

- Use route frame padding.
- Use `text-trauma-text-secondary` for explanatory text.
- Use `text-trauma-text-primary` for state headings.
- Avoid decorative cards unless the state is part of a framed tool.

Examples:

- Browse empty state: "No matching memories".
- Flashbacks empty state: "No flashbacks yet".
- Reader fallback state: status message with route frame padding.
