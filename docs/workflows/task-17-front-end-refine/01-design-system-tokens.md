# Task 17.1: Design System Tokens And Theme Contract

## Goal

Translate `refined_sample/colors_and_type.css` into TRAUMA's Tailwind v4 token
layer so component code can reuse the refined brand colors, typography, spacing,
radius, and theme surfaces through stable utilities.

## Ownership

Primary files:

- `src/styles/tailwind.css`
- `tests/scripts/tailwind-migration.test.ts`

Optional test file:

- `tests/scripts/frontend-refine-tokens.test.ts`

## Decisions To Preserve

- Keep Tailwind v4 through `@tailwindcss/vite`.
- Keep `src/styles/tailwind.css` as the only global stylesheet entry.
- Use four supported theme names:
  - `warm-light`
  - `black-dark`
  - `paper-warm-light`
  - `paper-black-dark`
- Use Tailwind theme variables that point at runtime CSS variables, for example
  `--color-trauma-bg-base: var(--bg-base)`.
- Default to `black-dark` unless a later product decision chooses another
  initial theme.
- Do not import Google Fonts from runtime CSS. Use the sample font stacks as
  preferred names with system fallbacks; adding local font assets requires a
  separate dependency and asset review.
- Do not port negative letter spacing from the sample.

## Execution Steps

1. Read the source token file:

   ```bash
   sed -n '1,360p' refined_sample/colors_and_type.css
   ```

2. Replace the current narrow `@theme` block in `src/styles/tailwind.css` with
   dynamic TRAUMA tokens backed by CSS variables.

   Required token groups:

   - brand wine scale: `wine-50` through `wine-900`
   - state colors: success, warning, danger, info
   - highlight colors: background, ink, quote background, quote bar, quote ink
   - linked highlight anchors: anchor background, ink, and ring
   - links: default and hover
   - surfaces: base, surface, elevated, sunken, tint
   - borders: border, strong border, divider
   - text: primary, secondary, muted, placeholder, inverse
   - accent: accent, hover, press, ink, soft, soft ink
   - chips: background, border, ink
   - fonts: sans, serif, mono, body

3. Add theme selectors in `@layer base`:

   ```css
   :root,
   :root[data-theme="black-dark"] {
     color-scheme: dark;
     --bg-base: #000000;
     --bg-surface: #000000;
     --bg-elev: #181818;
     --bg-sunken: #050505;
     --bg-tint: #1f1f1f;
   }
   ```

   Repeat with the full values from `colors_and_type.css` for the other three
   themes. Keep the actual values in `tailwind.css` so Tailwind utilities and
   non-utility markdown styling read from the same contract.

4. Keep base element rules minimal:

   - `body` uses `background: var(--bg-base)` and `color: var(--fg-1)`.
   - `body` and headings use `letter-spacing: 0`.
   - `::selection`, `mark`, `code`, and focus-visible read from the refined
     semantic variables.
   - Avoid broad component selectors such as `.memory-row` in global CSS.

5. Strengthen tests.

   Add assertions proving:

   - `src/styles/app.css` does not exist.
   - `src/styles/tailwind.css` defines the four `data-theme` selectors.
   - `tailwind.css` exposes `--color-trauma-bg-base`, `--color-trauma-accent`,
     `--color-trauma-highlight-bg`, `--color-trauma-link`, and
     `--color-trauma-link-hover`.
   - `tailwind.css` does not import Google Fonts.
   - component files do not use the old removed class names.

6. Run:

   ```bash
   mise exec -- bun run test tests/scripts/tailwind-migration.test.ts
   mise exec -- bun run typecheck
   ```

## Acceptance Criteria

- The refined brand palette is available through Tailwind utilities.
- Theme switching can be driven by `document.documentElement.dataset.theme`.
- The global CSS remains token/base only, not component styling.
- The app has no runtime dependency on Google Fonts.
