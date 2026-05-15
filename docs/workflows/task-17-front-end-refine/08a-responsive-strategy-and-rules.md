# Task 17.8a: Responsive Strategy And Rules

## Purpose

This file defines the responsive policy for Task 17.8. Implementation workers
must read this before changing CSS, JSX, tests, or design-system docs.

## Architecture

Use a container-query-first strategy for route and component responsiveness.
Viewport breakpoints may remain only for true shell-level structure such as
desktop/tablet/mobile navigation presence. Component density, typography,
spacing, row/card shape, and control grouping should respond to the width of
the component's containing pane.

Use continuous sizing with `clamp()`, `min()`, and `max()` for spacing,
font-size, radius, control size, and component min-size when a value should
scale gradually. Use discrete `@container` branches only when layout topology
changes, such as switching a memory card from two columns to one column.

The strategic shift is from viewport breakpoint-driven design to
content-driven and component-driven intrinsic responsive design. Viewport width
may still choose global shell topology, but reusable surfaces should respond to
their own content, available container space, input capabilities, and user
preferences.

## Tech Stack

- SolidStart component boundaries already used by Task 17.
- Tailwind v4 utilities from `src/styles/tailwind.css`.
- CSS Grid for two-dimensional shell, route, card-grid, and reader structure.
- CSS Container Queries with `container-type: inline-size`.
- Container query units: `cqi`, `cqb`, `cqmin`, and `cqmax`.
- CSS math functions: `clamp()`, `min()`, and `max()`.
- CSS Media Queries for input capability, orientation, and user preference
  detection.
- CSS Flexbox only for local one-dimensional layout with wrapping.
- Mobile viewport units: `svh`, `dvh`, and `lvh`.
- HTML responsive image primitives: `srcset`, `sizes`, `<picture>`, and
  `<source>`.
- CSS environment variables through `env(safe-area-inset-*)` for safe-area
  layout tokens.
- Vitest source-contract tests for responsive policy.
- Playwright E2E for mobile and cross-device layout behaviour.

## Source References

- MDN CSS container queries:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_container_queries`
- MDN `container-type`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/container-type`
- web.dev CSS container queries:
  `https://web.dev/learn/css/container-queries/`
- web.dev CSS sizing units:
  `https://web.dev/learn/css/sizing/`
- MDN `clamp()`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/clamp`
- MDN CSS `<length>` viewport units:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length`
- web.dev large, small, and dynamic viewport units:
  `https://web.dev/blog/viewport-units`
- MDN using media queries:
  `https://developer.mozilla.org/docs/Web/CSS/CSS_media_queries/Using_media_queries`
- MDN `@media`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/%40media`
- MDN responsive images:
  `https://developer.mozilla.org/docs/Web/HTML/Guides/Responsive_images`
- MDN `<picture>` element:
  `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture`
- MDN CSS `env()`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env`
- MDN using CSS environment variables:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables/Using`
- MDN CSS logical properties and values:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values`
- MDN basic concepts of flexbox:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox`
- MDN `flex-wrap`:
  `https://developer.mozilla.org/en-US/docs/Web/CSS/flex-wrap`

## Worker Contract

- Work on `refine/frontend-sample` or a branch based on it.
- Do not alter desktop layout tokens unless a test proves the value also
  controls mobile-only behaviour. If a shared token must change, add a test that
  proves desktop shell dimensions are unchanged.
- Do not add iPad-specific, phone-model-specific, or device-width-specific
  branches as the primary responsive mechanism.
- Do not implement responsive behaviour as viewport breakpoint-driven design
  when content-driven or component-driven intrinsic layout can express the same
  behaviour.
- Do not use fixed viewport breakpoints for component internals when a
  container query can express the same adaptation.
- Do not use CSS `@media` or JavaScript `matchMedia()` as phone, tablet, iPad,
  or arbitrary viewport-width detection. Use them for capabilities and
  preferences such as `hover`, `pointer`, `prefers-reduced-motion`,
  `forced-colors`, `prefers-contrast`, `prefers-color-scheme`, and
  `orientation`.
- Do not use viewport units as the primary unit for component-internal
  typography or spacing. Prefer container query units when the component's
  containing pane is the relevant constraint.
- Do not use `100vh` for mobile full-height surfaces. Use `svh`, `dvh`, or
  `lvh` according to whether the surface must be stable, dynamic, or immersive.
