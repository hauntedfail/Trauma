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
- `bg-trauma-accent`
- `bg-trauma-highlight-bg`
- `bg-trauma-quote-bg`
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
| `paper-black-dark` | `#14110b` |

`--bg-elev`, `--bg-sunken`, and `--bg-tint` remain distinct so controls,
selected states, drawers, right rail islands, theme toggles, and hover states
can stay visible.

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

Reader highlights and highlight excerpts use stable semantic tokens:

- Inline highlights: `bg-trauma-highlight-bg`,
  `text-trauma-highlight-ink`.
- Quote/excerpt cards: `bg-trauma-quote-bg`,
  `border-trauma-quote-bar`, `text-trauma-quote-ink`.

Do not replace these with ad hoc yellow or paper colours inside components.
