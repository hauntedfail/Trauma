# Tokens And Themes

## Token Model

Tailwind v4 reads TRAUMA semantic tokens from `src/styles/tailwind.css`.
Components should use `trauma-*` utilities rather than raw colour values.

Primary token groups:

- Background: `bg-base`, `bg-surface`, `bg-elev`, `bg-sunken`, `bg-tint`.
- Borders: `border`, `border-strong`, `divider`.
- Text: `fg-1`, `fg-2`, `fg-3`, `fg-4`, `fg-inverse`.
- Accent: `accent`, `accent-hover`, `accent-press`, `accent-ink`,
  `accent-soft`, `accent-soft-ink`.
- Chips: `chip-bg`, `chip-border`, `chip-ink`.
- Flashbacks and quotes: `hl-bg`, `hl-ink`, `hl-quote-bg`,
  `hl-quote-bar`, `hl-quote-ink`.
- Links: `link`, `link-hover`.
- Linked flashback anchors: `anchor-flashback-bg`, `anchor-flashback-ink`,
  `anchor-flashback-ring`.
- State: `state-success`, `state-warning`, `state-danger`, `state-info`.
- Typography: `font-ui`, `font-sans`, `font-serif`, `font-focus`, `font-mono`,
  `font-body`.
- Shadows: `shadow-1`, `shadow-2`, `shadow-drawer`.

## Tailwind Mapping

The `@theme` block exposes tokens as Tailwind utilities:

- `bg-trauma-bg-base`
- `bg-trauma-bg-surface`
- `bg-trauma-bg-elev`
- `bg-trauma-bg-sunken`
- `bg-trauma-bg-tint`
- `border-trauma-border`
- `border-trauma-border-strong`
- `text-trauma-text-primary`
- `text-trauma-text-secondary`
- `text-trauma-text-muted`
- `text-trauma-accent`
- `text-trauma-link`
- `text-trauma-link-hover`
- `bg-trauma-accent`
- `bg-trauma-flashback-bg`
- `text-trauma-flashback-ink`
- `bg-trauma-quote-bg`
- `border-trauma-quote-bar`
- `text-trauma-quote-ink`
- `shadow-trauma-1`
- `shadow-trauma-drawer`

Prefer these utilities in components.

## Theme Names

The app supports four themes:

| Preference | Theme name | Theme token (`data-theme`) | Body font |
| --- | --- | --- | --- |
| sun + normal | `light` | `warm-light` | sans |
| night + normal | `midnight` | `black-dark` | sans |
| sun + paper | `paper` | `paper-warm-light` | serif |
| night + paper | `hermes` | `paper-black-dark` | serif |

Defaults:

- Brightness: `night`.
- Surface: `normal`.
- Theme name: `midnight`.
- Theme token (`data-theme`): `black-dark`.

Surface display labels are brightness-specific while stored values remain
stable:

- `normal` is labelled Light in sun brightness.
- `normal` is labelled Midnight in night brightness.
- `paper` is labelled Paper in sun brightness.
- `paper` is labelled Hermès in night brightness.

## Background Contract

Every theme must use one pane background colour:

```text
--bg-base == --bg-surface
```

This keeps the left rail, central route panes, and page background visually
unified. Borders, not background gutters, separate shell columns.

Current base/surface values:

| Theme name | Theme token (`data-theme`) | `--bg-base` and `--bg-surface` |
| --- | --- | --- |
| `midnight` | `black-dark` | `#0c0d0f` |
| `light` | `warm-light` | `#f6f7f4` |
| `paper` | `paper-warm-light` | `#ece2cc` |
| `hermes` | `paper-black-dark` | `#211307` |

`black-dark` uses APCA-tuned low-halation contrast tokens (`--bg-base` and
`--bg-surface` at `#0c0d0f`, `--fg-1` at `#e4e4e0`, `--fg-2` at `#b9bab4`, and
`--fg-3` at `#848682`) instead of pure `#000000` / `#ffffff`.

`--bg-elev`, `--bg-sunken`, and `--bg-tint` remain distinct so controls,
selected states, popovers, right rail islands, theme toggles, and hover states
can stay visible.

## Paper Material Surface

Paper surface mode is more than a colour swap. The stored surface preference
stays `paper`, but the user-facing label and material recipe differ by
brightness:

- In sun brightness, `paper-warm-light` is labelled Paper and renders a paper-like surface.
- In night brightness, `paper-black-dark` is labelled Hermès and renders a
  leather-like surface because subtle paper grain reads too weakly on a dark background.

The light paper recipe is CSS-only:

