# Task 17.2: Brand Assets And Icon System

## Goal

Move the refined TRAUMA mark and icon vocabulary into app-owned Solid
components and browser assets.

## Ownership

Primary files:

- `public/assets/trauma-mark.svg`
- `public/assets/trauma-mark.png`
- `public/favicon.ico`
- `src/components/brand/TraumaMark.tsx`
- `src/components/icons/TraumaIcons.tsx`
- `src/components/icons/index.ts`
- `tests/components/brand-assets.test.ts`
- `tests/components/trauma-icons.test.ts`

Conditional files:

- `scripts/build-favicon.ts` if favicon generation is automated.
- `package.json` only if a new script is added.

## Source Mapping

- `refined_sample/assets/trauma-mark.svg` and `.png` become public assets.
- `refined_sample/icons.jsx` becomes Solid components in
  `src/components/icons/TraumaIcons.tsx`.
- The sample `TraumaMark` function becomes `src/components/brand/TraumaMark.tsx`.

## Decisions To Preserve

- The TRAUMA mark is used for component logo surfaces and the browser favicon.
- Icons are part of the refined design source; do not replace them with a
  generic icon library in this workflow.
- Icon components must use `currentColor` so Tailwind text color controls active
  and inactive states.
- SVG output must include `aria-hidden="true"` by default. If an icon carries
  meaning without adjacent text, the caller must provide accessible text on the
  button or link.

## Execution Steps

1. Copy brand assets:

   ```bash
   mkdir -p public/assets
   cp refined_sample/assets/trauma-mark.svg public/assets/trauma-mark.svg
   cp refined_sample/assets/trauma-mark.png public/assets/trauma-mark.png
   ```

2. Build or replace `public/favicon.ico` from the TRAUMA mark.

   If adding an automated script, name it:

   ```text
   scripts/build-favicon.ts
   ```

   Add a package script only if the build can run without heavyweight runtime
   dependencies:

   ```json
   "build:favicon": "bun run scripts/build-favicon.ts"
   ```

   If generation remains a one-time local asset step, commit the final
   `public/favicon.ico` and add a test that verifies it is not the old default.

3. Create `TraumaMark`.

   Required props:

   ```ts
   interface TraumaMarkProps {
     size?: number;
     class?: string;
   }
   ```

   Required behaviour:

   - renders `/assets/trauma-mark.png`
   - defaults to a square visual box
   - uses an empty `alt` and `aria-hidden="true"` when adjacent text carries the
     product name

4. Port icons from `icons.jsx`.

   Required exports:

   - `TraumaNavIcons`
   - `ChevronLeftIcon`
   - `SearchIcon`
   - `KebabIcon`
   - `LockIcon`
   - `PlusIcon`
   - `OpenIcon`
   - `CheckIcon`
   - `SunIcon`
   - `MoonIcon`
   - `PageIcon`
   - `PaperIcon`

   Keep the outline/filled nav icon pair shape:

   ```ts
   type NavIconName =
     | "memories"
     | "highlights"
     | "categories"
     | "tags"
     | "backup"
     | "settings";
   ```

5. Add tests with `renderToString`.

   Required assertions:

   - `TraumaMark` renders `/assets/trauma-mark.png`.
   - nav icons expose both `outline` and `filled`.
   - icons render `currentColor`.
   - icon SVGs are `aria-hidden`.
   - public asset files exist.

6. Run:

   ```bash
   mise exec -- bun run test tests/components/brand-assets.test.ts tests/components/trauma-icons.test.ts
   mise exec -- bun run typecheck
   ```

## Acceptance Criteria

- App components can render the refined logo and icons without importing sample
  files.
- Favicon and public logo assets are present in the app's public asset tree.
- Icon accessibility depends on the owning button/link label, not hidden SVG
  text.
