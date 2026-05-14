# Layout And Shell

## Desktop Shell Grid

The desktop shell is a three-column grid:

```text
275px left rail / minmax(0, 840px) main pane / 360px right rail
```

The shell is centred with `justify-center`, but panes themselves are flush.
There must be no contrasting gutter or material seam between the left rail,
main pane, and right rail.

Column separation is always done with `border-trauma-border`. Paper/Hermès
must keep those borders while avoiding pane-local background seams.

## Left Rail

The left rail is the primary navigation surface. It is global, route-agnostic,
and visible on desktop and tablet.

Current desktop contract:

- Width: `275px`.
- Surface: `bg-trauma-bg-base`.
- Paper/Hermès material: the app background is one global body-level material.
  Shell panes and route panes must stay transparent so the material reads as a
  continuous surface.
- Do not add pane-local paper/leather background images or rail-only overlays;
  those create visible material seams between major panes. Keep the intended
  column borders as borders, not as background colour changes.
- Hermès uses leather pore/fiber/grain noise over a flat base. Do not add broad
  radial glow, blob, or vignette gradients.
- Padding: `px-2 py-1 pb-3`.
- Position: sticky, full viewport height.
- Border: right border only.
- Internal layout: `flex flex-col gap-1.5`.
- Brand/home mark: use a `36px` mark with `px-2.5` so its centre aligns with
  the `40px` navigation icon column.

Navigation item contract:

- Grid: `grid-cols-[40px_minmax(0,1fr)]`.
- Icon/text gap: `18px`.
- Minimum height: `3rem`.
- Text size: `19px`.
- Text line-height: at least `1.2` so descenders such as `g`, `q`, `p`, and
  `y` are not clipped.
- Shape: rounded full pill for hit area only; active state must not add a
  selected pill fill or surrounding primary-colour highlight.
- Active route, all themes: use the filled icon variant and bold visible tab
  label.
- Active route, paper themes on desktop rail: keep the hand-drawn underline
  below the visible text label only. The underline is a marker-like filled band,
  not a thin stroked path. Status pips and secondary adornments must sit outside
  the underline target.
- Paper active underline draws from left to right on page render. Honour
  reduced-motion by showing the completed underline without animation.
- Tablet icon rail and phone bottom tabs must not render the paper underline.
- Disabled/future routes: disabled button, low opacity, no live link.

The rail may show future controls such as Backup and Settings, but they must
remain disabled until their routes exist.

## Add Memory Action

`Add memory` is a global shell action and opens the shared composer popover
from the rail action on desktop shell layouts.

Current rail button contract:

- Minimum height: `52px`.
- Horizontal margin: `mx-1`.
- Vertical margin: `my-3.5`.
- Full pill shape.
- Accent background.
- Extra-bold `17px` label.

Do not duplicate route-local add-memory forms when the shell action is
sufficient.

## Local Archive Surface

The local archive row sits at the bottom of the left rail. It is not an auth
profile and must not imply account management.

Current contract:

- Transparent background by default.
- Rounded full hover target.
- `40px` mark/avatar cell.
- Text shows local archive status and storage location.

## Theme Controls

Theme controls are opened from a normal `Theme` tab in the left rail and persist
only to browser `localStorage`. The full control block must not be constantly
expanded in the rail.

Interaction rules:

- The `Theme` tab uses the same left-rail tab scale and icon/text rhythm as
  other navigation controls.
- The `Theme` tab sits between `Backup` and `Settings`.
- Clicking the tab opens a small popover from that tab.
- The popover contains the existing brightness and surface controls.
- Escape and outside pointer interaction close the popover.

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
background in normal themes. Paper/Hermès override the shell and route frame
backgrounds to transparent so the single body-level material remains
continuous.

## Right Rail

The right rail is not a mirrored left rail. In normal themes it is a base-colour
column with independent rounded islands. In Paper/Hermès, the column frame is
transparent over the global material and the islands keep their own framed
surfaces.

Current desktop contract:

- Width: `360px`.
- Surface: `bg-trauma-bg-base`.
- Padding: `px-6 py-4`.
- Height: fixed to the viewport.
- Overflow: the rail frame is bounded; scrollable content must be explicit.
- Hidden on tablet and mobile.
- Contains no search input.

Island contract:

- Component: `RightPanelSection`.
- Radius: `rounded-[20px]`.
- Border: `border-trauma-border`.
- Background: `bg-trauma-bg-base`.
- Padding: `p-5`.

Current islands:

- Categories.
- Tags.
- Recent highlights.

Route-specific content may be inserted above these browse filters when a route
has a strong contextual aid. The current example is the reader table of
contents on `/memories/:id`. This content is registered through the shell right
rail context, appears before browse filters, and is cleared when the route
unmounts. Do not show reader TOC content on `/memories`, `/highlights`, or other
non-reader routes.

Long right-rail aids must not grow the application layout by item count. TOC and
Recent highlights render their item bodies as bounded scroll regions. The rail
itself remains viewport-bound, and each long list owns its own scrolling.

## Tablet And Mobile

The shell has structural thresholds for its global chrome, but route and
component sizing should be content-driven. Do not encode phone or iPad design
rules inside route components when a container query, logical property, or
fluid token can express the same behaviour.

Shell thresholds:

- Desktop: `min-[1041px]`, three columns.
- Tablet: `721px` through `1040px`, compact left rail and route content.
- Phone: `max-[720px]`, route content plus bottom primary tabs.

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

Tablet:

- Left rail collapses to an `80px` icon rail.
- Rail labels are visually hidden; icon size, icon slot, and brand mark remain
  aligned to the same `40px` rhythm.
- Right rail is hidden.
- Main pane starts at column 2.
- Header chrome does not duplicate the brand or filter affordances. There is no
  filter drawer on tablet.
- Theme and Add memory remain available from left-rail popovers. Those popovers
  must render above the route pane.

Phone:

- The persistent left rail is hidden.
- Primary navigation is the bottom `Primary tabs` bar, using a native-app-like
  tab layout.
- The phone tab bar renders every primary rail item: Memories, Highlights,
  Categories, Tags, Backup, Add memory, Theme, and Settings.
- When all tabs do not fit, only the tab bar scrolls horizontally. Do not drop
  tabs or reintroduce navigation/filter drawers.
- Future or unavailable sections are rendered as disabled tabs rather than live
  links to routes that do not exist.
- Phone tab icons use a dedicated larger icon slot than the compact tablet rail.
- Phone tab text labels are visually hidden. Keep accessible names on the tabs,
  but do not render visible text in the bottom bar.
- Add memory and Theme open popovers above the bottom bar.
- Right rail content and filter drawers are not rendered as mobile chrome.
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
columns, global navigation, bottom phone tabs, global composer popover state,
and the right rail slot. Route files own
headers, search controls, list/grid mode, empty states, reader content, and
route-specific loading states.
