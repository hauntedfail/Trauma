# TRAUMA Design System Index

This directory is the reference map for TRAUMA's front-end design system.
Use it when changing UI, adding route surfaces, reviewing theme work, or
translating future sample designs into the SolidStart app.

The design system is implemented in Tailwind classes and semantic CSS tokens.
It is not a separate component package.

## Reference Documents

- [Design contract](DESIGN.md): product tone, design principles, source of
  truth, and non-negotiable UI constraints.
- [Tokens and themes](tokens-and-themes.md): colour tokens, typography, theme
  names, background rules, and Tailwind mapping.
- [Layout and shell](layout-and-shell.md): desktop grid, responsive shell,
  left rail, right rail, phone tabs, and route frame ownership.
- [Components and surfaces](components-and-surfaces.md): shell controls,
  memory rows, highlight cards, forms, filter islands, and state surfaces.
- [Reader and content](reader-and-content.md): markdown reader surface,
  typography, table of contents, code, media, and highlight rendering.
- [Interaction and accessibility](interaction-and-accessibility.md): route
  behaviour, theme persistence, filter state, keyboard/focus rules, and labels.
- [Assets and icons](assets-and-icons.md): TRAUMA mark, favicon, icon variants,
  and icon usage rules.
- [Verification](verification.md): tests, browser checks, and visual review
  requirements for UI changes.

## Implementation Sources

- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/shell/theme.ts`
- `src/components/brand/TraumaMark.tsx`
- `src/components/icons/TraumaIcons.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/routes/highlights/index.tsx`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/reader-styles.ts`

## Maintenance Rule

When a UI change intentionally changes a design contract, update the smallest
owning document here and add or update an automated check where practical.
Do not duplicate these details in `AGENTS.md`.
