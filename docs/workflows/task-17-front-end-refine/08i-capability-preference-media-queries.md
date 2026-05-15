# Task 17.8i: Capability And Preference Media Queries

## Intent

Keep media queries in the responsive system, but use them for device
capabilities and user preferences instead of phone, iPad, tablet, or arbitrary
viewport-width layout detection.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this after
[08d Component Responsive Implementation](08d-component-responsive-implementation.md).

## Files

- Modify: `src/styles/tailwind.css`
- Modify: `tests/components/mobile-responsive-contract.test.ts`
- Modify: `docs/references/design-system/layout-and-shell.md`
- Modify: `docs/references/design-system/interaction-and-accessibility.md`

## Rules

- Use container queries for component layout.
- Use viewport breakpoints only for global shell topology.
- Use media queries for capabilities and preferences:
  `hover`, `any-hover`, `pointer`, `any-pointer`, `prefers-reduced-motion`,
  `forced-colors`, `prefers-contrast`, `prefers-color-scheme`, and
  `orientation`.
- Do not use `device-width`, `device-height`, phone/iPad naming, or arbitrary
  viewport-width media queries for component internals.
- Do not use `matchMedia()` for viewport-width component layout decisions.

## Steps

- [ ] **Step 1: Confirm the source-contract test exists**

The contract test from
[08b Responsive Contract Tests](08b-responsive-contract-tests.md) must include:

```ts
it("uses media queries for capabilities and preferences only", () => {
  expect(tailwindCss).toContain("@media (hover: hover) and (pointer: fine)");
  expect(tailwindCss).toContain("@media (pointer: coarse)");
  expect(tailwindCss).toContain("@media (prefers-reduced-motion: reduce)");
  expect(tailwindCss).toContain("@media (forced-colors: active)");
  expect(tailwindCss).toContain("@media (prefers-contrast: more)");
  expect(tailwindCss).toContain("@media (orientation: landscape)");
  expect(tailwindCss).not.toMatch(/@media\s*\([^)]*(min-width|max-width|device-width|device-height)/i);
});
```

Run:

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts
```

Expected before implementation: FAIL because the capability/preference media
query utilities do not exist yet.

- [ ] **Step 2: Add capability and preference media-query utilities**

In `src/styles/tailwind.css`, add:

```css
@media (hover: hover) and (pointer: fine) {
  .trauma-capability-hover-lift:hover {
    transform: translateY(-1px);
  }

  .trauma-capability-hover-underline:hover {
    text-decoration-line: underline;
    text-underline-offset: 3px;
  }
}

@media (pointer: coarse) {
  .trauma-capability-touch-target {
    min-block-size: 44px;
    min-inline-size: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trauma-motion-respectful,
  .trauma-motion-respectful::before,
  .trauma-motion-respectful::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}

@media (forced-colors: active) {
  .trauma-forced-colors-border {
    border-color: CanvasText;
  }
}

@media (prefers-contrast: more) {
  .trauma-preference-contrast-border {
    border-width: 2px;
  }
}

@media (orientation: landscape) {
  .trauma-orientation-landscape-compact {
    --trauma-orientation-density: compact;
  }
}
```

Do not add `@media (max-width: ...)`, `@media (min-width: ...)`,
`device-width`, or `device-height` utilities.

- [ ] **Step 3: Replace hover-only interactions with capability utilities**

Audit hover-only classes:

```bash
rg -n "hover:|group-hover|@media \\(hover|pointer:" src/components src/routes src/styles/tailwind.css
```

Expected review outcome:

- Decorative hover affordances are wrapped in capability-aware utilities or are
  harmless when hover is unavailable.
- Touch target sizing does not depend on phone/iPad detection.
- Focus-visible states remain available without hover.

- [ ] **Step 4: Respect reduced motion for existing animations**

Audit motion and transition classes:

```bash
rg -n "animate-|transition|duration-|motion|bounce|keyframes|scroll-behavior" src/components src/routes src/styles/tailwind.css
```

Expected review outcome:

- Non-essential animations are covered by `trauma-motion-respectful` or an
  equivalent `prefers-reduced-motion: reduce` rule.
- Essential state changes still occur without relying on animation.
- No component introduces JavaScript motion preference detection when CSS can
  express the behaviour.

- [ ] **Step 5: Audit forbidden device and viewport media query usage**

Run:

```bash
rg -n "@media|matchMedia|device-width|device-height|max-width|min-width|phone|tablet|ipad|iPad" src/styles src/components src/routes
```

Expected review outcome:

- No CSS `@media` rule targets `device-width` or `device-height`.
- No component-internal CSS uses `@media (max-width: ...)` or
  `@media (min-width: ...)`.
- Any remaining viewport-width Tailwind variant is shell-topology only and is
  documented in the PR body.
- No `matchMedia()` branch controls component layout by viewport width.

- [ ] **Step 6: Update design-system docs**

In `docs/references/design-system/layout-and-shell.md`, add:

```md
Media queries are not banned, but their role is capability and preference
detection. Use container queries for component layout, viewport breakpoints only
for global shell topology, and media queries for features such as hover,
pointer, reduced motion, forced colors, contrast, color scheme, and orientation.
```

In `docs/references/design-system/interaction-and-accessibility.md`, add:

```md
Hover-only effects must be guarded by input capability, and motion effects must
respect `prefers-reduced-motion: reduce`. Keyboard focus and touch targets must
not depend on hover support.
```

- [ ] **Step 7: Run focused tests**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit capability/preference media-query rules**

```bash
git add src/styles/tailwind.css tests/components/mobile-responsive-contract.test.ts docs/references/design-system/layout-and-shell.md docs/references/design-system/interaction-and-accessibility.md
git commit -m "style: constrain media queries to capabilities"
```
