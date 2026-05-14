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
- Highlights and quotes: `hl-bg`, `hl-ink`, `hl-quote-bg`,
  `hl-quote-bar`, `hl-quote-ink`.
- Links: `link`, `link-hover`.
- Linked highlight anchors: `anchor-highlight-bg`, `anchor-highlight-ink`,
  `anchor-highlight-ring`.
- State: `state-success`, `state-warning`, `state-danger`, `state-info`.
- Typography: `font-sans`, `font-serif`, `font-mono`, `font-body`.
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
- `bg-trauma-highlight-bg`
- `text-trauma-highlight-ink`
- `bg-trauma-quote-bg`
- `border-trauma-quote-bar`
- `text-trauma-quote-ink`
- `shadow-trauma-1`
- `shadow-trauma-drawer`

Prefer these utilities in components.

## Theme Names

The app supports four themes:

| Preference | Theme name | Body font |
| --- | --- | --- |
| night + normal | `black-dark` | sans |
| sun + normal | `warm-light` | sans |
| sun + paper | `paper-warm-light` | serif |
| night + paper | `paper-black-dark` | serif |

Defaults:

- Brightness: `night`.
- Surface: `normal`.
- Theme: `black-dark`.

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

| Theme | `--bg-base` and `--bg-surface` |
| --- | --- |
| `black-dark` | `#000000` |
| `warm-light` | `#f6f7f4` |
| `paper-warm-light` | `#ece2cc` |
| `paper-black-dark` | `#211307` |

`--bg-elev`, `--bg-sunken`, and `--bg-tint` remain distinct so controls,
selected states, drawers, right rail islands, theme toggles, and hover states
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

- Layered leather colour washes from `--leather-texture-radials`.
- Fixed leather grain, fibre, and pore overlays from
  `--leather-grain-overlay`, `--leather-fiber-overlay`, and
  `--leather-pore-overlay`.
- A subdued leather sheen from `--leather-sheen-layer`.
- Leather-specific blend and opacity tokens:
  `--leather-texture-blend`, `--leather-grain-blend`, and
  `--leather-glow-blend`.

The leather result should read as fine pores, pebbled grain, fibre variation,
and dull shine. It must not introduce black wave lines, dot-grid, graph-paper,
or evenly tiled decorative marks.

Normal themes must not enable these paper texture layers.

## Typography

The default UI font is:

```text
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif
```

Paper themes set `--font-body` to the serif stack:

```text
Newsreader, ui-serif, Georgia, "Times New Roman", serif
```

Code uses:

```text
"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
```

Rules:

- Keep `letter-spacing: 0`.
- Do not use negative tracking from the source sample.
- Do not scale font size with viewport width.
- Match type scale to context: large route titles, compact panel headings,
  dense row metadata, readable reader prose.

## Highlight And Quote Tokens

Reader links, highlights, and highlight excerpts use stable semantic tokens:

- Reader/content links: `text-trauma-link` and
  `hover:text-trauma-link-hover`.

- Inline highlights: `bg-trauma-highlight-bg`,
  `text-trauma-highlight-ink`.
- Quote/excerpt cards: `bg-trauma-quote-bg`,
  `border-trauma-quote-bar`, `text-trauma-quote-ink`.
- Linked highlight hash targets:
  `.trauma-reader-content mark[data-highlight-id]:target` uses
  `anchor-highlight-bg`, `anchor-highlight-ink`, and
  `anchor-highlight-ring`.

Do not replace these with ad hoc yellow or paper colours inside components.

Default and night-normal links follow the accent tokens. Sun normal and sun
paper intentionally use `--link: var(--wine-500)` and
`--link-hover: var(--wine-600)` so reader links stay readable while remaining
brighter than the command accent treatment.
