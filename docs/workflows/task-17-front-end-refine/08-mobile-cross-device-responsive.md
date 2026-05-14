# Task 17.8: Mobile And Cross-Device Responsive Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this workflow by domain file. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Refactor TRAUMA's mobile and cross-device responsive behaviour so reusable UI
surfaces adapt to their own container width instead of relying primarily on
device-width breakpoints.

Desktop is out of scope. Do not redesign or resize the existing desktop shell,
desktop rail, desktop main column, or desktop right rail.

## Strategic Direction

Move TRAUMA from viewport breakpoint-driven design to content-driven and
component-driven intrinsic responsive design.

The core implementation stack is:

- CSS Grid for two-dimensional shell, route, card-grid, and reader structure.
- Flexbox for local one-dimensional clusters that can wrap.
- `clamp()`, `min()`, and `max()` for continuous sizing.
- Container Queries for component layout decisions.
- Container Query Units for component-local typography and spacing.
- `svh`, `dvh`, and `lvh` for mobile viewport height.
- `env(safe-area-inset-*)` through layout tokens.
- Responsive image markup with `srcset`, `sizes`, and `<picture>`.
- Capability and user-preference media queries.

## Domain Files

Read and execute these files in order:

1. [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
   defines the responsive architecture, worker contract, CSS rules, and source
   references.
2. [08b Responsive Contract Tests](08b-responsive-contract-tests.md) adds the
   source-contract tests that lock the policy before implementation.
3. [08c Container Ownership](08c-container-ownership.md) adds route and
   component query-container boundaries without changing layout behaviour.
4. [08g Safe-Area Layout Tokens](08g-safe-area-layout-tokens.md) integrates
   notch, rounded-corner, and home-indicator insets through layout tokens.
5. [08d Component Responsive Implementation](08d-component-responsive-implementation.md)
   migrates component internals to container queries, fluid logical sizing,
   scoped flex wrapping, and mobile viewport units.
6. [08i Capability And Preference Media Queries](08i-capability-preference-media-queries.md)
   restricts `@media` usage to input capability, orientation, and user
   preference detection instead of phone/tablet breakpoints.
7. [08h Responsive Image Markup](08h-responsive-image-markup.md) makes owned and
   reader images responsive in HTML instead of relying on CSS sizing alone.
8. [08e Cross-Device E2E](08e-cross-device-e2e.md) adds Playwright coverage for
   narrow and mid-width user flows.
9. [08f Design System Responsive Docs](08f-design-system-responsive-docs.md)
   records the durable design-system guidance and final verification contract.

## Execution Order

- [ ] Read `08a-responsive-strategy-and-rules.md` and confirm the implementation
  scope is mobile/cross-device only.
- [ ] Execute `08b-responsive-contract-tests.md` and commit the failing policy
  contract.
- [ ] Execute `08c-container-ownership.md` and commit container ownership
  markers.
- [ ] Execute `08g-safe-area-layout-tokens.md` and commit safe-area layout
  tokens.
- [ ] Execute `08d-component-responsive-implementation.md` and commit the CSS
  and component refactor.
- [ ] Execute `08i-capability-preference-media-queries.md` and commit
  capability/preference media-query rules.
- [ ] Execute `08h-responsive-image-markup.md` and commit responsive image
  markup support.
- [ ] Execute `08e-cross-device-e2e.md` and commit E2E coverage.
- [ ] Execute `08f-design-system-responsive-docs.md` and commit durable
  documentation updates.
- [ ] Run final verification from `08f-design-system-responsive-docs.md`.

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

## File Ownership

Primary files:

- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/components/reader/reader-styles.ts`
- `src/components/reader/MemoryReader.tsx`
- `src/routes/highlights/index.tsx`
- `src/routes/[...404].tsx`
- `tests/components/app-shell.test.ts`
- `tests/components/mobile-responsive-contract.test.ts`
- `e2e/cross-device-responsive.spec.ts`
- `docs/references/design-system/layout-and-shell.md`
- `docs/references/design-system/components-and-surfaces.md`
- `docs/references/design-system/interaction-and-accessibility.md`
- `docs/references/design-system/verification.md`

Do not edit files outside this list unless a failing test proves the
responsive boundary lives elsewhere. Document any extra file in the PR body.

## Handoff Summary

For final handoff, include:

- Confirmation that desktop shell dimensions were not changed.
- Confirmation that implementation follows content-driven and component-driven
  intrinsic responsive design rather than viewport breakpoint-driven design.
- Container-query classes and ownership added.
- Container query units used for component-local typography/spacing, with any
  remaining viewport-unit component usage justified.
- Mobile full-height surfaces migrated away from `100vh`, with each
  `svh`/`dvh`/`lvh` use justified by surface intent.
- Safe-area insets integrated through layout tokens and utilities rather than
  component-local `env(safe-area-inset-*)` calls.
- Media queries limited to capabilities and preferences such as hover, pointer,
  reduced motion, forced colors, contrast, color scheme, and orientation.
- Reader and owned images use HTML responsive image primitives when variants
  exist, and no fake `srcset` is generated from duplicate URLs.
- Constrained fluid page-shell utility added with logical properties.
- Flexbox audit outcome, including which flex uses were kept because they are
  local one-dimensional layouts.
- Remaining viewport breakpoint usage and why each usage is shell-topology
  rather than component-internal device targeting.
- Mobile/cross-device viewport evidence.
- Exact command outputs.