- Do not call `env(safe-area-inset-*)` directly from component class strings or
  route-local style blocks. Define safe-area layout tokens and reusable
  utilities in `src/styles/tailwind.css`, then apply those utilities to shell,
  fixed toolbar, bottom tab bar, and bottom action surfaces.
- Do not treat `max-width: 100%` as the complete image responsiveness strategy.
  Use `srcset`, `sizes`, and `<picture>` for owned images and reader content
  when trustworthy variants exist.
- Do not fabricate `srcset` entries by repeating the same URL with different
  descriptors. If the app has only one trustworthy source URL, keep a plain
  `img` and document the limitation instead of pretending to optimize network
  cost.
- Do not introduce fixed-width route/page shells. Route content should be
  constrained fluid with logical sizing and spacing properties.
- Do not use flexbox as a page, shell, route, or card-grid layout system. Flex
  is for local one-dimensional clusters that may wrap.
- Do not reintroduce `src/styles/app.css`.
- Do not change server, importer, backup, extension, database, or markdown
  reader behaviour.
- Preserve accessibility: keyboard focus, readable text, non-overlapping
  controls, and reachable navigation/popover actions across narrow containers.

## Container-First Responsiveness

Use `container-type: inline-size` on route-level and component-level wrappers
that own responsive child layout. Prefer named containers when the rule needs a
specific ancestor:

```css
.trauma-memory-surface {
  container: trauma-memory-surface / inline-size;
}

@container trauma-memory-surface (width < 36rem) {
  .trauma-memory-card {
    grid-template-columns: 1fr;
  }
}
```

Use unnamed containers only for local, unambiguous component rules. Do not make
`body`, the whole app shell, or every element a query container.

## Grid-First Structural Layout

Use CSS Grid for two-dimensional structure: app shell columns, route scaffolds,
memory grids, reader layout, and any layout where rows and columns both matter.
Grid is the default structural tool for content-driven responsive design because
it lets the layout adapt to available space without turning every component into
a device-width branch.

Rules:

- Prefer grid for shell, route, page, card-grid, and reader structure.
- Use intrinsic grid tracks such as `minmax(0, 1fr)`, `auto`, and content-sized
  columns instead of hard device assumptions.
- Keep Flexbox for local one-dimensional clusters; do not use flex to emulate
  two-dimensional layout.

## Viewport Breakpoint Limits

Viewport breakpoints are still acceptable for global shell topology:

- Desktop shell: left rail + main pane + right rail.
- Tablet shell: compact icon-only left rail + main pane. Header chrome, right
  rail, filter button, and filter drawer are not displayed for tablet layout.
- Mobile shell: main pane + native-app-style bottom tab bar. Brand text, side
  rail, right rail, filter button, and navigation/filter drawers are not
  displayed for mobile layout.

Inside route surfaces and reusable components, replace hard `max-[720px]` or
`max-[1040px]` assumptions with container queries where the rule is about the
available component width rather than the whole viewport.

## Cross-Device Shell Chrome

This task does not redesign the desktop shell or alter the primary visual
design. It only makes the existing design system render cleanly across tablet,
mobile, split-view, and narrow containers.

Rules:

- Tablet uses the left pane as an icon-only rail. Text labels are not visible,
  and every nav icon, disabled icon, theme icon, add-memory icon, archive icon,
  and brand mark shares the same visual slot and alignment.
- The TRAUMA brand name is desktop-only. Tablet and mobile use the mark only.
- Do not render duplicate brand logo groups in the responsive header. At most
  one brand mark should be visible in a mobile/tablet shell region.
- Tablet should not render the mobile top header; its shell follows the desktop
  pattern: left rail + main pane.
- Phone should not render the tablet/desktop left pane. It renders the
  actionable left-pane tabs in a fixed bottom tab bar with safe-area bottom
  padding.
- The right rail is desktop-only. Tablet and phone do not need right-rail
  content or a filter drawer substitute.
- Delete the filter button/drawer path and the mobile navigation drawer path
  instead of hiding broken menus behind another breakpoint.
- Theme popover must be anchored to the rail icon and layer above the main pane
  without clipping. It should behave as cleanly as the add-memory composer
  popover.

Detailed implementation steps live in
[08j Cross-Device Shell Chrome Cleanup](08j-cross-device-shell-chrome-cleanup.md).

## Continuous Sizing

