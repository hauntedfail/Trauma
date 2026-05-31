# Task 23: Reader TOC Reading-Progress Visualization

Implement these subtasks sequentially on `fix/toc`, which is derived from
`fix/perform`. Work happens in the `fix/toc` worktree and merges back into
`fix/perform` when ready for release, alongside Tasks 19-22.

## Goal

Make the reader table of contents (TOC) on `/memories/:id` reflect the reader's
live reading position. As the user scrolls or jumps through a memory, the TOC
must visualize which chapter is currently on screen, highlighting the reading
range using the TOC surface background color.

Today the TOC is a static list of headings (subtitles) that only supports
scrolling, clicking anchors, and Moment toggling. This task adds a dynamic
reading-progress layer on top of that existing behaviour without removing it.

## Architecture

The rendered markdown lives inside `readerRootRef` in
`src/components/reader/MemoryReader.tsx`. Each generated heading carries
`data-reader-section-anchor`, `data-reader-section-level`, and
`data-reader-section-path`, which align one-to-one with `ReaderTocEntry`
(`id`, `level`, `path`) produced by `src/server/reader/markdown-renderer.ts`.

The TOC itself (`ReaderToc` / `ReaderTocEntryRow`) is rendered into the shell
right rail through `setRightRailContent`, so it lives in a separate DOM subtree
from the reading column. The reader and the TOC must therefore communicate the
active reading position through reactive state owned by `MemoryReader`, not
through DOM coupling.

The active position is derived by observing the section headings inside the
reading column and selecting the heading that owns the current reading line.
From that active heading we compute the contiguous "reading range": the active
chapter plus its associated subtitles. The range is passed to the TOC, which
paints those entries with the TOC background-color treatment.

## Required Context

- [Documentation index](../../INDEX.md)
- [UI and routing architecture](../../architecture/ui-and-routing.md)
- [Runtime flows](../../architecture/flows.md)
- [Design system: reader and content](../../references/design-system/reader-and-content.md)
- [Design system: interaction and accessibility](../../references/design-system/interaction-and-accessibility.md)
- [Verification strategy](../../quality/verification.md)
- [SolidStart UI rules](../../references/coding-standards/solidstart-ui.md)
- [Testing and verification rules](../../references/coding-standards/testing-verification.md)

## Scope

In scope:

- Scroll-spy observation of reader section headings inside `readerRootRef`.
- Deterministic computation of the active heading and the active chapter range.
- Reactive plumbing of the active range from `MemoryReader` into `ReaderToc`.
- Background-color visualization of the reading range in the TOC, including the
  chapter and its associated subtitles.
- Accessibility signalling for the current location (`aria-current`).
- Reduced-motion and no-JS fallbacks that keep the static TOC fully usable.
- Tests for the pure range/active-heading logic and the TOC visual state.
- Design-system documentation of the new TOC reading-progress contract.

Out of scope for this branch:

- Changing markdown rendering, heading anchors, or slug generation.
- Changing Moment creation, removal, or the section long-press menu.
- Changing TOC scroll-fade affordances or the right rail island geometry.
- Persisting reading position across reloads or syncing it to read-state.
- Reworking the `/memories` browse route or any non-reader surface.

## Non-Negotiable Contracts

- Existing TOC behaviour stays intact: anchor links, scroll fades, Moment
  toggles, and long-press menus must keep working unchanged.
- The reader and TOC communicate through `MemoryReader`-owned reactive state.
  Do not query reader DOM from inside the right rail subtree.
- The active-heading and range computation must be pure, deterministic, and
  unit-tested independently of the DOM and IntersectionObserver.
- The reading range must always be a single contiguous run of TOC entries: the
  active chapter and its associated subtitles, never a disjoint selection.
- Visualization uses the TOC surface background-color treatment with existing
  design tokens; do not introduce raw hex colors.
- When no heading is active yet (top of document, empty TOC), the TOC renders in
  its current static state with no highlight.
- Highlight transitions respect `prefers-reduced-motion: reduce`.
- Scroll observation must be throttled/rAF-batched and fully torn down on reader
  unmount; no listeners or observers may leak.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 23.1 | [Active range model](01-active-range-model.md) | M | Pure helpers that map visible headings to the active entry and contiguous chapter range. |
| 23.2 | [Reader scroll-spy wiring](02-reader-scroll-spy-wiring.md) | M | Observe reader headings and publish active-range state from `MemoryReader`. |
| 23.3 | [TOC reading-range visualization](03-toc-reading-range-visualization.md) | M | Paint the reading range with the TOC background treatment and `aria-current`. |
| 23.4 | [Docs, verification, and handoff](04-docs-verification-handoff.md) | S | Document the contract, run verification, and prepare the release handoff. |

## Implementation Rules

- Implement all subtasks on `fix/toc`, grouping commits by the subtask
  boundaries above.
- Use TDD for the pure range logic (23.1) and the TOC visual-state mapping.
- Keep the pure logic in a dedicated module so it can be tested without a DOM.
- Prefer reactive props over imperative DOM mutation when feeding TOC state.
- Preserve existing untracked or dirty local files unrelated to this branch.

## Verification Baseline

Each subtask lists focused commands. Before PR handoff, run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

Run E2E after the UI subtasks land:

```bash
mise exec -- bun run test:e2e
```

If full verification is blocked by unrelated local state, record the exact
blocker and still run the focused suites listed by each subtask.
