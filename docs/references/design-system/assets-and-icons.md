# Assets And Icons

## Brand Name

Use `TRAUMA` in all app chrome and document titles.

Do not use mixed-case `Trauma` for the product mark in UI chrome unless it is
part of prose.

## TRAUMA Mark

Current assets:

- `public/assets/trauma-mark.png`
- `public/assets/trauma-mark.svg`
- `public/favicon.ico`

`TraumaMark` renders the PNG asset:

- Empty alt text.
- `aria-hidden="true"`.
- Explicit width and height.
- Object fit: contain.

The visible label or parent accessible label supplies meaning. Do not rely on
the image alt text for navigation labels.

## Favicon

The favicon is generated from the TRAUMA mark and lives at
`public/favicon.ico`.

When the mark changes, regenerate both the favicon and public mark assets in
one change. Verify the browser tab icon manually if the favicon is touched.

## Icon System

TRAUMA uses a local custom icon set in `src/components/icons/TraumaIcons.tsx`.

Rules:

- Icons use `currentColor`.
- SVGs are `aria-hidden`.
- Controls own accessible names.
- Keep icon dimensions stable.
- Use the existing 26px navigation icon viewBox pattern for nav icons.

## Navigation Icons

`TraumaNavIcons` provides outline and filled variants for:

- Memories.
- Flashbacks.
- Categories.
- Tags.
- Backup.
- Settings.

Active route links use the filled variant. Inactive links and future controls
use outline variants. Active route selection is not shown with a surrounding
primary-colour fill; the filled icon and bold tab label carry the state.

## Utility Icons

Current utility icons include:

- Chevron left.
- Search.
- Kebab.
- Lock.
- Plus.
- Open/source link.
- Check.
- Sun.
- Moon.
- Page.
- Paper.
- Hermès shopping bag silhouette for night paper surface mode.

Prefer these over ad hoc inline SVGs. If a new icon is needed, add it to the
local icon module with the same `currentColor` and `aria-hidden` conventions.

## Icon Usage Rules

- Use icons for familiar toolbar and action affordances.
- Pair icons with text where the command is not obvious.
- Do not use visible explanatory text to describe how the UI works.
- Do not create decorative SVG illustrations for app chrome.