Use CSS math for values that should scale smoothly:

```css
.trauma-fluid-route-padding {
  padding-inline: clamp(1rem, 4cqi, 2rem);
}

.trauma-fluid-title {
  font-size: clamp(1.875rem, 1.2rem + 2cqi, 3rem);
}
```

Rules:

- Keep minimum sizes large enough for touch targets and text readability.
- Keep maximum sizes aligned with the refined desktop design.
- Do not scale every font with viewport width. Use container-relative sizing
  only where the component width is the correct constraint.
- Prefer `cqi` in container-query contexts and ordinary rem-based values
  outside them.

## Container Query Units

Use container query units for component-local typography and spacing when the
component should scale with its containing pane instead of the viewport:

```css
.trauma-fluid-component-title {
  font-size: clamp(1.5rem, 1rem + 4cqi, 2.5rem);
}

.trauma-fluid-component-gap {
  gap: clamp(0.5rem, 2cqmin, 1rem);
}

.trauma-fluid-component-block-space {
  margin-block: clamp(0.75rem, 3cqb, 1.5rem);
}
```

Unit guidance:

- Use `cqi` for inline-axis sizing such as readable typography, inline padding,
  and horizontal gaps.
- Use `cqb` for block-axis spacing only inside containers where block-size is a
  meaningful, stable constraint.
- Use `cqmin` for balanced spacing or radius that should respond to the smaller
  container dimension.
- Use `cqmax` sparingly for decorative or proportional effects that must follow
  the larger container dimension; do not use it for core readability.
- Always combine container query units with `clamp()` so narrow containers do
  not create unreadably small text or touch targets, and wide containers do not
  exceed the refined desktop design.
- Do not use `vw`, `vh`, `vmin`, or `vmax` for component internals when a named
  query container exists.

## Mobile Viewport Height Units

Mobile browser UI changes the visible viewport as address bars and toolbars
expand or collapse. Do not use `100vh` for mobile full-height surfaces.

Use these utilities instead:

```css
.trauma-mobile-stable-viewport {
  min-block-size: 100svh;
}

.trauma-mobile-dynamic-viewport {
  block-size: 100dvh;
}

.trauma-mobile-large-viewport {
  block-size: 100lvh;
}
```

Rules:

- Use `svh` for stable route shells and surfaces where content must not be
  hidden when browser chrome is visible. This is the default mobile full-height
  choice.
- Use `dvh` for overlays or fixed panels that must track the currently visible
  viewport. Avoid it on scroll-heavy route bodies because it can resize during
  scroll as browser UI changes.
- Use `lvh` only for immersive, non-critical full-bleed surfaces where content
  can tolerate browser UI covering part of the large viewport. Do not use it
  for primary controls or reader content.
- Use logical `block-size` / `min-block-size`, not physical `height` /
  `min-height`, unless a physical axis is semantically required.
- Keep `vh` out of mobile code. If a viewport-height fallback is unavoidable,
  document the reason in the PR body and place the modern unit after the
  fallback so supported browsers use `svh`, `dvh`, or `lvh`.

## Safe-Area Layout Tokens

Devices with notches, rounded corners, and bottom home indicators can obscure
content at viewport edges. Integrate `env(safe-area-inset-*)` once as layout
tokens, then consume those tokens through utilities.

Define physical inset tokens with fallback values:

```css
:root {
  --trauma-layout-safe-area-top: env(safe-area-inset-top, 0px);
  --trauma-layout-safe-area-right: env(safe-area-inset-right, 0px);
  --trauma-layout-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --trauma-layout-safe-area-left: env(safe-area-inset-left, 0px);
}
```

Use utilities for surfaces that touch viewport edges:

```css
.trauma-safe-area-shell {
  padding-block-start: var(--trauma-layout-safe-area-top);
  padding-inline-end: var(--trauma-layout-safe-area-right);
  padding-block-end: var(--trauma-layout-safe-area-bottom);
  padding-inline-start: var(--trauma-layout-safe-area-left);
}

.trauma-safe-area-inline {
  padding-inline-end: var(--trauma-layout-safe-area-right);
  padding-inline-start: var(--trauma-layout-safe-area-left);
}

.trauma-safe-area-bottom {
  padding-block-end: var(--trauma-layout-safe-area-bottom);
}
```

Rules:

