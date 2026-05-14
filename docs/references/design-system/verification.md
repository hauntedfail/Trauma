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
- `e2e/browse-shell.spec.ts`
- `e2e/reader.spec.ts`

When a design rule can be checked statically, add a focused contract test
instead of only documenting it.

## Current Token Checks

The token tests verify:

- All refined theme selectors exist.
- Semantic Tailwind colour variables are exposed.
- Normal night mode uses pure black root background.
- Normal night mode pane surfaces are pure black.
- Every theme uses one pane background colour:
  `--bg-base == --bg-surface`.
- Paper sun exposes the paper texture variable set.
- Paper night exposes the leather texture variable set while retaining the
  `paper-black-dark` theme name.
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
- Left rail scale and vertical rhythm stay close to the refined sample.
- Left rail tab labels keep enough line-height for descenders.
- Selected theme options stay visible in normal night mode.
- Paper themes replace the active left-rail pill with a handwritten underline
  animation.

## Browser Verification

Use Playwright or browser automation to verify the visual contracts that static
tests cannot fully prove:

- `/memories` desktop.
- `/memories?view=grid` desktop.
- `/highlights` desktop.
- `/memories/:id` reader.
- `/memories` tablet.
- `/memories` mobile.

Check:

- No horizontal overflow.
- Left rail and route pane backgrounds match in every theme.
- Right rail is hidden below desktop.
- Mobile drawers are reachable.
- Theme controls are hidden until the left-rail `Theme` tab opens their popover.
- Theme selected state is visible inside the popover in every theme.
- Add-memory composer opens from shell routes.
- Browse filters update URL state without clearing unrelated query state.

## Screenshot Review

For substantial UI changes, capture or inspect desktop and mobile screenshots.
Compare them to the refined sample and to this design-system reference.

Do not accept screenshots where:

- Text overflows buttons, cards, or rails.
- Panes show unintended background gutters.
- Route panes are centred inside the main column.
- Right rail islands merge into a single panel.
- Icon-only controls lack accessible labels.
