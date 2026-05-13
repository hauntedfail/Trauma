# Task 17.5: Reader Surface

## Goal

Bring the reader route into the refined visual system while preserving markdown
rendering, sanitization, table of contents, source-link safety, and highlight
toggle behaviour.

## Ownership

Primary files:

- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/reader-styles.ts`
- `src/components/reader/highlight-events.ts`
- `tests/components/reader-highlight-events.test.ts`
- `tests/components/reader-highlight-failsafe.test.ts`
- `e2e/reader.spec.ts`

Conditional files:

- `src/components/reader/ReaderToc.tsx` if the table-of-contents markup should
  be split from `MemoryReader.tsx`.
- `src/components/reader/ReaderState.tsx` if loading/error state markup grows.

## Source Mapping

- Sample `PaneHeader` maps to the reader title/header.
- Sample `MemoryDetail` visual details map to reader chrome only.
- Sample `detail__prose` maps to Tailwind typography classes and
  `reader-styles.ts`.
- Sample highlight quote styling is shared with browse/highlights only where it
  represents excerpts, not the full reader body.

## Decisions To Preserve

- The reader content remains read-only except highlight toggle selection.
- `innerHTML` rendering stays backed by server-side sanitized HTML.
- Existing `<mark data-highlight-id="...">` preservation remains required.
- The reader must not accept arbitrary edit operations.
- Source URL rendering must keep using `toSafeReaderSourceHref`.

## Execution Steps

1. Replace slate/blue reader color utilities with TRAUMA theme tokens.

   Use:

   - `text-trauma-text-primary`
   - `text-trauma-text-secondary`
   - `text-trauma-text-muted`
   - `border-trauma-border`
   - `bg-trauma-bg-elev`
   - `text-trauma-accent`
   - `prose-mark:bg-trauma-highlight-bg`

2. Update `reader-styles.ts`.

   It may keep shared static class strings for:

   - reader frame
   - reader padding
   - reader state panel
   - reader article/prose class

   Do not move generic page styling back into global CSS.

3. Align reader header with the sample pane model.

   Required visible content:

   - eyebrow: `Reader mode`
   - title from memory metadata
   - safe source URL link or non-clickable fallback

4. Keep the table of contents.

   Required behaviour:

   - sticky on desktop
   - inline/static on tablet and mobile
   - links use existing rendered heading IDs

5. Preserve highlight toggle implementation.

   Do not change these functions unless a visual change requires a small class
   adjustment:

   - `toggleReaderSelection`
   - `readReaderSelection`
   - range offset helpers
   - optimistic highlight rollback

6. Run focused verification:

   ```bash
   mise exec -- bun run test tests/components/reader-highlight-events.test.ts tests/components/reader-highlight-failsafe.test.ts
   mise exec -- bun run test:e2e -- e2e/reader.spec.ts
   ```

## Acceptance Criteria

- `/memories/:id` visually belongs to the refined shell.
- Reader markdown remains sanitized and readable.
- Existing persisted highlight marks render correctly.
- Selecting text still creates and toggles highlights.
