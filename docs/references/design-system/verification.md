# Design System Verification

## Required Checks

For design-system or front-end implementation changes, run:

```bash
bun run typecheck
bun run test
bun run build
```

For browser-facing layout, route, or interaction changes, also run:

```bash
bun run test:e2e
```

For a full final pass:

```bash
bun run verify
bun run test:e2e
```

## Focused Contract Tests

Design contracts are guarded by focused tests:

- `tests/scripts/frontend-refine-tokens.test.ts`
- `tests/components/app-shell.test.ts`
- `tests/components/shell-theme.test.ts`
- `tests/components/mobile-responsive-contract.test.ts`
- `e2e/browse-shell.spec.ts`
- `e2e/cross-device-responsive.spec.ts`
- `e2e/reader.spec.ts`

When a design rule can be checked statically, add a focused contract test
instead of only documenting it.

## Current Token Checks

The token tests verify:

- All refined theme selectors exist.
- Semantic Tailwind colour variables are exposed.
- Reader link tokens `--color-trauma-link` and
  `--color-trauma-link-hover` are exposed.
- Midnight uses pure black root background.
- Midnight pane surfaces are pure black.
- Every theme uses one pane background colour:
  `--bg-base == --bg-surface`.
- Paper sun exposes the paper texture variable set.
- Paper night exposes the leather texture variable set while retaining the
  `paper-black-dark` theme name.
- The surface toggle labels are Light/Paper in sun brightness and
  Midnight/Hermès in night brightness while stored surface values remain
  `normal` and `paper`.
- Linked flashback anchor tokens exist per theme and are not reused blindly from
  the default yellow flashback colours.
- Material textures render through layered backgrounds plus fixed grain/fibre/pore
  and glow overlays.
- Paper mode material textures do not include repeating dot/grid overlays.
- Typography stays local and does not use negative letter spacing.

## Current Shell Checks

The shell tests verify:

- The refined brand mark and icon system are used.
- Theme controls are local browser state only.
- Missing routes are not linked.
- Desktop shell columns use `275px / minmax(0,840px) / 360px`.
- Route panes fill the shell column.
- Right rail sections are independent islands.
- Left rail scale and vertical rhythm stay within the documented design-system
  contract.
- Left rail tab labels keep enough line-height for descenders.
- Selected theme options stay visible in Midnight.
- Paper themes render the active desktop left-rail underline from the rail item
  geometry, gated by the left-rail container width, not from the text span
  width.
- Desktop shell grid remains `275px / minmax(0,840px) / 360px`.
- Mobile route surfaces use container-owned responsive utilities, safe-area
  tokens, and mobile viewport units instead of route-local `100vh`.
- Phone shell chrome uses `Primary tabs`; stale navigation and filter drawers
  are absent.
- Reader and importer image handling preserve safe responsive image markup.
- The brand mark remains the existing PNG-only chrome.
- Phone tabs use larger dedicated icon slots and do not render paper/Hermès
  underline decoration.
- Tablet and phone theme popovers keep readable labelled toggle buttons.

## Browser Verification

Use Playwright or browser automation to verify the visual contracts that static
tests cannot fully prove:

- `/memories` desktop.
- `/memories?view=grid` desktop.
- `/flashbacks` desktop.
- `/memories/:id` reader.
- `/memories` tablet.
- `/memories` mobile.

Check:

- No horizontal overflow.
- Left rail and route pane backgrounds match in every theme.
- Right rail is hidden below desktop.
- Phone uses the bottom `Primary tabs` bar; mobile navigation/filter drawers are
  not present.
- Phone `Primary tabs` render every rail item and use tab-bar-only horizontal
  scrolling when constrained.
- Phone tab labels are visually hidden while role names remain available.
- On phone, Memories read-state tabs stay as one sticky equal-width header row
  and the obsolete List/Grid view controls are absent.
- Tablet uses the compact icon rail and does not duplicate brand/filter header
  chrome.
- Theme controls are hidden until the left-rail `Theme` tab opens their popover.
- On phone, Theme opens from the bottom tab bar as a popover above the bar.
- Theme selected state is visible inside the popover in every theme.
- Theme popover buttons remain labelled and readable below desktop.
- Add-memory composer opens from shell routes as a popover above route panes.
- On phone, Add memory opens from the bottom tab bar as a popover above the bar.
- Tablet compact Add memory uses a centered icon-only control without paper or
  Hermès wax-seal chrome shifting the icon.
- Browse filters update URL state without clearing unrelated query state.
- Reader links remain readable in Light, Paper, Midnight, and Hermès modes.
- Linked flashback hash targets remain readable in every theme.
- Reader TOC scroll fades appear only on scrollable edges. The top fade begins
  at the bounded list edge after scrolling down, and CSS mask gradients soften
  the transition into unblurred content.

## Screenshot Review

For substantial UI changes, capture or inspect desktop and mobile screenshots.
Compare them to this design-system reference and the implemented route
contracts.

Do not accept screenshots where:

- Text overflows buttons, cards, or rails.
- Panes show unintended background gutters.
- Route panes are centred inside the main column.
- Right rail islands merge into a single panel.
- Icon-only controls lack accessible labels.
