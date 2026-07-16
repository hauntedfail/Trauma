# 23.2 Reader Scroll-Spy Wiring

Weight: M

## Objective

Observe the section headings inside the reading column and publish the active
reading range as `MemoryReader`-owned reactive state, using the pure helpers
from 23.1.

## Deliverables

- In `src/components/reader/MemoryReader.tsx`:
  - An `activeTocRange` signal (or store) holding the result of
    `computeActiveTocRange`.
  - A scroll-spy effect that, while the reader is client-ready, reads the
    section heading elements under `readerRootRef`
    (`[data-reader-section-anchor]`), measures their viewport tops, resolves the
    active heading via `resolveActiveHeadingId`, and updates `activeTocRange`.
  - Observation batched through `requestAnimationFrame` and recomputed on
    `scroll` (passive), `resize`, and `hashchange`, plus once after mount and
    after content/translation changes.
  - Full teardown of every listener and any `IntersectionObserver` in
    `onCleanup`.
  - `activeTocRange` passed into `ReaderRightRailContent` and on to `ReaderToc`.

## Required Behaviour

- The reading line anchor is a fraction of the viewport height (e.g. ~1/3 from
  the top) so the active chapter matches what the user is actually reading.
- Recomputation never throws when `readerRootRef` is undefined or empty.
- The active range updates when the user clicks a TOC anchor (hash jump) and
  when translation swaps the rendered content.
- No observation work runs during SSR; it is client-only.

## Non-Negotiable

- Do not reach into the right rail DOM. State flows down through props only.
- Do not regress the existing `scheduleReaderHashTargetScroll`, Moment, or menu
  behaviour bound in the same lifecycle.
- Listeners must be passive where possible and removed on cleanup.

## Tests

- Extend reader component tests to assert the active range is recomputed on
  scroll/hashchange given a stubbed heading layout. Where IntersectionObserver
  or layout measurement is impractical in jsdom, factor the measurement step
  behind an injectable function and unit-test that seam.

## Verification

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/components
```

## Done When

- `activeTocRange` reflects scroll position and reaches `ReaderToc` via props.
- No listeners or observers leak across mount/unmount.