- Base colour from `--bg-base`.
- Layered `radial-gradient()` washes from `--paper-texture-radials`.
- Fixed grain overlay on `body::after` using an inline SVG turbulence texture.
- Fixed blurred glow layer on `body::before`.
- Blend modes through `--paper-texture-blend`, `--paper-grain-blend`, and
  `--paper-glow-blend`.

Do not add repeating dot or grid layers to paper mode. The paper texture should
read as organic grain, not evenly spaced graph paper.

The night paper recipe is a leather material, not a darker copy of the paper
grain. It uses:

- Fixed leather grain, fibre, and pore overlays from
  `--leather-grain-overlay`, `--leather-fiber-overlay`, and
  `--leather-pore-overlay`.
- Leather-specific blend and opacity tokens:
  `--leather-grain-blend` and `--leather-grain-opacity`.
- Paper glow/radial layers are explicitly disabled for Hermès so the surface
  reads as flat leather texture instead of blurred light washes.

The leather result should read as fine pores, pebbled grain, fibre variation,
and muted material depth. It must not introduce black wave lines, dot-grid,
graph-paper, broad glow gradients, or evenly tiled decorative marks.

Light and Midnight themes must not enable these material texture layers.

## Typography

Core English and Japanese fonts are self-hosted via `@fontsource*` packages and
eagerly imported from `src/styles/fonts.ts` (loaded in `src/app.tsx`).
Non-EN/JA scripts (`ko`, `zh-Hans`, `zh-Hant`, `ar`/`fa`/`ur`, `hi`/`mr`, `th`)
load on demand through dynamic `import()` in `src/lib/multilingual-fonts.ts`.

Font stacks:

- UI chrome (`--font-ui`):

```text
"Inter Variable", "IBM Plex Sans JP", "Hiragino Sans", "Yu Gothic UI",
ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
sans-serif
```

- Sans reading stack (`--font-sans`, default `--font-body` for Light/Midnight):

```text
"IBM Plex Sans Variable", "IBM Plex Sans JP", "Hiragino Sans",
"BIZ UDPGothic", "Yu Gothic", ui-sans-serif, system-ui, sans-serif
```

- Serif reading stack (`--font-serif`, default `--font-body` for Paper/Hermès):

```text
"Literata Variable", "Shippori Mincho", "Hiragino Mincho ProN",
"Yu Mincho", ui-serif, Georgia, serif
```

In dark themes (`black-dark` and `paper-black-dark`), `--font-serif` promotes
`"BIZ UDPMincho"` ahead of `"Shippori Mincho"` for stronger low-light stroke
legibility:

```text
"Literata Variable", "BIZ UDPMincho", "Shippori Mincho",
"Hiragino Mincho ProN", ui-serif, Georgia, serif
```

- Focus accessible reading stack (`--font-focus`):

```text
"Atkinson Hyperlegible Next Variable", "BIZ UDPGothic", "Hiragino Sans",
ui-sans-serif, system-ui, sans-serif
```

- Monospace / code stack (`--font-mono`):

```text
"JetBrains Mono Variable", "IBM Plex Sans JP", ui-monospace, SFMono-Regular,
Menlo, Consolas, monospace
```

User-selectable reading font presets (`Sans`, `Serif`, `Focus`, `Mono`) override
the theme default `--font-body` via `:root[data-reader-font="sans"|"serif"|"focus"|"mono"]`.
The `focus` preset also sets `--reader-tracking: 0.02em` and
`--reader-word-spacing: 0.06em`.

Rules:

- Keep `letter-spacing: 0` outside the `focus` reading preset (and keep
  `letter-spacing: 0 !important` for RTL Arabic/Persian/Urdu prose).
- Do not use negative tracking.
- Do not scale font size with viewport width.
- Match type scale to context: large route titles, compact panel headings,
  dense row metadata, readable reader prose.

## Flashback And Quote Tokens

Reader links, flashbacks, and flashback excerpts use stable semantic tokens:

- Reader/content links: `text-trauma-link` and
  `hover:text-trauma-link-hover`.

- Inline flashbacks: `bg-trauma-flashback-bg`,
  `text-trauma-flashback-ink`.
- Flashback browse context: shared context spans use secondary/tertiary
  foreground mixing and the Flashback context blur/mask classes. Route and
  right-rail Flashback rows should not use quote-card background or border
  tokens.
- Reader prose blockquotes still use the quote token family through the reader
  prose styles.
- Linked flashback hash targets:
  `.trauma-reader-content mark[data-flashback-id]:target` uses
  `anchor-flashback-bg`, `anchor-flashback-ink`, and
  `anchor-flashback-ring`.

Do not replace these with ad hoc yellow or paper colours inside components.

Midnight links follow the accent tokens. Light and Paper intentionally use
`--link: var(--wine-500)` and `--link-hover: var(--wine-600)` so reader links
stay readable while remaining brighter than the command accent treatment.