- Apply safe-area utilities to mobile shell wrappers, fixed/sticky bottom
  action bars, bottom tab bars, and full-height overlays that can touch
  viewport edges.
- Do not add safe-area padding to desktop-only pane interiors or ordinary
  component cards. Safe-area is a viewport-edge concern, not a generic spacing
  token.
- Keep the raw `env(safe-area-inset-*)` calls centralized in
  `src/styles/tailwind.css`. Component and route files should use
  `trauma-safe-area-*` utilities.
- Use logical padding properties in utilities even though the environment
  variables are physical viewport insets.

## Responsive Image Markup

CSS image sizing keeps rendered media from overflowing, but it does not reduce
network cost. HTML must describe available image candidates so the browser can
choose an appropriate resource for viewport width and device pixel ratio.

Rules:

- Keep `prose-img:max-w-full` or equivalent CSS as a visual overflow guard, not
  as the network optimization mechanism.
- Owned app images should prefer vector assets or real generated variants. If
  no variants exist, do not invent a `srcset`.
- Reader markdown rendering may preserve safe `srcset`, `sizes`, `<picture>`,
  and `<source>` markup only after URL and attribute sanitization.
- Imported article extraction should preserve responsive image metadata when
  the source document already provides it and the existing public URL policy can
  validate every candidate URL.
- Detailed implementation steps live in
  [08h Responsive Image Markup](08h-responsive-image-markup.md).

## Capability And Preference Media Queries

Media queries remain valid, but their role is capability and preference
detection. They should not replace container queries for component layout.

Allowed use cases:

- `@media (hover: hover) and (pointer: fine)` for hover-only affordances.
- `@media (pointer: coarse)` for touch target spacing or interaction density.
- `@media (prefers-reduced-motion: reduce)` for disabling non-essential motion.
- `@media (forced-colors: active)` and `@media (prefers-contrast: more)` for
  accessibility adjustments.
- `@media (prefers-color-scheme: dark)` only when integrating with system
  preference before TRAUMA's explicit theme state takes over.
- `@media (orientation: landscape)` only when physical orientation affects a
  viewport-edge affordance; do not use it as a tablet/phone proxy.

Disallowed use cases:

- Component internals branching on `@media (max-width: ...)`,
  `@media (min-width: ...)`, `device-width`, or `device-height`.
- JavaScript `matchMedia()` branches for arbitrary viewport widths when
  container queries or route state can express the behaviour.
- Naming selectors or utilities after devices such as phone, tablet, iPad, or
  desktop when the condition is really width, input capability, or preference.

Detailed implementation steps live in
[08i Capability And Preference Media Queries](08i-capability-preference-media-queries.md).

## Constrained Fluid Page Shells

Do not build route/page shells with fixed width wrappers. Use constrained fluid
layout:

```css
.trauma-fluid-page-shell {
  inline-size: min(100%, var(--trauma-page-shell-max, 52rem));
  max-inline-size: var(--trauma-page-shell-max, 52rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4cqi, 2rem);
}
```

Rules:

- Use `max-inline-size`, `inline-size`, `margin-inline`, `padding-inline`, and
  other logical properties where the concept is inline/block rather than
  physical left/right/top/bottom.
- Do not use fixed `width`, left/right-only margin shims, or viewport-width
  page wrappers for route content.
- The desktop shell grid remains unchanged. This rule applies to route/page
  content shells and reusable surfaces inside the assigned shell column.
- If a component needs a max readable measure, express it as a constrained
  fluid wrapper rather than a fixed-width card.

## Flexbox Scope

Use flexbox only for local one-dimensional layouts:

- Navigation item rows.
- Tag/chip lists.
- Toolbars.
- Button groups.
- Short icon+label clusters.

When a local row may overflow, use wrapping rather than device-specific
breakpoints:

```css
.trauma-local-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: clamp(0.5rem, 1.5cqi, 1rem);
}
```

Rules:

- Do not use flexbox for the app shell, route shell, page shell, memory grid, or
  reader layout structure. Use CSS grid, block flow, or container-query-driven
  layout for those surfaces.
- Prefer `flex-wrap: wrap` for tag lists, toolbar actions, and button groups
  that need to break onto another line inside a narrow container.
- Keep flex children from forcing overflow by using `min-inline-size: 0` on
  text-bearing child elements where truncation or wrapping is expected.
- Do not use flexbox to emulate two-dimensional alignment. If both rows and
  columns matter, use grid.
