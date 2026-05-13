# Layout And Shell

## Desktop Shell Grid

The desktop shell is a three-column grid:

```text
275px left rail / minmax(0, 840px) main pane / 360px right rail
```

The shell is centred with `justify-center`, but panes themselves are flush.
There must be no contrasting gutter between the left rail and main pane.

Column separation is done with `border-trauma-border`.

## Left Rail

The left rail is the primary navigation surface. It is global, route-agnostic,
and visible on desktop and tablet.

Current desktop contract:

- Width: `275px`.
- Surface: `bg-trauma-bg-base`.
- Padding: `px-2 py-1 pb-3`.
- Position: sticky, full viewport height.
- Border: right border only.
- Internal layout: `flex flex-col gap-1.5`.

Navigation item contract:

- Grid: `grid-cols-[32px_minmax(0,1fr)]`.
- Icon/text gap: `18px`.
- Minimum height: `3rem`.
- Text size: `19px`.
- Shape: rounded full pill.
- Active route: accent-soft background and bold text.
- Disabled/future routes: disabled button, low opacity, no live link.

The rail may show future controls such as Backup and Settings, but they must
remain disabled until their routes exist.

## Add Memory Action

`Add memory` is a global shell action and opens the shared composer drawer.

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

Theme controls are inside the left rail and persist only to browser
`localStorage`.

Selection rules:

- Use `aria-pressed`.
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
- Route frames use `min-h-screen w-full bg-trauma-bg-surface`.

Because `bg-surface` equals `bg-base`, route panes visually continue the page
background in all themes.

## Right Rail

The right rail is not a mirrored left rail. It is a base-colour column with
independent rounded islands.

Current desktop contract:

- Width: `360px`.
- Surface: `bg-trauma-bg-base`.
- Padding: `px-6 py-4`.
- Hidden on tablet and mobile.
- Contains no search input.

Island contract:

- Component: `RightPanelSection`.
- Radius: `rounded-[32px]`.
- Border: `border-trauma-border`.
- Background: `bg-trauma-bg-base`.
- Padding: `p-5`.

Current islands:

- Categories.
- Tags.
- Recent highlights.

## Tablet And Mobile

Breakpoints:

- Desktop: `min-[1041px]`.
- Tablet: `max-[1040px]`.
- Mobile: `max-[720px]`.

Tablet:

- Left rail collapses to an `80px` icon rail.
- Right rail is hidden.
- Main pane starts at column 2.
- Filter access is available from shell controls.

Mobile:

- The persistent left rail is hidden.
- A sticky top bar provides navigation and filter drawer access.
- Drawers use `w-[min(86vw,360px)]`, full viewport height, and
  `shadow-trauma-drawer`.

## Route Frame Ownership

Route frame classes belong to the route surface, not the shell. The shell owns
columns, global navigation, drawers, and global composer state. Route files own
headers, search controls, list/grid mode, empty states, reader content, and
route-specific loading states.
