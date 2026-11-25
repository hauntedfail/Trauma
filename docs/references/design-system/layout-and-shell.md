# Layout And Shell

## Desktop And Tablet Shell Grid

The desktop and tablet shell (`min-width: 721px`) is a two-column focus-first grid:

```text
56px icon-only left rail / minmax(0, 1fr) centered main canvas (max-width: 920px)
```

There is no persistent right rail. Panes are flush with no contrasting gutter
or material seam between the left rail and the main canvas.

Column separation is always done with `border-trauma-border`. Paper/Hermès
must keep those borders while avoiding pane-local background seams.

## Left Rail

The left rail is the primary navigation surface. It is global, route-agnostic,
and visible on desktop and tablet (`min-width: 721px`). On reader routes
(`/memories/:id` and `/memories/:langCode/:id`), it auto-hides on downward
scroll (`data-rail-hidden="true"`) and reveals on upward scroll, left-edge
pointer proximity, or keyboard focus (`prefers-reduced-motion: reduce` disables
the slide/fade transition).

Current desktop/tablet contract:

- Width: `56px` icon-only rail.
- Surface: `bg-trauma-bg-base`.
- Paper/Hermès material: the app background is one global body-level material.
  Shell panes and route panes must stay transparent so the material reads as a
  continuous surface.
- Do not add pane-local paper/leather background images or rail-only overlays;
  those create visible material seams between major panes. Keep the intended
  column borders as borders, not as background colour changes.
- Hermès uses leather pore/fiber/grain noise over a flat base. Do not add broad
  radial glow, blob, or vignette gradients.
- Position: sticky, full viewport height (`h-[100svh]`).
- Border: right border only.
- Brand/home mark: centered inside the `40px` icon slot.

Navigation item contract:

- Icon-only `40px` square hit targets with tooltips and accessible names.
- Shape: rounded full pill for hit area only; active state must not add a
  selected pill fill, unread count pip, or surrounding primary-colour highlight.
- Active route, all themes: use the filled icon variant.
- Active route, paper themes on left rail: draw the hand-written underline
  under the active icon. Honour `prefers-reduced-motion: reduce` by showing the
  completed underline without animation.
- Phone bottom tabs must not render the paper underline.

`Today`, `Shelf`, `Library`, `Flashbacks`, `Moments`, and `Settings` are live
rail routes. There are no disabled placeholder tabs.

## Add Memory Action And Command Palette

`Add memory` is a normal icon button in the left rail (not an accent wax-seal
CTA) that opens the shared capture popover. Capture accepts one URL and lands
items directly on `Shelf` without asking for categories or tags.

`Cmd/Ctrl+K` opens the global Command Palette (`CommandPalette.tsx`) from every
route, providing search, route navigation, URL capture, and Focus plugin
toggles.

## Theme Controls

Theme controls are opened from the `Theme` icon button in the left rail (or
inside the phone `More` sheet) and persist only to browser `localStorage`. The
full control block must not be constantly expanded in the rail.

Interaction rules:

- Clicking the button opens a small popover with brightness and surface
  controls.
- Escape and outside pointer interaction dismiss the popover cleanly.

Selection rules:

- Use `aria-pressed`.
- The stored `normal` surface value is labelled Light in sun brightness and
  Midnight in night brightness.
- The stored `paper` surface value is labelled Paper in sun brightness and
  Hermès in night brightness.
- Selected options must use `bg-trauma-bg-elev` plus an inset strong-border
  ring.
- Do not use `bg-trauma-bg-surface` for selected state because surface equals
  base in every theme.

## Main Pane

The main pane is the route-owned content column.

Rules:

- It must fill its grid column.
- It must not centre itself with `mx-auto`.
- It must not use `w-[min(...)]` or `max-w-*` route wrappers.
- Route frames use `trauma-route-surface`, `trauma-mobile-stable-viewport`,
  `w-full`, and `bg-trauma-bg-surface`.
- Route headers and route rows use route-owned responsive utility classes such
  as `trauma-fluid-route-padding`, `trauma-route-header`, and
  `trauma-route-row`.

Because `bg-surface` equals `bg-base`, route panes visually continue the page
background in Light and Midnight. Paper/Hermès override the shell and route
frame backgrounds to transparent so the single body-level material remains
continuous.

## Right Rail (Removed)

The legacy `360px` persistent right rail and `right-rail-context.tsx` have been
removed. Taxonomy filters moved into the on-demand Library `Filters` popover,
and peripheral reader aids (Outline, Marks, Translate, Details, Psychiatrist)
moved into the single on-demand right-side reader `Inspector` dialog.

## Tablet And Mobile

The shell has structural thresholds for its global chrome, but route and
component sizing should be content-driven. Do not encode phone or iPad design
rules inside route components when a container query, logical property, or
fluid token can express the same behaviour.

Shell thresholds:

- Desktop and tablet: `min-[721px]`, slim `56px` icon-only left rail and
  centered route content (`max-w-[920px]`).
- Phone: `max-[720px]`, compact brand header, route content, and fixed bottom
  `Primary tabs` bar.

Responsive implementation stack:

- CSS Grid for the application shell and major two-dimensional route layouts.
- Flexbox only for local one-dimensional wraps such as toolbars, tag rows, and
  compact button groups.
- `clamp()`, `min()`, and `max()` for continuous spacing and typography.
- Container queries and container query units for component-owned layout
  changes.
- `svh`, `dvh`, and `lvh` for mobile viewport-height surfaces.
- `env(safe-area-inset-*)` surfaced through shell layout tokens.
- Capability and preference media queries only, such as `hover`, `pointer`,
  `prefers-reduced-motion`, `forced-colors`, `prefers-contrast`, and
  `orientation`.

Phone:

- The persistent left rail is hidden.
- Compact top brand header exposes Search/Command Palette and Capture actions.
- Primary navigation is the bottom `Primary tabs` bar with exactly four live
  tabs: `Today`, `Shelf`, `Library`, and `More`.
- `More` opens a sheet containing `Flashbacks`, `Moments`, `Settings`, and
  `Theme`.
- No disabled placeholder tabs and no side filter drawer.
- Phone route content reserves bottom safe-area space so the tab bar does not
  cover interactive content.

## Responsive Images

Rendered markdown must use HTML-level responsive image support where the source
provides it. CSS `max-width: 100%` is still required, but it is not a replacement
for `srcset`, `sizes`, and `picture/source` markup. The TRAUMA brand mark remains
the existing PNG chrome and should not be changed as part of reader image work.

Reader image contract:

- Sanitized markdown rendering may preserve safe `picture`, `source`,
  `srcset`, `sizes`, and `decoding` attributes.
- Unsafe candidates are removed rather than passed through.
- Reader images remain constrained to their content column with
  `prose-img:max-w-full` and route-owned fluid wrappers.

## Route Frame Ownership

Route frame classes belong to the route surface, not the shell. The shell owns
columns, global navigation, Command Palette, bottom phone tabs, global composer
and theme popover state, and backup failsafe banner. Route files own headers,
search controls, lane/triage controls, empty states, reader content, and
route-specific loading states.
