# 23.1 Active Range Model

Weight: M

## Objective

Create a pure, DOM-free module that turns heading position data into the active
reading state the TOC needs: the active entry id and the contiguous range of
TOC entries (chapter plus associated subtitles) to highlight.

## Why First

The hardest part of this feature is the semantics, not the wiring. Building and
testing the math first lets the scroll-spy (23.2) and the visualization (23.3)
stay thin and obviously correct.

## Deliverables

- New module `src/components/reader/toc-reading-range.ts` exporting:
  - `resolveActiveHeadingId(headings, readingLineY)` where `headings` is an
    ordered list of `{ id: string; top: number }` (viewport-relative tops) and
    `readingLineY` is the reading anchor offset. Returns the id of the last
    heading that has crossed the reading line, or `undefined` when none have.
  - `computeActiveTocRange(toc, activeId)` returning
    `{ activeId, chapterId, rangeIds }` where `rangeIds` is the contiguous run
    of `ReaderTocEntry.id` values covering the active entry's chapter and its
    associated subtitles. Returns an empty range when `activeId` is undefined.
- A small, documented definition of "chapter": the nearest ancestor whose level
  is the minimum level present in the TOC; its associated subtitles are the
  deeper-level entries that follow it until the next entry at the chapter level.
- Unit tests in `tests/components/reader-toc-reading-range.test.ts`.

## Required Behaviour

- The range is always one contiguous slice of the TOC ordering.
- A flat TOC (single level) highlights only the active entry's chapter, which is
  the active entry itself, with no extra subtitles.
- A document that opens above the first heading yields `undefined` active id and
  an empty range.
- The reading-line resolution is stable: exactly one active heading per scroll
  position, ties broken toward the later (lower-in-document) heading.

## Tests

Cover at least:

- Empty TOC and undefined active id.
- Reading line above all headings.
- Active subtitle resolves a range spanning its chapter and sibling subtitles.
- Active chapter heading with no subtitles yields a single-entry range.
- Multi-chapter document only highlights the active chapter, not neighbours.
- `resolveActiveHeadingId` tie-breaking at exact boundary offsets.

## Verification

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/components/reader-toc-reading-range.test.ts
```

## Done When

- The module is pure and imports no DOM or Solid APIs.
- All listed cases pass.
- No other modules are modified in this subtask.
