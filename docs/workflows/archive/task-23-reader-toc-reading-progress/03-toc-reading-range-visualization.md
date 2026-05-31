# 23.3 TOC Reading-Range Visualization

Weight: M

## Objective

Render the active reading range inside the TOC using the surface
background-color treatment so the reader sees the current chapter and its
associated subtitles highlighted as one band.

## Deliverables

- `ReaderToc` accepts the `activeTocRange` and forwards per-entry state to
  `ReaderTocEntryRow`.
- `ReaderTocEntryRow` gains:
  - A background-color highlight when the entry is in the active range, using
    existing design tokens (e.g. a tint/elevated surface token), not raw hex.
  - Continuous-band styling so the chapter and its subtitles read as one
    contiguous highlighted region (consistent radius at the band edges).
  - `aria-current="location"` on the anchor of the precise active entry.
  - A distinct but subordinate emphasis for the exact active entry versus the
    rest of the range, if needed for clarity.
- Highlight transitions gated by `prefers-reduced-motion: reduce`.
- Any required CSS helpers added near the existing `trauma-toc-*` styles.

## Required Behaviour

- With no active range, the TOC looks exactly as it does today.
- The band only ever spans the contiguous active chapter range from 23.1.
- Highlight does not interfere with hover, Moment affordance, or anchor focus
  states, and preserves contrast/readability of entry text.
- Clicking an anchor still scrolls; the highlight then tracks the new position.

## Tests

- Component/state test asserting entries in the range receive the highlight
  class and the active entry gets `aria-current`, while out-of-range entries do
  not.

## Verification

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/components
mise exec -- bun run build
```

## Done When

- The reading range is visibly painted with the TOC background treatment.
- Accessibility and reduced-motion requirements are met.
